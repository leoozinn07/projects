/* ==============================================================
   Testes — verificação em duas etapas (TOTP)
   ============================================================== */
const request = require("supertest");
const { authenticator } = require("otplib");
const { app, db, resetDatabase, createUser, extractCsrf, loginAs } = require("./helpers");
const twoFactor = require("../app/services/twoFactorService");

beforeEach(async () => {
  await resetDatabase();
  await db.query("TRUNCATE recovery_codes");
});
afterEach(() => { process.env.REQUIRE_ADMIN_2FA = "false"; jest.restoreAllMocks(); });

/** Ativa o 2FA direto pelo service e libera o passo atual para o login. */
async function com2fa(user) {
  const segredo = twoFactor.gerarSegredo();
  const codigos = await twoFactor.ativar({ userId: user.id, segredo, codigo: authenticator.generate(segredo) });
  await db.query("UPDATE users SET totp_last_step = NULL WHERE id = $1", [user.id]);
  return { segredo, codigos };
}

/** Faz a primeira etapa (senha) e devolve o agente parado na segunda. */
async function primeiraEtapa(user, redirect = "/") {
  const agent = request.agent(app);
  const pg = await agent.get("/login");
  const r = await agent.post("/login").type("form")
    .send({ email: user.email, senha: user.password, redirect, _csrf: extractCsrf(pg.text) });
  return { agent, destino: r.headers.location };
}

async function enviarCodigo(agent, codigo) {
  const pg = await agent.get("/login/2fa");
  const r = await agent.post("/login/2fa").type("form").send({ codigo, _csrf: extractCsrf(pg.text) });
  return decodeURIComponent(r.headers.location || "");
}

describe("Criptografia do segredo", () => {
  it("cifra e decifra; o banco nunca vê o segredo em claro", async () => {
    const user = await createUser();
    const { segredo } = await com2fa(user);
    const { rows } = await db.query("SELECT totp_secret_enc FROM users WHERE id = $1", [user.id]);
    expect(rows[0].totp_secret_enc).toMatch(/^v1:/);
    expect(rows[0].totp_secret_enc).not.toContain(segredo);
    expect(twoFactor.decifrar(rows[0].totp_secret_enc)).toBe(segredo);
  });

  it("detecta adulteração (GCM)", () => {
    const [v, iv, tag, dados] = twoFactor.cifrar("SEGREDOTESTE").split(":");
    const adulterado = [v, iv, tag, Buffer.from("xx" + dados).toString("base64")].join(":");
    expect(() => twoFactor.decifrar(adulterado)).toThrow();
  });

  it("segredo tem 160 bits", () => {
    expect(twoFactor.gerarSegredo()).toHaveLength(32); // 32 caracteres base32 = 160 bits
  });

  it("códigos de recuperação ficam só como hash", async () => {
    const user = await createUser();
    const { codigos } = await com2fa(user);
    expect(codigos).toHaveLength(10);
    const { rows } = await db.query("SELECT code_hash FROM recovery_codes WHERE user_id = $1", [user.id]);
    const tudo = rows.map((r) => r.code_hash).join(" ");
    for (const c of codigos) expect(tudo).not.toContain(c.replace("-", ""));
  });
});

