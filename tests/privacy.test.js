/* ==============================================================
   Testes — LGPD: consentimento e direitos do titular
   ============================================================== */
const request = require("supertest");
const {
  app,
  db,
  resetDatabase,
  truncateTables,
  createUser,
  createServiceWithSlot,
  extractCsrf,
  loginAs,
  freshCsrf,
} = require("./helpers");
const consentService = require("../app/services/consentService");
const dataRightsService = require("../app/services/dataRightsService");
const bookingService = require("../app/services/bookingService");

beforeEach(async () => {
  await resetDatabase();
  await truncateTables("consent_records", "data_requests");
});

describe("Páginas legais", () => {
  it("Termos e Política são públicos (sem login)", async () => {
    const termos = await request(app).get("/termos-de-uso");
    const politica = await request(app).get("/politica-de-privacidade");

    expect(termos.status).toBe(200);
    expect(termos.text).toContain("Termos de Uso");
    expect(politica.status).toBe(200);
    expect(politica.text).toContain("Política de Privacidade");
  });

  it("a política informa as bases legais e o prazo de retenção", async () => {
    const res = await request(app).get("/politica-de-privacidade");
    expect(res.text).toMatch(/base legal/i);
    expect(res.text).toMatch(/Execução de contrato/i);
    expect(res.text).toMatch(/Marco Civil/i);
  });

  it("deixa claro que dados de cartão não são armazenados", async () => {
    const res = await request(app).get("/politica-de-privacidade");
    expect(res.text).toMatch(/não trafegam pelo AquaTrip|nunca passam pelos nossos servidores/i);
  });

  it("não sobrou link placeholder no banner de consentimento", async () => {
    const res = await request(app).get("/");
    const banner = res.text.slice(res.text.indexOf("cmpBanner"));
    expect(banner).toContain("/politica-de-privacidade");
    expect(banner).toContain("/termos-de-uso");
  });
});

