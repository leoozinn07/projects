/* ==============================================================
   Testes — datas no fuso de operação e login do admin do setup
   1) A data de "Criar experiência" não pode depender das tabelas de
      fuso horário do MySQL (o Windows não as traz) nem do fuso do
      sistema onde o MySQL roda.
   2) O "npm run db:seed" deixa o admin com a senha do .env, mesmo
      quando ele já existia com outra senha.
   ============================================================== */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const request = require("supertest");
const argon2 = require("argon2");
const { app, db, resetDatabase, createUser, loginAs, extractCsrf } = require("./helpers");
const fuso = require("../app/lib/fuso");

beforeEach(resetDatabase);

describe("Fuso de operação (lib/fuso)", () => {
  it("converte o horário de Brasília para UTC e volta", () => {
    expect(fuso.paraUtc("2026-11-20", "08:30", "America/Sao_Paulo").toISOString()).toBe("2026-11-20T11:30:00.000Z");
    expect(fuso.localDe(new Date("2026-11-20T11:30:00Z"), "America/Sao_Paulo")).toEqual({ data: "2026-11-20", hora: "08:30" });
    // Virada de dia: 23h em Brasília já é o dia seguinte em UTC.
    expect(fuso.paraUtc("2026-12-31", "23:00", "America/Sao_Paulo").toISOString()).toBe("2027-01-01T02:00:00.000Z");
  });

  it("respeita horário de verão onde ele existe", () => {
    expect(fuso.paraUtc("2026-07-01", "12:00", "America/New_York").toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(fuso.paraUtc("2026-12-01", "12:00", "America/New_York").toISOString()).toBe("2026-12-01T17:00:00.000Z");
    expect(fuso.paraUtc("2026-03-08", "02:30", "America/New_York")).toBeNull(); // horário que não existe
  });

  it("recusa data ou hora inexistente", () => {
    expect(fuso.paraUtc("2026-02-31", "09:00")).toBeNull();
    expect(fuso.paraUtc("2026-13-01", "09:00")).toBeNull();
    expect(fuso.paraUtc("2026-10-10", "24:00")).toBeNull();
    expect(fuso.paraUtc("10/10/2026", "09:00")).toBeNull();
  });

  it("o app não usa CONVERT_TZ (que devolve NULL sem as tabelas de fuso do MySQL)", () => {
    const achados = [];
    const varrer = (dir) => {
      for (const nome of fs.readdirSync(dir)) {
        const p = path.join(dir, nome);
        if (fs.statSync(p).isDirectory()) varrer(p);
        else if (p.endsWith(".js") && /CONVERT_TZ\s*\(/.test(fs.readFileSync(p, "utf8"))) achados.push(p);
      }
    };
    varrer(path.join(__dirname, "..", "app"));
    expect(achados).toEqual([]);
  });

  it("toda conexão com o banco trabalha em UTC (NOW() igual a UTC_TIMESTAMP())", async () => {
    const consultas = await Promise.all(Array.from({ length: 12 }, () =>
      db.query(`SELECT @@session.time_zone AS tz, TIMESTAMPDIFF(SECOND, NOW(), UTC_TIMESTAMP()) AS dif`)));
    for (const { rows } of consultas) {
      expect(rows[0].tz).toBe("+00:00");
      expect(Number(rows[0].dif)).toBe(0);
    }
  });
});

describe("Criar experiência: a data digitada", () => {
  it("é salva em UTC e volta igual na edição e na página", async () => {
    const user = await createUser();
    const { agent, csrf } = await loginAs(user);
    const criada = await agent.post("/api/comunidade/experiencias").set("X-CSRF-Token", csrf).set("Accept", "application/json").send({
      title: "Passeio para testar a data", description: "Descrição com tamanho suficiente para passar da validação.",
      location: "Ubatuba, SP", category: "praia", date: "2026-11-20", time: "08:30", capacity: 5,
    });
    expect(criada.status).toBe(201);
    const { rows } = await db.query(
      `SELECT sl.starts_at FROM service_slots sl WHERE sl.service_id = ?`, [criada.body.id]);
    expect(new Date(rows[0].starts_at).toISOString()).toBe("2026-11-20T11:30:00.000Z");

    const edicao = await agent.get(`/criar_experiencia?editar=${criada.body.id}`);
    expect(edicao.text).toMatch(/id="cxDate"[^>]*value="2026-11-20"/);
    expect(edicao.text).toMatch(/id="cxTime"[^>]*value="08:30"/);

    const pagina = await request(app).get(`/reservar/${criada.body.slug}`);
    expect(pagina.text).toContain("08:30");
  });

  it("data inexistente volta com mensagem clara", async () => {
    const user = await createUser();
    const { agent, csrf } = await loginAs(user);
    const r = await agent.post("/api/comunidade/experiencias").set("X-CSRF-Token", csrf).set("Accept", "application/json").send({
      title: "Data que não existe", description: "Descrição com tamanho suficiente para passar da validação.",
      location: "Santos, SP", category: "praia", date: "2026-02-31", time: "09:00", capacity: 3,
    });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("Data ou horário inválido.");
  });
});

describe("Admin inicial (npm run db:seed)", () => {
  const EMAIL = "admin-seed@aquatrip.local";
  const seed = (senha) => execFileSync(process.execPath, [path.join(__dirname, "..", "database", "seed.js")], {
    env: { ...process.env, ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: senha, ADMIN_NAME: "Admin Seed" },
    encoding: "utf8",
  });
  const hashAtual = async () => (await db.query(`SELECT password_hash, role FROM users WHERE email = ?`, [EMAIL])).rows[0];
  /** Login de verdade (com CSRF): devolve para onde o servidor mandou. */
  const entrar = async (senha) => {
    const agent = request.agent(app);
    const csrf = extractCsrf((await agent.get("/login")).text);
    return agent.post("/login").type("form").send({ email: EMAIL, senha, redirect: "/admin", _csrf: csrf });
  };

  it("cria o admin com a senha do .env", async () => {
    expect(seed("Admin-Primeira9!")).toContain("usuário admin criado");
    const u = await hashAtual();
    expect(u.role).toBe("ADMIN");
    expect(await argon2.verify(u.password_hash, "Admin-Primeira9!")).toBe(true);
  });

  it("setup rodado de novo (senha nova no .env): o seed atualiza a senha do admin que já existia", async () => {
    seed("Admin-Primeira9!");
    const saida = seed("Admin-Segunda9!");
    expect(saida).toContain("a senha foi atualizada");
    const u = await hashAtual();
    expect(await argon2.verify(u.password_hash, "Admin-Segunda9!")).toBe(true);
    expect(await argon2.verify(u.password_hash, "Admin-Primeira9!")).toBe(false);
    // Login: a senha do .env entra; a antiga e uma errada não.
    const certo = await entrar("Admin-Segunda9!");
    expect(certo.status).toBe(302);
    expect(certo.headers.location).toBe("/admin");
    expect((await entrar("Admin-Primeira9!")).headers.location).toMatch(/login\?error/);
    expect((await entrar("SenhaErrada123!")).headers.location).toMatch(/login\?error/);
    // Rodar de novo com a mesma senha não mexe em nada.
    expect(seed("Admin-Segunda9!")).toContain("a senha confere");
  });

  it("desbloqueia o admin travado por tentativas erradas", async () => {
    seed("Admin-Primeira9!");
    await db.query(`UPDATE users SET failed_login_count = 5, locked_until = UTC_TIMESTAMP() + INTERVAL 15 MINUTE WHERE email = ?`, [EMAIL]);
    expect(seed("Admin-Primeira9!")).toContain("desbloqueado");
    const { rows } = await db.query(`SELECT failed_login_count, locked_until FROM users WHERE email = ?`, [EMAIL]);
    expect(Number(rows[0].failed_login_count)).toBe(0);
    expect(rows[0].locked_until).toBeNull();
  });

  it("nunca promove a admin uma conta comum com o mesmo e-mail", async () => {
    await createUser({ email: EMAIL, password: "SenhaDaPessoa123!" });
    let erro = null;
    try { seed("Admin-Primeira9!"); } catch (e) { erro = e; }
    expect(erro).not.toBeNull();
    expect(String(erro.stdout) + String(erro.stderr)).toContain("Nada foi alterado");
    const u = await hashAtual();
    expect(u.role).toBe("USER");
    expect(await argon2.verify(u.password_hash, "Admin-Primeira9!")).toBe(false);
  });
});
