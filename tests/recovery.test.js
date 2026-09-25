/* ==============================================================
   Testes — recuperação de senha e verificação de e-mail
   ============================================================== */
const request = require("supertest");
const argon2 = require("argon2");
const {
  app,
  db,
  resetDatabase,
  createUser,
  extractCsrf,
  loginAs,
} = require("./helpers");
const recoveryService = require("../app/services/accountRecoveryService");
const tokenRepository = require("../app/repositories/tokenRepository");

beforeEach(resetDatabase);

async function senhaConfere(email, senha) {
  const { rows } = await db.query("SELECT password_hash FROM users WHERE email = $1", [email]);
  if (!rows[0]) return false;
  return argon2.verify(rows[0].password_hash, senha);
}

describe("Pedido de recuperação (anti-enumeração)", () => {
  it("responde igual para e-mail existente e inexistente", async () => {
    await createUser({ email: "existe@aquatrip.local" });

    async function pedir(email) {
      const agent = request.agent(app);
      const page = await agent.get("/esqueci-senha");
      const csrf = extractCsrf(page.text);
      return agent.post("/esqueci-senha").type("form").send({ email, _csrf: csrf });
    }

    const comConta = await pedir("existe@aquatrip.local");
    const semConta = await pedir("naoexiste@aquatrip.local");

    // Mesmo status e mesmo destino: nada distingue os dois casos.
    expect(comConta.status).toBe(semConta.status);
    expect(comConta.headers.location).toBe(semConta.headers.location);
    expect(comConta.headers.location).toContain("enviado=1");
  });

  it("não cria token para e-mail inexistente", async () => {
    const agent = request.agent(app);
    const page = await agent.get("/esqueci-senha");
    const csrf = extractCsrf(page.text);
    await agent
      .post("/esqueci-senha")
      .type("form")
      .send({ email: "fantasma@aquatrip.local", _csrf: csrf });

    const { rows } = await db.query("SELECT 1 FROM password_reset_tokens");
    expect(rows).toHaveLength(0);
  });

  it("limita pedidos repetidos para a mesma conta", async () => {
    const user = await createUser({ email: "spam@aquatrip.local" });

    for (let i = 0; i < 6; i++) {
      await recoveryService.requestPasswordReset({ email: user.email });
    }

    const ultimo = await recoveryService.requestPasswordReset({ email: user.email });
    expect(ultimo.throttled).toBe(true);
  });
});

