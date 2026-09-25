/* ==============================================================
   Testes — autenticação, sessão e autorização (RBAC)
   ============================================================== */
const request = require("supertest");
const {
  app,
  db,
  resetDatabase,
  createUser,
  extractCsrf,
  loginAs,
} = require("./helpers");

beforeEach(resetDatabase);

describe("Cadastro", () => {
  it("cria o usuário e não guarda a senha em texto puro", async () => {
    const agent = request.agent(app);
    const page = await agent.get("/cadastro");
    const csrf = extractCsrf(page.text);

    const res = await agent.post("/cadastro").type("form").send({
      nome: "Maria Silva",
      email: "maria@aquatrip.local",
      senha: "SenhaForte123!",
      "confirma-senha": "SenhaForte123!",
      aceite: "on",
      _csrf: csrf,
    });

    expect(res.status).toBe(302);

    const { rows } = await db.query(
      "SELECT name, email, role, password_hash FROM users WHERE email = $1",
      ["maria@aquatrip.local"]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("USER"); // nunca ADMIN por auto-cadastro
    expect(rows[0].password_hash).not.toContain("SenhaForte123!");
    expect(rows[0].password_hash.startsWith("$argon2")).toBe(true);
  });

  it("rejeita cadastro sem token CSRF", async () => {
    const agent = request.agent(app);
    await agent.get("/cadastro");

    const res = await agent.post("/cadastro").type("form").send({
      nome: "Sem CSRF",
      email: "semcsrf@aquatrip.local",
      senha: "SenhaForte123!",
      "confirma-senha": "SenhaForte123!",
    });

    expect(res.status).toBe(403);
    const { rows } = await db.query("SELECT 1 FROM users WHERE email = $1", [
      "semcsrf@aquatrip.local",
    ]);
    expect(rows).toHaveLength(0);
  });

  it("rejeita senha curta", async () => {
    const agent = request.agent(app);
    const page = await agent.get("/cadastro");
    const csrf = extractCsrf(page.text);

    await agent.post("/cadastro").type("form").send({
      nome: "Curta",
      email: "curta@aquatrip.local",
      senha: "1234",
      "confirma-senha": "1234",
      aceite: "on",
      _csrf: csrf,
    });

    const { rows } = await db.query("SELECT 1 FROM users WHERE email = $1", [
      "curta@aquatrip.local",
    ]);
    expect(rows).toHaveLength(0);
  });

  it("não revela que um e-mail já existe (anti-enumeração)", async () => {
    await createUser({ email: "existente@aquatrip.local" });

    const agent = request.agent(app);
    const page = await agent.get("/cadastro");
    const csrf = extractCsrf(page.text);

    const res = await agent.post("/cadastro").type("form").send({
      nome: "Outro",
      email: "existente@aquatrip.local",
      senha: "SenhaForte123!",
      "confirma-senha": "SenhaForte123!",
      aceite: "on",
      _csrf: csrf,
    });

    // Mensagem genérica: não pode confirmar a existência da conta.
    expect(decodeURIComponent(res.headers.location)).not.toMatch(/já cadastrado|existe/i);
  });
});

describe("Login", () => {
  it("autentica com credenciais válidas e cria sessão", async () => {
    const user = await createUser({ email: "login@aquatrip.local" });
    const { agent } = await loginAs(user);

    const home = await agent.get("/");
    expect(home.text).toContain("Olá, Usuário");
  });

  it("usa mensagem idêntica para senha errada e usuário inexistente", async () => {
    await createUser({ email: "real@aquatrip.local", password: "SenhaCerta123!" });
    const agent = request.agent(app);

    async function tentar(email, senha) {
      const page = await agent.get("/login");
      const csrf = extractCsrf(page.text);
      const res = await agent
        .post("/login")
        .type("form")
        .send({ email, senha, _csrf: csrf });
      return decodeURIComponent(res.headers.location || "");
    }

    const senhaErrada = await tentar("real@aquatrip.local", "SenhaErrada123!");
    const naoExiste = await tentar("fantasma@aquatrip.local", "QualquerCoisa1!");

    expect(senhaErrada).toContain("E-mail ou senha inválidos");
    expect(naoExiste).toContain("E-mail ou senha inválidos");
  });

  it("bloqueia a conta após 5 tentativas erradas", async () => {
    const user = await createUser({
      email: "bloqueio@aquatrip.local",
      password: "SenhaCerta123!",
    });
    const agent = request.agent(app);

    for (let i = 0; i < 5; i++) {
      const page = await agent.get("/login");
      const csrf = extractCsrf(page.text);
      await agent
        .post("/login")
        .type("form")
        .send({ email: user.email, senha: `Errada${i}!`, _csrf: csrf });
    }

    const { rows } = await db.query(
      "SELECT failed_login_count, locked_until FROM users WHERE email = $1",
      [user.email]
    );
    expect(rows[0].failed_login_count).toBeGreaterThanOrEqual(5);
    expect(rows[0].locked_until).not.toBeNull();

    // Nem com a senha correta entra enquanto estiver bloqueado.
    const page = await agent.get("/login");
    const csrf = extractCsrf(page.text);
    const res = await agent
      .post("/login")
      .type("form")
      .send({ email: user.email, senha: "SenhaCerta123!", _csrf: csrf });
    expect(decodeURIComponent(res.headers.location)).toMatch(/bloqueada/i);
  });

  it("regenera a sessão no login (anti session fixation)", async () => {
    const user = await createUser({ email: "fixation@aquatrip.local" });
    const agent = request.agent(app);

    const page = await agent.get("/login");
    const csrf = extractCsrf(page.text);
    const cookieAntes = page.headers["set-cookie"]?.[0];

    const res = await agent
      .post("/login")
      .type("form")
      .send({ email: user.email, senha: user.password, _csrf: csrf });

    const cookieDepois = res.headers["set-cookie"]?.[0];
    expect(cookieDepois).toBeDefined();
    if (cookieAntes) expect(cookieDepois).not.toBe(cookieAntes);
  });

  it("marca o cookie de sessão como httpOnly", async () => {
    const user = await createUser({ email: "cookie@aquatrip.local" });
    const agent = request.agent(app);
    const page = await agent.get("/login");
    const csrf = extractCsrf(page.text);

    const res = await agent
      .post("/login")
      .type("form")
      .send({ email: user.email, senha: user.password, _csrf: csrf });

    const cookie = res.headers["set-cookie"].join(";");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
});

describe("Autorização (RBAC)", () => {
  it("redireciona visitante anônimo para o login", async () => {
    for (const rota of ["/admin", "/minhas-reservas", "/viagens", "/ingressos"]) {
      const res = await request(app).get(rota);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain("/login");
    }
  });

  it("ver experiências é público, mas reservar exige login", async () => {
    const ver = await request(app).get("/reservar");
    expect(ver.status).toBe(200);

    const agent = request.agent(app);
    const pagina = await agent.get("/reservar");
    const reservar = await agent.post("/reservar").type("form")
      .send({ slotId: "00000000-0000-0000-0000-000000000000", quantity: 1, _csrf: extractCsrf(pagina.text) });
    expect(reservar.status).toBe(302);
    expect(reservar.headers.location).toContain("/login");
  });

  it("nega /admin a usuário comum com 403", async () => {
    const user = await createUser({ email: "comum@aquatrip.local", role: "USER" });
    const { agent } = await loginAs(user);

    for (const rota of ["/admin"]) {
      const res = await agent.get(rota);
      expect(res.status).toBe(403);
    }
  });

  it("permite /admin ao ADMIN", async () => {
    const admin = await createUser({ email: "chefe@aquatrip.local", role: "ADMIN" });
    const { agent } = await loginAs(admin);

    for (const rota of ["/admin"]) {
      const res = await agent.get(rota);
      expect(res.status).toBe(200);
    }
  });
});

describe("Logout", () => {
  it("encerra a sessão", async () => {
    const user = await createUser({ email: "sair@aquatrip.local" });
    const { agent, csrf } = await loginAs(user);

    await agent.post("/logout").type("form").send({ _csrf: csrf });

    const res = await agent.get("/minhas-reservas");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("/login");
  });
});