describe("Segunda etapa do login", () => {
  it("a senha sozinha não abre a conta", async () => {
    const user = await createUser();
    await com2fa(user);
    const { agent, destino } = await primeiraEtapa(user);
    expect(destino).toBe("/login/2fa");
    expect((await agent.get("/minhas-reservas")).status).toBe(302);
  });

  it("código certo entra e leva ao destino pedido", async () => {
    const user = await createUser();
    const { segredo } = await com2fa(user);
    const { agent } = await primeiraEtapa(user, "/minhas-reservas");
    expect(await enviarCodigo(agent, authenticator.generate(segredo))).toBe("/minhas-reservas");
    expect((await agent.get("/minhas-reservas")).status).toBe(200);
  });

  it("recusa reusar um código já aceito", async () => {
    const user = await createUser();
    const { segredo } = await com2fa(user);
    const codigo = authenticator.generate(segredo);
    const a = await primeiraEtapa(user);
    await enviarCodigo(a.agent, codigo);
    const b = await primeiraEtapa(user);
    expect(await enviarCodigo(b.agent, codigo)).toMatch(/já foi usado/);
  });

  it("após 5 erros exige a senha de novo", async () => {
    const user = await createUser();
    await com2fa(user);
    const { agent } = await primeiraEtapa(user);
    let ultimo;
    for (let i = 0; i < 5; i++) ultimo = await enviarCodigo(agent, "000000");
    expect(ultimo).toMatch(/^\/login\?error=.*Muitas tentativas/);
    expect((await agent.get("/login/2fa")).headers.location).toMatch(/expirou/);
  });

  it("a etapa pendente expira em 5 minutos", async () => {
    const user = await createUser();
    await com2fa(user);
    const { agent } = await primeiraEtapa(user);
    const agora = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(agora + 6 * 60 * 1000);
    expect((await agent.get("/login/2fa")).headers.location).toMatch(/expirou/);
  });

  it("não há como pular para a segunda etapa sem a senha", async () => {
    const res = await request(app).get("/login/2fa");
    expect(res.headers.location).toMatch(/^\/login/);
  });

  it("código de recuperação funciona uma única vez", async () => {
    const user = await createUser();
    const { codigos } = await com2fa(user);
    const a = await primeiraEtapa(user);
    expect(await enviarCodigo(a.agent, codigos[0])).toBe("/");
    const b = await primeiraEtapa(user);
    expect(await enviarCodigo(b.agent, codigos[0])).toMatch(/incorreto/);
    expect((await twoFactor.statusDe(user.id)).recuperacaoRestantes).toBe(9);
  });

  it("aceita o código de recuperação sem hífen e em minúsculas", async () => {
    const user = await createUser();
    const { codigos } = await com2fa(user);
    const { agent } = await primeiraEtapa(user);
    expect(await enviarCodigo(agent, codigos[1].replace("-", "").toLowerCase())).toBe("/");
  });
});

describe("Exigência para administradores", () => {
  beforeEach(() => { process.env.REQUIRE_ADMIN_2FA = "true"; });

  it("admin sem 2FA não entra no painel (página e API)", async () => {
    const admin = await createUser({ email: "chefe@aquatrip.local", role: "ADMIN" });
    const { agent } = await loginAs(admin);
    const pg = await agent.get("/admin");
    expect(pg.status).toBe(302);
    expect(pg.headers.location).toContain("/conta/2fa");
    const api = await agent.get("/api/admin/painel");
    expect(api.status).toBe(403);
    expect(api.body.codigo).toBe("MFA_REQUIRED");
  });

  it("depois de ativar, a mesma sessão entra", async () => {
    const admin = await createUser({ email: "chefe@aquatrip.local", role: "ADMIN" });
    const { agent } = await loginAs(admin);
    const pg = await agent.get("/conta/2fa");
    const segredo = pg.text.match(/class="secret-key">([^<]+)</)[1].replace(/\s/g, "");
    const r = await agent.post("/conta/2fa/ativar").type("form").send({
      codigo: authenticator.generate(segredo), senha: admin.password, _csrf: extractCsrf(pg.text),
    });
    expect(r.text).toContain("Guarde seus códigos de recuperação");
    expect((r.text.match(/<li><code>/g) || [])).toHaveLength(10);
    expect((await agent.get("/admin")).status).toBe(200);
  });

  it("ativar derruba as outras sessões abertas sem segundo fator", async () => {
    const admin = await createUser({ email: "chefe@aquatrip.local", role: "ADMIN" });
    const { agent: outro } = await loginAs(admin);
    const { agent } = await loginAs(admin);
    const pg = await agent.get("/conta/2fa");
    const segredo = pg.text.match(/class="secret-key">([^<]+)</)[1].replace(/\s/g, "");
    await agent.post("/conta/2fa/ativar").type("form").send({
      codigo: authenticator.generate(segredo), senha: admin.password, _csrf: extractCsrf(pg.text),
    });
    expect((await outro.get("/perfil_editado")).status).toBe(302);
  });

  it("admin não pode desativar", async () => {
    const admin = await createUser({ email: "chefe@aquatrip.local", role: "ADMIN" });
    const { segredo } = await com2fa(admin);
    const { agent } = await primeiraEtapa(admin);
    await enviarCodigo(agent, authenticator.generate(segredo));
    await db.query("UPDATE users SET totp_last_step = NULL WHERE id = $1", [admin.id]);
    const pg = await agent.get("/conta/2fa");
    const r = await agent.post("/conta/2fa/desativar").type("form").send({
      codigo: authenticator.generate(segredo), senha: admin.password, _csrf: extractCsrf(pg.text),
    });
    expect(decodeURIComponent(r.headers.location)).toMatch(/obrigatória/);
    expect((await twoFactor.statusDe(admin.id)).ativo).toBe(true);
  });

  it("usuário comum não é obrigado", async () => {
    const u = await createUser();
    const { agent } = await loginAs(u);
    expect((await agent.get("/minhas-reservas")).status).toBe(200);
  });
});