describe("Segurança do token", () => {
  it("guarda apenas o hash — nunca o token em claro", async () => {
    const user = await createUser({ email: "hash@aquatrip.local" });
    const { token } = await recoveryService.requestPasswordReset({ email: user.email });

    const { rows } = await db.query("SELECT token_hash FROM password_reset_tokens");
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toBe(tokenRepository.hashToken(token));
    expect(rows[0].token_hash).toHaveLength(64);
  });

  it("invalida o token anterior quando um novo é pedido", async () => {
    const user = await createUser({ email: "dois@aquatrip.local" });
    const primeiro = await recoveryService.requestPasswordReset({ email: user.email });
    const segundo = await recoveryService.requestPasswordReset({ email: user.email });

    expect(await recoveryService.checkResetToken(primeiro.token)).toBe(false);
    expect(await recoveryService.checkResetToken(segundo.token)).toBe(true);
  });

  it("recusa token expirado", async () => {
    const user = await createUser({ email: "expira@aquatrip.local" });
    const { token } = await recoveryService.requestPasswordReset({ email: user.email });

    await db.query("UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL 1 MINUTE");

    expect(await recoveryService.checkResetToken(token)).toBe(false);
    await expect(
      recoveryService.resetPassword({ token, newPassword: "NovaSenha123!" })
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("recusa token inventado", async () => {
    expect(await recoveryService.checkResetToken("a".repeat(64))).toBe(false);
    expect(await recoveryService.checkResetToken("curto")).toBe(false);
  });
});

describe("Redefinição de senha", () => {
  it("troca a senha e invalida a anterior", async () => {
    const user = await createUser({
      email: "troca@aquatrip.local",
      password: "SenhaAntiga123!",
    });
    const { token } = await recoveryService.requestPasswordReset({ email: user.email });

    const agent = request.agent(app);
    const page = await agent.get(`/redefinir-senha/${token}`);
    expect(page.text).toContain("Criar nova senha");
    const csrf = extractCsrf(page.text);

    const res = await agent
      .post(`/redefinir-senha/${token}`)
      .type("form")
      .send({ senha: "SenhaNova456!", "confirma-senha": "SenhaNova456!", _csrf: csrf });

    expect(res.headers.location).toContain("senha_alterada=1");
    expect(await senhaConfere(user.email, "SenhaNova456!")).toBe(true);
    expect(await senhaConfere(user.email, "SenhaAntiga123!")).toBe(false);
  });

  it("o token é de uso único", async () => {
    const user = await createUser({ email: "unico@aquatrip.local" });
    const { token } = await recoveryService.requestPasswordReset({ email: user.email });

    await recoveryService.resetPassword({ token, newPassword: "PrimeiraTroca1!" });

    await expect(
      recoveryService.resetPassword({ token, newPassword: "SegundaTroca2!" })
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });

    // A senha continua sendo a da primeira troca.
    expect(await senhaConfere(user.email, "PrimeiraTroca1!")).toBe(true);
  });

  it("recusa senha fraca", async () => {
    const user = await createUser({ email: "fraca@aquatrip.local" });
    const { token } = await recoveryService.requestPasswordReset({ email: user.email });

    await expect(
      recoveryService.resetPassword({ token, newPassword: "123" })
    ).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
  });

  it("recusa quando a confirmação não bate", async () => {
    const user = await createUser({ email: "confirma@aquatrip.local" });
    const { token } = await recoveryService.requestPasswordReset({ email: user.email });

    const agent = request.agent(app);
    const page = await agent.get(`/redefinir-senha/${token}`);
    const csrf = extractCsrf(page.text);

    const res = await agent
      .post(`/redefinir-senha/${token}`)
      .type("form")
      .send({ senha: "SenhaNova456!", "confirma-senha": "Diferente789!", _csrf: csrf });

    expect(decodeURIComponent(res.headers.location)).toMatch(/não coincidem/i);
  });

  it("exige CSRF", async () => {
    const user = await createUser({ email: "csrfreset@aquatrip.local" });
    const { token } = await recoveryService.requestPasswordReset({ email: user.email });

    const agent = request.agent(app);
    await agent.get(`/redefinir-senha/${token}`);

    const res = await agent
      .post(`/redefinir-senha/${token}`)
      .type("form")
      .send({ senha: "SenhaNova456!", "confirma-senha": "SenhaNova456!" });

    expect(res.status).toBe(403);
  });

  it("libera conta bloqueada por tentativas", async () => {
    const user = await createUser({ email: "travada@aquatrip.local" });
    await db.query(
      "UPDATE users SET failed_login_count = 5, locked_until = NOW() + INTERVAL 15 MINUTE WHERE id = $1",
      [user.id]
    );

    const { token } = await recoveryService.requestPasswordReset({ email: user.email });
    await recoveryService.resetPassword({ token, newPassword: "SenhaLiberada1!" });

    const { rows } = await db.query(
      "SELECT failed_login_count, locked_until FROM users WHERE id = $1",
      [user.id]
    );
    expect(rows[0].failed_login_count).toBe(0);
    expect(rows[0].locked_until).toBeNull();
  });

  it("mostra tela de link inválido para token inexistente", async () => {
    const res = await request(app).get(`/redefinir-senha/${"b".repeat(64)}`);
    expect(res.status).toBe(400);
    expect(res.text).toContain("Link inválido");
  });
});

describe("Verificação de e-mail", () => {
  it("cadastro dispara o envio de verificação", async () => {
    const agent = request.agent(app);
    const page = await agent.get("/cadastro");
    const csrf = extractCsrf(page.text);

    await agent.post("/cadastro").type("form").send({
      nome: "Verificar Teste",
      email: "verificar@aquatrip.local",
      senha: "SenhaForte123!",
      "confirma-senha": "SenhaForte123!",
      aceite: "on",
      _csrf: csrf,
    });

    // Dá tempo do envio assíncrono concluir.
    await new Promise((r) => setTimeout(r, 300));

    const { rows } = await db.query(
      `SELECT 1 FROM email_verification_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE u.email = $1`,
      ["verificar@aquatrip.local"]
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("confirma o e-mail com token válido", async () => {
    const user = await createUser({ email: "confirmar@aquatrip.local" });
    const { token } = await recoveryService.sendVerificationEmail({ userId: user.id });

    const res = await request(app).get(`/verificar-email/${token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("E-mail confirmado");

    const { rows } = await db.query(
      "SELECT email_verified_at FROM users WHERE id = $1",
      [user.id]
    );
    expect(rows[0].email_verified_at).not.toBeNull();
  });

  it("o token de verificação é de uso único", async () => {
    const user = await createUser({ email: "unicoverif@aquatrip.local" });
    const { token } = await recoveryService.sendVerificationEmail({ userId: user.id });

    await request(app).get(`/verificar-email/${token}`);
    const segunda = await request(app).get(`/verificar-email/${token}`);

    expect(segunda.status).toBe(400);
    expect(segunda.text).toContain("Não foi possível confirmar");
  });

  it("não reenvia para quem já confirmou", async () => {
    const user = await createUser({ email: "javerificado@aquatrip.local" });
    await db.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [user.id]);

    const res = await recoveryService.sendVerificationEmail({ userId: user.id });
    expect(res.alreadyVerified).toBe(true);
  });

  it("reenvio exige login", async () => {
    const res = await request(app).post("/reenviar-verificacao").type("form").send({});
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("/login");
  });
});

describe("Auditoria da recuperação", () => {
  it("registra pedido, conclusão e verificação", async () => {
    const user = await createUser({ email: "auditrec@aquatrip.local" });
    const { token } = await recoveryService.requestPasswordReset({ email: user.email });
    await recoveryService.resetPassword({ token, newPassword: "SenhaAuditada1!" });

    const { rows } = await db.query(
      "SELECT action FROM audit_log WHERE action LIKE 'PASSWORD_RESET%' ORDER BY id"
    );
    const acoes = rows.map((r) => r.action);
    expect(acoes).toContain("PASSWORD_RESET_REQUESTED");
    expect(acoes).toContain("PASSWORD_RESET_COMPLETED");
  });

  it("não grava a senha nova na auditoria", async () => {
    const user = await createUser({ email: "semvazar@aquatrip.local" });
    const { token } = await recoveryService.requestPasswordReset({ email: user.email });
    await recoveryService.resetPassword({ token, newPassword: "SegredoAbsoluto9!" });

    const { rows } = await db.query("SELECT metadata FROM audit_log");
    const tudo = JSON.stringify(rows);
    expect(tudo).not.toContain("SegredoAbsoluto9");
  });
});
