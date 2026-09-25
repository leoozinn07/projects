/* ==============================================================
   Testes — observabilidade
   ============================================================== */
const request = require("supertest");
const { Writable } = require("stream");
const pino = require("pino");
const { app, db, resetDatabase } = require("./helpers");
const logger = require("../app/lib/logger");
const healthController = require("../app/controllers/healthController");

beforeEach(resetDatabase);

describe("Health checks", () => {
  it("/healthz responde sem tocar no banco", async () => {
    const spy = jest.spyOn(db, "query");
    const res = await request(app).get("/healthz");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    // Liveness não pode depender do banco: se dependesse, uma queda do
    // Postgres faria o orquestrador reiniciar todos os containers em loop.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("/readyz confere o banco de verdade", async () => {
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body.checks.banco.ok).toBe(true);
    expect(typeof res.body.checks.banco.latenciaMs).toBe("number");
  });

  it("/readyz devolve 503 quando o banco cai", async () => {
    const spy = jest.spyOn(db, "query").mockRejectedValueOnce(new Error("conexão recusada"));
    const res = await request(app).get("/readyz");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("indisponivel");
    spy.mockRestore();
  });

  it("não expõe detalhes internos (reconhecimento)", async () => {
    const spy = jest.spyOn(db, "query").mockRejectedValueOnce(
      new Error("password authentication failed for user aquatrip at 10.0.0.5")
    );
    const res = await request(app).get("/readyz");
    const corpo = JSON.stringify(res.body);

    expect(corpo).not.toContain("password");
    expect(corpo).not.toContain("10.0.0.5");
    expect(corpo).not.toContain("aquatrip");
    spy.mockRestore();
  });

  it("não cria sessão (chamado a cada poucos segundos)", async () => {
    const res = await request(app).get("/healthz");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("não é cacheado", async () => {
    const res = await request(app).get("/readyz");
    expect(res.headers["cache-control"]).toContain("no-store");
  });
});

describe("Correlação de requisição", () => {
  it("toda resposta traz X-Request-Id", async () => {
    const res = await request(app).get("/");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reaproveita o id enviado por quem chama (rastro entre sistemas)", async () => {
    const res = await request(app).get("/").set("X-Request-Id", "balanceador-abc123");
    expect(res.headers["x-request-id"]).toBe("balanceador-abc123");
  });

  it("descarta id com formato perigoso (injeção no log)", async () => {
    const malicioso = '"><script>alert(1)</script>';
    const res = await request(app).get("/").set("X-Request-Id", malicioso);
    expect(res.headers["x-request-id"]).not.toBe(malicioso);
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("gera ids diferentes para requisições diferentes", async () => {
    const a = await request(app).get("/healthz");
    const b = await request(app).get("/healthz");
    expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
  });
});

describe("Redação de dados sensíveis no log", () => {
  /** Logger que escreve num buffer, com a MESMA config de redação do real. */
  function loggerCapturado() {
    const linhas = [];
    const destino = new Writable({
      write(chunk, _enc, cb) { linhas.push(chunk.toString()); cb(); },
    });
    const l = pino({ redact: { paths: logger.REDACT, censor: "[REDACTED]" } }, destino);
    return { l, texto: () => linhas.join("") };
  }

  it("não grava senha", () => {
    const { l, texto } = loggerCapturado();
    l.info({ body: { email: "a@b.com", senha: "SenhaSecreta123!" } }, "login");
    expect(texto()).not.toContain("SenhaSecreta123!");
    expect(texto()).toContain("[REDACTED]");
    expect(texto()).toContain("a@b.com"); // o que não é segredo continua
  });

  it("não grava cookie nem authorization", () => {
    const { l, texto } = loggerCapturado();
    l.info({
      req: { headers: { cookie: "aquatrip.sid=abc123", authorization: "Bearer tok_xyz" } },
    }, "req");
    expect(texto()).not.toContain("abc123");
    expect(texto()).not.toContain("tok_xyz");
  });

  it("não grava assinatura de webhook", () => {
    const { l, texto } = loggerCapturado();
    l.info({ req: { headers: { "x-aquatrip-signature": "sig_secreta_999" } } }, "webhook");
    expect(texto()).not.toContain("sig_secreta_999");
  });

  it("não grava dado de cartão nem token CSRF", () => {
    const { l, texto } = loggerCapturado();
    l.info({ pagamento: { cardToken: "tok_card_1", cvv: "123", card_number: "4111111111111111" } });
    l.info({ form: { _csrf: "csrf_zzz" } });
    const t = texto();
    expect(t).not.toContain("tok_card_1");
    expect(t).not.toContain("4111111111111111");
    expect(t).not.toContain("csrf_zzz");
  });
});

describe("Página de erro", () => {
  it("em produção: mostra código de suporte e esconde o erro interno", async () => {
    // Força uma exceção numa rota real.
    const { createUser, loginAs } = require("./helpers");
    const user = await createUser({ email: "erro500@aquatrip.local" });
    const { agent } = await loginAs(user);
    // Depois do login: o login passa pela home, que também lista o catálogo.
    const spy = jest
      .spyOn(require("../app/repositories/catalogRepository"), "listAll")
      .mockRejectedValueOnce(new Error("falha simulada"));

    const ambienteOriginal = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    let res;
    try {
      res = await agent.get("/reservar");
    } finally {
      process.env.NODE_ENV = ambienteOriginal;
      spy.mockRestore();
    }

    expect(res.status).toBe(500);
    expect(res.text).toContain("Código para o suporte");
    expect(res.text).not.toContain("falha simulada"); // mensagem interna não vaza
    expect(res.text).not.toMatch(/at .*\.js:\d+/);   // nem stack trace
  });

  it("fora de produção: mostra o stack (ajuda a depurar)", async () => {
    const { createUser, loginAs } = require("./helpers");
    const user = await createUser({ email: "errodev@aquatrip.local" });
    const { agent } = await loginAs(user);
    const spy = jest
      .spyOn(require("../app/repositories/catalogRepository"), "listAll")
      .mockRejectedValueOnce(new Error("falha visivel em dev"));

    const res = await agent.get("/reservar");
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.text).toContain("falha visivel em dev");
  });
});

/* ==============================================================
   Regressão — a página de erro não pode depender de locals
   ==============================================================
   Relatado em uso real: com o banco fora, a leitura da sessão falha
   e PULA os middlewares que definem `user` e `csrfToken`. A página de
   erro quebrava no cabeçalho ("user is not defined") e o erro real
   ficava escondido atrás de uma tela de stack do Express.
   ============================================================== */
describe("Página de erro sem os locais preenchidos", () => {
  const express = require("express");
  const path = require("path");

  /** App mínimo com os mesmos handlers, SEM os middlewares de sessão/usuário. */
  function appQuebrado(erro) {
    const a = express();
    a.set("view engine", "ejs");
    a.set("views", path.join(__dirname, "..", "app", "views"));
    a.locals.fmt = require("../app/lib/datas");
    a.locals.categoriaRotulo = require("../app/lib/categorias").rotulo;
    a.get("/quebra", (req, res, next) => next(erro));
    // Cópia dos handlers reais, carregados do app.js em produção.
    const real = require("../app");
    a.use(real._handler404 || ((req, res) => res.status(404).render("pages/erro", {
      statusCode: 404, title: "Não encontrada", message: "", stack: null,
    })));
    a.use(real._handlerErro);
    return a;
  }

  it("desenha a página de erro mesmo sem user e csrfToken", async () => {
    const res = await request(appQuebrado(new Error("falha qualquer"))).get("/quebra");
    expect(res.status).toBe(500);
    expect(res.text).not.toMatch(/user is not defined|ReferenceError/);
    expect(res.text).toContain("Entrar"); // o cabeçalho desenhou
  });

  it("o cabeçalho desenha sem NENHUM local definido (2ª camada)", async () => {
    // Sem passar pelos handlers: renderiza a view direto, como aconteceria
    // se algum caminho novo esquecesse os defaults. Cobre a defesa do
    // próprio cabeçalho — a checagem acima cobre só a dos handlers.
    const a = express();
    a.set("view engine", "ejs");
    a.set("views", path.join(__dirname, "..", "app", "views"));
    a.get("/cru", (req, res) =>
      res.render("pages/erro", { statusCode: 500, title: "x", message: "y", stack: null }));
    a.use((err, req, res, _next) => res.status(599).send(String(err.message)));
    const res = await request(a).get("/cru");
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/is not defined/);
  });

  it("falha de conexão com o banco vira 503 com a causa e o que fazer", async () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:3306");
    err.code = "ECONNREFUSED";
    const res = await request(appQuebrado(err)).get("/quebra");
    expect(res.status).toBe(503);
    expect(res.text).toMatch(/banco de dados/i);
    expect(res.text).toMatch(/npm run db:migrate|MySQL/);
  });

  it("senha errada do banco também é tratada como indisponibilidade", async () => {
    const err = new Error("Access denied for user 'aquatrip'@'localhost' (using password: YES)");
    err.code = "ER_ACCESS_DENIED_ERROR";
    expect((await request(appQuebrado(err)).get("/quebra")).status).toBe(503);
  });

  it("banco inexistente também é tratado como indisponibilidade", async () => {
    const err = new Error("Unknown database 'aquatrip'");
    err.code = "ER_BAD_DB_ERROR";
    expect((await request(appQuebrado(err)).get("/quebra")).status).toBe(503);
  });
});
