/* ==============================================================
   Testes — Minha conta (nome, e-mail, senha)
   ============================================================== */
const request = require("supertest");
const fs = require("fs");
const { app, db, resetDatabase, createUser, extractCsrf, loginAs } = require("./helpers");
const mailService = require("../app/services/mailService");

beforeEach(async () => {
  await resetDatabase();
  fs.rmSync(mailService.MAIL_DIR, { recursive: true, force: true });
});

function emails(template) {
  if (!fs.existsSync(mailService.MAIL_DIR)) return [];
  return fs.readdirSync(mailService.MAIL_DIR)
    .filter((f) => f.endsWith(`_${template}.txt`))
    .map((f) => fs.readFileSync(`${mailService.MAIL_DIR}/${f}`, "utf8"));
}

/** Usuário logado + token CSRF lido da própria página de edição. */
async function logado(opts = {}) {
  const user = await createUser({ email: "lia@aquatrip.local", name: "Lia Teste", password: "SenhaDaLia123!", ...opts });
  const { agent } = await loginAs(user);
  const html = (await agent.get("/perfil")).text;
  const csrf = html.match(/name="csrf-token" content="([^"]+)"/)[1];
  return { user, agent, csrf };
}

async function tentarLogin(email, senha) {
  const a = request.agent(app);
  const pg = await a.get("/login");
  const r = await a.post("/login").type("form").send({ email, senha, redirect: "/", _csrf: extractCsrf(pg.text) });
  return r.headers.location === "/";
}

describe("Páginas", () => {
  it("exigem login (antes eram abertas)", async () => {
    for (const r of ["/perfil", "/perfil_editado"]) {
      const res = await request(app).get(r);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain("/login");
    }
  });

  it("mostram os dados da pessoa, não um perfil inventado", async () => {
    const { agent } = await logado();
    const conta = (await agent.get("/perfil_editado")).text;
    expect(conta).toContain("Lia Teste");
    expect(conta).toContain("lia@aquatrip.local");
    expect(conta).not.toContain("Ana Beatriz");
    expect(conta).not.toContain("@anabeatriz");
  });
});

describe("Nome", () => {
  it("atualiza no banco e na sessão", async () => {
    const { user, agent, csrf } = await logado();
    const res = await agent.post("/api/conta/nome").set("X-CSRF-Token", csrf).send({ nome: "Ana Beatriz Souza" });
    expect(res.status).toBe(200);

    const { rows } = await db.query("SELECT name FROM users WHERE id = $1", [user.id]);
    expect(rows[0].name).toBe("Ana Beatriz Souza");
    expect((await agent.get("/")).text).toContain("Olá, Ana");
  });

  it("valida o nome", async () => {
    const { agent, csrf } = await logado();
    for (const nome of ["ab", "12345", "x".repeat(121)]) {
      const res = await agent.post("/api/conta/nome").set("X-CSRF-Token", csrf).send({ nome });
      expect(res.status).toBe(422);
      expect(res.body.campo).toBe("nome");
    }
  });

  it("exige CSRF", async () => {
    const { agent } = await logado();
    expect((await agent.post("/api/conta/nome").send({ nome: "Sem Token" })).status).toBe(403);
  });
});