describe("Configuração", () => {
  it("recusa ativar com código ou senha errados", async () => {
    const u = await createUser();
    const { agent } = await loginAs(u);
    let pg = await agent.get("/conta/2fa");
    const segredo = pg.text.match(/class="secret-key">([^<]+)</)[1].replace(/\s/g, "");
    let r = await agent.post("/conta/2fa/ativar").type("form").send({ codigo: "000000", senha: u.password, _csrf: extractCsrf(pg.text) });
    expect(decodeURIComponent(r.headers.location)).toMatch(/incorreto/);
    pg = await agent.get("/conta/2fa");
    r = await agent.post("/conta/2fa/ativar").type("form")
      .send({ codigo: authenticator.generate(segredo), senha: "errada", _csrf: extractCsrf(pg.text) });
    expect(decodeURIComponent(r.headers.location)).toMatch(/Senha incorreta/);
    expect((await twoFactor.statusDe(u.id)).ativo).toBe(false);
  });

  it("usuário comum desativa com código e senha", async () => {
    const u = await createUser();
    const { segredo } = await com2fa(u);
    const { agent } = await primeiraEtapa(u);
    await enviarCodigo(agent, authenticator.generate(segredo));
    await db.query("UPDATE users SET totp_last_step = NULL WHERE id = $1", [u.id]);
    const pg = await agent.get("/conta/2fa");
    await agent.post("/conta/2fa/desativar").type("form")
      .send({ codigo: authenticator.generate(segredo), senha: u.password, _csrf: extractCsrf(pg.text) });
    expect((await twoFactor.statusDe(u.id)).ativo).toBe(false);
    expect((await db.query("SELECT 1 FROM recovery_codes WHERE user_id = $1", [u.id])).rows).toHaveLength(0);
  });
});

describe("Redefinição por outro administrador", () => {
  it("redefine o de outra pessoa, derruba as sessões e registra", async () => {
    const alvo = await createUser({ email: "perdeu@aquatrip.local" });
    await com2fa(alvo);
    const admin = await createUser({ email: "chefe@aquatrip.local", role: "ADMIN" });
    const { agent, csrf } = await loginAs(admin);
    const r = await agent.post(`/api/admin/usuarios/${alvo.id}/2fa/redefinir`).set("X-CSRF-Token", csrf);
    expect(r.status).toBe(200);
    expect((await twoFactor.statusDe(alvo.id)).ativo).toBe(false);
    const { rows } = await db.query("SELECT 1 FROM audit_log WHERE action = 'MFA_RESET_BY_ADMIN'");
    expect(rows).toHaveLength(1);
  });

  it("ninguém redefine o próprio 2FA pelo painel", async () => {
    const admin = await createUser({ email: "chefe@aquatrip.local", role: "ADMIN" });
    const { segredo } = await com2fa(admin);
    // Com 2FA ativo, o login só termina depois do código.
    const { agent } = await primeiraEtapa(admin);
    expect(await enviarCodigo(agent, authenticator.generate(segredo))).toBe("/");
    const csrf = extractCsrf((await agent.get("/")).text);
    const r = await agent.post(`/api/admin/usuarios/${admin.id}/2fa/redefinir`).set("X-CSRF-Token", csrf);
    expect(r.body.codigo).toBe("SELF_RESET");
    expect((await twoFactor.statusDe(admin.id)).ativo).toBe(true);
  });
});

describe("Auditoria", () => {
  it("registra desafio, falha e sucesso — sem gravar códigos", async () => {
    const user = await createUser();
    const { segredo } = await com2fa(user);
    const codigo = authenticator.generate(segredo);
    const { agent } = await primeiraEtapa(user);
    await enviarCodigo(agent, "111111");
    await enviarCodigo(agent, codigo);
    const { rows } = await db.query("SELECT action, CAST(metadata AS CHAR) AS m FROM audit_log ORDER BY id");
    const acoes = rows.map((r) => r.action);
    expect(acoes).toEqual(expect.arrayContaining(["MFA_CHALLENGED", "MFA_FAILED", "LOGIN_SUCCESS"]));
    const tudo = rows.map((r) => r.m).join(" ");
    expect(tudo).not.toContain(codigo);
    expect(tudo).not.toContain(segredo);
  });
});