describe("Registro de consentimento", () => {
  it("grava a decisão de um visitante anônimo no servidor", async () => {
    const agent = request.agent(app);

    const res = await agent
      .post("/api/consentimento")
      .send({ analytics: false, marketing: false, action: "reject_non_essential" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const { rows } = await db.query("SELECT * FROM consent_records");
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("reject_non_essential");
    expect(rows[0].necessary).toBe(true); // base legal diferente, sempre true
    expect(rows[0].analytics).toBe(false);
    expect(rows[0].visitor_id).toBeTruthy();
    expect(rows[0].user_id).toBeNull();
  });

  it("vincula ao titular quando há sessão", async () => {
    const user = await createUser({ email: "consent@aquatrip.local" });
    const { agent } = await loginAs(user);

    await agent
      .post("/api/consentimento")
      .send({ analytics: true, marketing: true, action: "accept_all" });

    const { rows } = await db.query("SELECT * FROM consent_records");
    expect(rows[0].user_id).toBe(user.id);
    expect(rows[0].analytics).toBe(true);
  });

  it("guarda a versão da política vigente", async () => {
    const agent = request.agent(app);
    await agent.post("/api/consentimento").send({ action: "accept_all", analytics: true });

    const { rows } = await db.query("SELECT policy_version FROM consent_records");
    expect(rows[0].policy_version).toBe(consentService.POLICY_VERSION);
  });

  it("minimiza o IP antes de gravar (art. 6º, III)", async () => {
    expect(consentService.minimizarIp("203.0.113.45")).toBe("203.0.113.0");
    expect(consentService.minimizarIp("::ffff:198.51.100.7")).toBe("198.51.100.0");
    expect(consentService.minimizarIp(null)).toBeNull();

    const agent = request.agent(app);
    await agent.post("/api/consentimento").send({ action: "accept_all" });

    const { rows } = await db.query("SELECT ip_address FROM consent_records");
    // IPv4 minimizado termina sempre em .0 (último octeto descartado)
    expect(rows[0].ip_address).toMatch(/\.0$|::$/);
  });

  it("recusa payload inválido", async () => {
    const agent = request.agent(app);
    const res = await agent.post("/api/consentimento").send({ action: "qualquer_coisa" });
    expect(res.status).toBe(400);

    const { rows } = await db.query("SELECT 1 FROM consent_records");
    expect(rows).toHaveLength(0);
  });

  it("mantém histórico: cada decisão é uma linha nova", async () => {
    const user = await createUser({ email: "hist@aquatrip.local" });
    const { agent } = await loginAs(user);

    await agent.post("/api/consentimento").send({ action: "accept_all", analytics: true, marketing: true });
    await agent.post("/api/consentimento").send({ action: "withdrawn", analytics: false, marketing: false });

    const { rows } = await db.query("SELECT action FROM consent_records ORDER BY created_at");
    expect(rows).toHaveLength(2);
    expect(rows[0].action).toBe("accept_all");
    expect(rows[1].action).toBe("withdrawn");
  });
});

describe("Consulta de consentimento", () => {
  it("diz que precisa decidir quando não há registro", async () => {
    const res = await request(app).get("/api/consentimento");
    expect(res.body.precisaDecidir).toBe(true);
    expect(res.body.consentimento).toBeNull();
  });

  it("devolve a decisão após registrada", async () => {
    const agent = request.agent(app);
    await agent.post("/api/consentimento").send({ action: "custom", analytics: true, marketing: false });

    const res = await agent.get("/api/consentimento");
    expect(res.body.precisaDecidir).toBe(false);
    expect(res.body.consentimento.analytics).toBe(true);
    expect(res.body.consentimento.marketing).toBe(false);
  });

  it("revogação faz voltar a pedir consentimento", async () => {
    const agent = request.agent(app);
    await agent.post("/api/consentimento").send({ action: "accept_all", analytics: true });
    await agent.post("/api/consentimento").send({ action: "withdrawn", analytics: false });

    const res = await agent.get("/api/consentimento");
    expect(res.body.precisaDecidir).toBe(true);
  });
});

describe("Central de Privacidade", () => {
  it("exige login", async () => {
    const res = await request(app).get("/configuracoes/privacidade");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("/login");
  });

  it("mostra o histórico do titular", async () => {
    const user = await createUser({ email: "central@aquatrip.local" });
    const { agent } = await loginAs(user);
    await agent.post("/api/consentimento").send({ action: "accept_all", analytics: true, marketing: true });

    const res = await agent.get("/configuracoes/privacidade");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Histórico de consentimento");
    expect(res.text).toContain("Aceitou tudo");
  });
});

describe("Exportação de dados (arts. 18, II e V)", () => {
  it("entrega um JSON com os dados do titular", async () => {
    const user = await createUser({ email: "export@aquatrip.local" });
    const { slot } = await createServiceWithSlot({ priceCents: 18000 });
    await bookingService.createBooking({ userId: user.id, slotId: slot.id, quantity: 2 });

    const { agent } = await loginAs(user);
    const res = await agent.get("/configuracoes/privacidade/exportar");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");

    const dados = JSON.parse(res.text);
    expect(dados.perfil.email).toBe(user.email);
    expect(dados.reservas).toHaveLength(1);
    expect(dados.reservas[0].amount_cents).toBe(36000);
    expect(dados._sobre.versao_politica_privacidade).toBe(consentService.POLICY_VERSION);
  });

  it("não inclui hash de senha nem credenciais", async () => {
    const user = await createUser({ email: "semcred@aquatrip.local" });
    const dados = await dataRightsService.exportUserData(user.id);
    const texto = JSON.stringify(dados);

    expect(texto).not.toContain("password_hash");
    expect(texto).not.toContain("$argon2");
    expect(dados.perfil.password_hash).toBeUndefined();
  });

  it("um titular não exporta os dados de outro", async () => {
    const dono = await createUser({ email: "dono2@aquatrip.local" });
    const { slot } = await createServiceWithSlot();
    await bookingService.createBooking({ userId: dono.id, slotId: slot.id, quantity: 1 });

    const intruso = await createUser({ email: "intruso9@aquatrip.local" });
    const { agent } = await loginAs(intruso);

    const res = await agent.get("/configuracoes/privacidade/exportar");
    const dados = JSON.parse(res.text);

    expect(dados.perfil.email).toBe(intruso.email);
    expect(dados.reservas).toHaveLength(0);
    expect(res.text).not.toContain(dono.email);
  });
});

describe("Solicitações do titular (art. 18)", () => {
  it("registra pedido de eliminação", async () => {
    const user = await createUser({ email: "delete@aquatrip.local" });
    const { agent } = await loginAs(user);
    const csrf = await freshCsrf(agent, "/configuracoes/privacidade");

    const res = await agent
      .post("/configuracoes/privacidade/solicitacao")
      .type("form")
      .send({ kind: "DELETION", details: "Quero excluir minha conta", _csrf: csrf });

    expect(res.status).toBe(302);

    const { rows } = await db.query("SELECT * FROM data_requests WHERE user_id = $1", [user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("DELETION");
    expect(rows[0].status).toBe("OPEN");
  });

  it("exige CSRF", async () => {
    const user = await createUser({ email: "csrflgpd@aquatrip.local" });
    const { agent } = await loginAs(user);

    const res = await agent
      .post("/configuracoes/privacidade/solicitacao")
      .type("form")
      .send({ kind: "DELETION" });

    expect(res.status).toBe(403);
    const { rows } = await db.query("SELECT 1 FROM data_requests");
    expect(rows).toHaveLength(0);
  });

  it("recusa tipo inválido", async () => {
    const user = await createUser({ email: "tipo@aquatrip.local" });
    const { agent } = await loginAs(user);
    const csrf = await freshCsrf(agent, "/configuracoes/privacidade");

    await agent
      .post("/configuracoes/privacidade/solicitacao")
      .type("form")
      .send({ kind: "APAGAR_TUDO", _csrf: csrf });

    const { rows } = await db.query("SELECT 1 FROM data_requests");
    expect(rows).toHaveLength(0);
  });
});

describe("Auditoria da privacidade", () => {
  it("registra mudança de consentimento e exportação", async () => {
    const user = await createUser({ email: "auditlgpd@aquatrip.local" });
    const { agent } = await loginAs(user);

    await agent.post("/api/consentimento").send({ action: "accept_all", analytics: true });
    await agent.get("/configuracoes/privacidade/exportar");

    const { rows } = await db.query(
      "SELECT action FROM audit_log WHERE action IN ('CONSENT_CHANGED','DATA_EXPORTED')"
    );
    const acoes = rows.map((r) => r.action);
    expect(acoes).toContain("CONSENT_CHANGED");
    expect(acoes).toContain("DATA_EXPORTED");
  });
});

describe("Terceiros antes do consentimento", () => {
  it("não carrega script de domínio externo", async () => {
    const res = await request(app).get("/");
    expect(res.text).not.toContain("unpkg.com");
    expect(res.text).toContain("/vendor/lucide.min.js");
  });

  it("não carrega fonte de domínio externo", async () => {
    const res = await request(app).get("/");
    expect(res.text).not.toContain("fonts.googleapis.com");
    expect(res.text).not.toContain("fonts.gstatic.com");
    expect(res.text).toContain("/css/fonts.css");
  });

  it("a CSP não autoriza fonte nem estilo de terceiros", async () => {
    const res = await request(app).get("/");
    const csp = res.headers["content-security-policy"];
    expect(csp).not.toContain("googleapis");
    expect(csp).not.toContain("gstatic");
    expect(csp).toMatch(/font-src 'self'(;|$)/);
  });

  it("a CSP não autoriza script de terceiros", async () => {
    const res = await request(app).get("/");
    const csp = res.headers["content-security-policy"];
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unpkg.com");
  });
});