describe("Troca de e-mail", () => {
  it("exige a senha atual", async () => {
    const { agent, csrf } = await logado();
    const res = await agent.post("/api/conta/email").set("X-CSRF-Token", csrf)
      .send({ novoEmail: "novo@aquatrip.local", senhaEmail: "errada" });
    expect(res.status).toBe(400);
    expect(res.body.campo).toBe("senhaEmail");
    expect(emails("email_troca")).toHaveLength(0);
  });

  it("só troca depois que o link enviado ao endereço NOVO é aberto", async () => {
    const { user, agent, csrf } = await logado();
    const res = await agent.post("/api/conta/email").set("X-CSRF-Token", csrf)
      .send({ novoEmail: "Novo@AquaTrip.local", senhaEmail: "SenhaDaLia123!" });
    expect(res.status).toBe(200);

    // Ainda o antigo.
    let { rows } = await db.query("SELECT email FROM users WHERE id = $1", [user.id]);
    expect(rows[0].email).toBe("lia@aquatrip.local");

    // Link foi para o novo; aviso foi para o antigo.
    const [link] = emails("email_troca");
    expect(link).toContain("novo@aquatrip.local");
    expect(emails("email_troca_aviso")[0]).toContain("lia@aquatrip.local");

    const token = link.match(/verificar-email\/([a-f0-9]{64})/)[1];
    const conf = await agent.get(`/verificar-email/${token}`);
    expect(conf.text).toContain("E-mail alterado");

    ({ rows } = await db.query("SELECT email, email_verified_at FROM users WHERE id = $1", [user.id]));
    expect(rows[0].email).toBe("novo@aquatrip.local");
    expect(rows[0].email_verified_at).not.toBeNull();

    // O endereço antigo é avisado de que a troca aconteceu.
    expect(emails("email_trocado")[0]).toContain("lia@aquatrip.local");
    expect(await tentarLogin("novo@aquatrip.local", "SenhaDaLia123!")).toBe(true);
    expect(await tentarLogin("lia@aquatrip.local", "SenhaDaLia123!")).toBe(false);
  });

  it("não revela que o e-mail já pertence a outra conta", async () => {
    await createUser({ email: "ocupado@aquatrip.local" });
    const { agent, csrf } = await logado();
    const res = await agent.post("/api/conta/email").set("X-CSRF-Token", csrf)
      .send({ novoEmail: "ocupado@aquatrip.local", senhaEmail: "SenhaDaLia123!" });

    // Mesma resposta de sucesso, mas nenhum link é enviado.
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(emails("email_troca")).toHaveLength(0);
  });

  it("recusa o link se o endereço foi tomado entre o pedido e o clique", async () => {
    const { agent, csrf } = await logado();
    await agent.post("/api/conta/email").set("X-CSRF-Token", csrf)
      .send({ novoEmail: "disputado@aquatrip.local", senhaEmail: "SenhaDaLia123!" });
    await createUser({ email: "disputado@aquatrip.local" }); // alguém se cadastra antes

    const token = emails("email_troca")[0].match(/verificar-email\/([a-f0-9]{64})/)[1];
    const conf = await agent.get(`/verificar-email/${token}`);
    expect(conf.status).toBe(400);
    expect(conf.text).toMatch(/passou a ser usado por outra conta/);
  });

  it("recusa trocar para o mesmo e-mail", async () => {
    const { agent, csrf } = await logado();
    const res = await agent.post("/api/conta/email").set("X-CSRF-Token", csrf)
      .send({ novoEmail: "lia@aquatrip.local", senhaEmail: "SenhaDaLia123!" });
    expect(res.body.codigo).toBe("SAME_EMAIL");
  });
});

describe("Troca de senha", () => {
  it("exige a senha atual", async () => {
    const { agent, csrf } = await logado();
    const res = await agent.post("/api/conta/senha").set("X-CSRF-Token", csrf)
      .send({ senhaAtual: "errada", novaSenha: "NovaSenha456!", confirmaSenha: "NovaSenha456!" });
    expect(res.body.campo).toBe("senhaAtual");
  });

  it("valida força, confirmação e senha repetida", async () => {
    const { agent, csrf } = await logado();
    const casos = [
      { senhaAtual: "SenhaDaLia123!", novaSenha: "curta", confirmaSenha: "curta" },
      { senhaAtual: "SenhaDaLia123!", novaSenha: "NovaSenha456!", confirmaSenha: "Diferente789!" },
      { senhaAtual: "SenhaDaLia123!", novaSenha: "SenhaDaLia123!", confirmaSenha: "SenhaDaLia123!" },
    ];
    for (const corpo of casos) {
      const r = await agent.post("/api/conta/senha").set("X-CSRF-Token", csrf).send(corpo);
      expect([400, 422]).toContain(r.status);
    }
  });

  it("troca a senha, mantém esta sessão e derruba as outras", async () => {
    const { user, agent, csrf } = await logado();
    const { agent: outroAparelho } = await loginAs(user);
    expect((await outroAparelho.get("/perfil_editado")).status).toBe(200);

    const res = await agent.post("/api/conta/senha").set("X-CSRF-Token", csrf)
      .send({ senhaAtual: "SenhaDaLia123!", novaSenha: "NovaSenha456!", confirmaSenha: "NovaSenha456!" });
    expect(res.status).toBe(200);

    expect((await agent.get("/perfil_editado")).status).toBe(200);        // esta continua
    expect((await outroAparelho.get("/perfil_editado")).status).toBe(302); // a outra caiu

    expect(await tentarLogin("lia@aquatrip.local", "NovaSenha456!")).toBe(true);
    expect(await tentarLogin("lia@aquatrip.local", "SenhaDaLia123!")).toBe(false);
    expect(emails("password_changed")).toHaveLength(1);
  });

  it("registra na auditoria sem gravar a senha", async () => {
    const { agent, csrf } = await logado();
    await agent.post("/api/conta/senha").set("X-CSRF-Token", csrf)
      .send({ senhaAtual: "SenhaDaLia123!", novaSenha: "SegredoNovo789!", confirmaSenha: "SegredoNovo789!" });
    const { rows } = await db.query("SELECT action, CAST(metadata AS CHAR) AS m FROM audit_log WHERE action = 'PASSWORD_CHANGED'");
    expect(rows).toHaveLength(1);
    const tudo = (await db.query("SELECT CAST(metadata AS CHAR) AS m FROM audit_log")).rows.map((r) => r.m).join(" ");
    expect(tudo).not.toContain("SegredoNovo789");
    expect(tudo).not.toContain("SenhaDaLia123");
  });
});