/* ==============================================================
   Lacunas encontradas na auditoria desta implementação
   ============================================================== */
const { spawnSync } = require("child_process");
const recoveryService = require("../app/services/accountRecoveryService");

describe("Redefinir a senha não pula o 2FA", () => {
  it("depois de trocar a senha pelo e-mail, o login ainda pede o segundo fator", async () => {
    const user = await createUser({ email: "reset2fa@aquatrip.local", password: "SenhaAntiga123!" });
    await com2fa(user);

    // Quem roubou o e-mail consegue trocar a senha...
    const { token } = await recoveryService.requestPasswordReset({ email: user.email });
    await recoveryService.resetPassword({ token, newPassword: "SenhaDoInvasor456!" });

    // ...mas não entra: continua parado na segunda etapa.
    const { agent, destino } = await primeiraEtapa({ email: user.email, password: "SenhaDoInvasor456!" });
    expect(destino).toContain("/login/2fa");
    expect((await agent.get("/perfil_editado")).status).toBe(302);
  });
});

describe("Chave de cifragem validada na subida", () => {
  const original = process.env.TOTP_ENCRYPTION_KEY;
  afterEach(() => { process.env.TOTP_ENCRYPTION_KEY = original; });

  it("aceita a chave de 32 bytes configurada", () => {
    expect(twoFactor.validarConfiguracao()).toBe(true);
  });

  it("recusa chave em formato errado", () => {
    process.env.TOTP_ENCRYPTION_KEY = "abcdef";
    expect(() => twoFactor.validarConfiguracao()).toThrow(/32 bytes/);
  });

  it("o servidor recusa subir em produção sem chave", () => {
    const r = spawnSync(process.execPath, ["server.js"], {
      env: { ...process.env, NODE_ENV: "production", TOTP_ENCRYPTION_KEY: "", PORT: "0", LOG_LEVEL: "fatal" },
      timeout: 15000, encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/2FA inválida/);
  });
});

describe("Acesso de emergência (script no servidor)", () => {
  function rodar(...args) {
    return spawnSync(process.execPath, ["scripts/redefinir-2fa.js", ...args], {
      env: { ...process.env }, timeout: 20000, encoding: "utf8",
    });
  }

  it("simula por padrão: nada muda sem --confirmar", async () => {
    const admin = await createUser({ email: "unico@aquatrip.local", role: "ADMIN" });
    await com2fa(admin);
    const r = rodar("unico@aquatrip.local");
    expect(r.stdout).toContain("SIMULAÇÃO");
    const { rows } = await db.query("SELECT totp_enabled_at FROM users WHERE id = $1", [admin.id]);
    expect(rows[0].totp_enabled_at).not.toBeNull();
  });

  it("com --confirmar remove 2FA, códigos e sessões, e registra na auditoria", async () => {
    const admin = await createUser({ email: "perdeu@aquatrip.local", role: "ADMIN" });
    await com2fa(admin);
    const r = rodar("perdeu@aquatrip.local", "--confirmar");
    expect(r.stdout).toContain("Feito.");

    const { rows: [u] } = await db.query("SELECT totp_secret_enc, totp_enabled_at FROM users WHERE id = $1", [admin.id]);
    expect(u.totp_secret_enc).toBeNull();
    expect(u.totp_enabled_at).toBeNull();
    expect((await db.query("SELECT 1 FROM recovery_codes WHERE user_id = $1", [admin.id])).rows).toHaveLength(0);

    const { rows: aud } = await db.query("SELECT metadata FROM audit_log WHERE action = 'MFA_RESET_BY_SERVER'");
    expect(aud).toHaveLength(1);
    expect(aud[0].metadata.origem).toBe("script no servidor");
    expect(aud[0].metadata.usuarioDoSistema).toBeTruthy();
  });

  it("e-mail inexistente não altera nada", () => {
    const r = rodar("ninguem@aquatrip.local", "--confirmar");
    expect(r.stdout).toContain("Nenhuma conta");
    expect(r.status).toBe(1);
  });
});
