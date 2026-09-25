/* ==============================================================
   Testes — contato e atendimento (LGPD)
   ============================================================== */
const request = require("supertest");
const fs = require("fs");
const crypto = require("crypto");
const { app, db, resetDatabase, truncateTables, createUser, createServiceWithSlot, extractCsrf, loginAs } = require("./helpers");
const bookingService = require("../app/services/bookingService");
const dataRightsService = require("../app/services/dataRightsService");
const mailService = require("../app/services/mailService");

beforeEach(async () => {
  await resetDatabase();
  await truncateTables("contact_messages", "data_requests", "trips", "consent_records");
  fs.rmSync(mailService.MAIL_DIR, { recursive: true, force: true });
});

function emailsGerados(template) {
  if (!fs.existsSync(mailService.MAIL_DIR)) return [];
  return fs.readdirSync(mailService.MAIL_DIR)
    .filter((f) => f.includes(template))
    .map((f) => fs.readFileSync(`${mailService.MAIL_DIR}/${f}`, "utf8"));
}

async function paginaDeContato() {
  const agent = request.agent(app);
  const html = (await agent.get("/contato")).text;
  const csrf = html.match(/name="csrf-token" content="([^"]+)"/)[1];
  return { agent, csrf };
}

const contatoValido = {
  nome: "Marina Costa", email: "marina@exemplo.com.br", empresa: "Mergulho Bonito",
  regiao: "Bonito, MS", descricao: "Temos três roteiros e queremos anunciar.", site: "",
};

describe("Formulário de contato", () => {
  it("grava a mensagem (antes ia para uma rota inexistente)", async () => {
    const { agent, csrf } = await paginaDeContato();
    const res = await agent.post("/contato").set("X-CSRF-Token", csrf).send(contatoValido);
    expect(res.status).toBe(200);
    expect(res.body.sucesso).toBe(true);

    const { rows } = await db.query("SELECT * FROM contact_messages");
    expect(rows).toHaveLength(1);
    expect(rows[0].company).toBe("Mergulho Bonito");
    expect(rows[0].status).toBe("NEW");
    expect(rows[0].ip_address).toMatch(/\.0$|::$/); // IP minimizado
  });

  it("devolve erro por campo no formato que o formulário exibe", async () => {
    const { agent, csrf } = await paginaDeContato();
    const res = await agent.post("/contato").set("X-CSRF-Token", csrf)
      .send({ nome: "M", email: "x", descricao: "curto" });
    expect(res.status).toBe(422);
    expect(res.body.sucesso).toBe(false);
    expect(Object.keys(res.body.erros)).toEqual(expect.arrayContaining(["nome", "email", "descricao"]));
  });

  it("descarta robô que preenche o honeypot, sem avisá-lo", async () => {
    const { agent, csrf } = await paginaDeContato();
    const res = await agent.post("/contato").set("X-CSRF-Token", csrf)
      .send({ ...contatoValido, site: "http://spam.example" });
    expect(res.body.sucesso).toBe(true);
    const { rows } = await db.query("SELECT 1 FROM contact_messages");
    expect(rows).toHaveLength(0);
  });

  it("exige CSRF e responde JSON (o formulário espera JSON)", async () => {
    const res = await request(app).post("/contato").send(contatoValido);
    expect(res.status).toBe(403);
    expect(res.headers["content-type"]).toMatch(/json/);
  });
});

async function comoAdmin() {
  const admin = await createUser({ email: "chefe@aquatrip.local", role: "ADMIN" });
  const { agent, csrf } = await loginAs(admin);
  return { admin, agent, csrf };
}

describe("Caixa de atendimento", () => {
  it("só o admin acessa", async () => {
    expect((await request(app).get("/api/admin/atendimento")).status).toBe(401);
    const u = await createUser({ email: "comum@aquatrip.local" });
    const { agent } = await loginAs(u);
    expect((await agent.get("/api/admin/atendimento")).status).toBe(403);
  });

  it("lista contatos e solicitações com contadores e prazo", async () => {
    const { agent: pub, csrf: cpub } = await paginaDeContato();
    await pub.post("/contato").set("X-CSRF-Token", cpub).send(contatoValido);
    const titular = await createUser({ email: "titular@aquatrip.local" });
    await dataRightsService.createRequest({ userId: titular.id, kind: "CORRECTION", details: "Nome errado", req: null });

    const { agent } = await comoAdmin();
    const res = await agent.get("/api/admin/atendimento");
    expect(res.body.contadores).toMatchObject({ contatos_novos: 1, lgpd_abertas: 1, lgpd_atrasadas: 0 });
    expect(res.body.solicitacoes[0].dias_restantes).toBeGreaterThanOrEqual(14);
  });

  it("aponta solicitação atrasada (mais de 15 dias)", async () => {
    const titular = await createUser({ email: "esperando@aquatrip.local" });
    const r = await dataRightsService.createRequest({ userId: titular.id, kind: "ACCESS", req: null });
    await db.query("UPDATE data_requests SET created_at = NOW() - INTERVAL 20 DAY WHERE id = $1", [r.id]);

    const { agent } = await comoAdmin();
    const res = await agent.get("/api/admin/atendimento");
    expect(res.body.contadores.lgpd_atrasadas).toBe(1);
    expect(res.body.solicitacoes[0].dias_restantes).toBeLessThan(0);
  });

  it("marca contato como lido e arquiva", async () => {
    const { agent: pub, csrf: cpub } = await paginaDeContato();
    await pub.post("/contato").set("X-CSRF-Token", cpub).send(contatoValido);
    const { rows } = await db.query("SELECT id FROM contact_messages");

    const { agent, csrf } = await comoAdmin();
    const lida = await agent.post(`/api/admin/contatos/${rows[0].id}/status`).set("X-CSRF-Token", csrf).send({ status: "READ" });
    expect(lida.status).toBe(200);
    expect(lida.body.contato.read_at).not.toBeNull();
    const arq = await agent.post(`/api/admin/contatos/${rows[0].id}/status`).set("X-CSRF-Token", csrf).send({ status: "ARCHIVED" });
    expect(arq.body.contato.status).toBe("ARCHIVED");
  });
});

describe("Responder solicitação LGPD", () => {
  async function pedido(kind, email = "titular@aquatrip.local") {
    const titular = await createUser({ email, name: "Titular Teste" });
    const r = await dataRightsService.createRequest({ userId: titular.id, kind, details: "detalhe", req: null });
    return { titular, pedidoId: r.id };
  }

  it("conclui, grava quem atendeu e avisa o titular por e-mail", async () => {
    const { pedidoId } = await pedido("CORRECTION");
    const { admin, agent, csrf } = await comoAdmin();

    const res = await agent.post(`/api/admin/solicitacoes/${pedidoId}`).set("X-CSRF-Token", csrf)
      .send({ status: "DONE", resposta: "Nome corrigido para Titular Teste." });
    expect(res.status).toBe(200);

    const { rows } = await db.query("SELECT status, response, handled_by, resolved_at FROM data_requests WHERE id = $1", [pedidoId]);
    expect(rows[0]).toMatchObject({ status: "DONE", response: "Nome corrigido para Titular Teste.", handled_by: admin.id });
    expect(rows[0].resolved_at).not.toBeNull();

    const mails = emailsGerados("lgpd_resposta");
    expect(mails).toHaveLength(1);
    expect(mails[0]).toContain("titular@aquatrip.local");
    expect(mails[0]).toContain("Nome corrigido");
  });

  it("não encerra sem resposta escrita (recusa precisa ser fundamentada)", async () => {
    const { pedidoId } = await pedido("DELETION");
    const { agent, csrf } = await comoAdmin();
    const res = await agent.post(`/api/admin/solicitacoes/${pedidoId}`).set("X-CSRF-Token", csrf).send({ status: "REJECTED" });
    expect(res.body.codigo).toBe("RESPONSE_REQUIRED");
  });

  it("não reabre solicitação encerrada", async () => {
    const { pedidoId } = await pedido("ACCESS");
    const { agent, csrf } = await comoAdmin();
    await agent.post(`/api/admin/solicitacoes/${pedidoId}`).set("X-CSRF-Token", csrf).send({ status: "DONE", resposta: "ok" });
    const again = await agent.post(`/api/admin/solicitacoes/${pedidoId}`).set("X-CSRF-Token", csrf).send({ status: "DONE", resposta: "de novo" });
    expect(again.status).toBe(409);
  });

  it("o titular vê a resposta na Central de Privacidade", async () => {
    const { titular, pedidoId } = await pedido("CORRECTION");
    const { agent, csrf } = await comoAdmin();
    await agent.post(`/api/admin/solicitacoes/${pedidoId}`).set("X-CSRF-Token", csrf)
      .send({ status: "DONE", resposta: "Dados corrigidos conforme pedido." });

    const { agent: ag } = await loginAs(titular);
    const pagina = await ag.get("/configuracoes/privacidade");
    expect(pagina.text).toContain("Dados corrigidos conforme pedido.");
    expect(pagina.text).toContain("Concluída");
  });
});

describe("Anonimização", () => {
  async function titularComHistorico() {
    const titular = await createUser({ email: "sair@aquatrip.local", name: "Pessoa Que Sai", password: "SenhaDela123!" });
    // Reserva paga no passado: precisa sobreviver (guarda fiscal).
    const { slot } = await createServiceWithSlot({ priceCents: 20000 });
    const booking = await bookingService.createBooking({ userId: titular.id, slotId: slot.id, quantity: 1 });
    await bookingService.startPayment({
      bookingId: booking.id, user: { id: titular.id, role: "USER", email: titular.email, name: titular.name },
      method: "CREDIT_CARD", cardLastFour: "4242",
    });
    await db.query("UPDATE service_slots SET starts_at = NOW() - INTERVAL 10 DAY WHERE id = $1", [slot.id]);
    await db.query(`INSERT INTO trips (id, user_id, place) VALUES ($1, $2, 'Bonito')`, [crypto.randomUUID(), titular.id]);
    await db.query(
      `INSERT INTO reviews (id, booking_id, user_id, service_id, rating, body)
       SELECT $1, $2, $3, s.service_id, 5, 'Fui com meu marido Carlos, adoramos' FROM bookings b
       JOIN service_slots s ON s.id = b.slot_id WHERE b.id = $4`,
      [crypto.randomUUID(), booking.id, titular.id, booking.id]
    );
    await db.query(
      `INSERT INTO audit_log (user_id, action, metadata) VALUES ($1, 'LOGIN_SUCCESS', '{"email":"sair@aquatrip.local"}')`,
      [titular.id]
    );
    const r = await dataRightsService.createRequest({ userId: titular.id, kind: "DELETION", req: null });
    return { titular, pedidoId: r.id, bookingId: booking.id };
  }

  it("remove a identidade, mantém o pagamento e impede o login", async () => {
    const { titular, pedidoId, bookingId } = await titularComHistorico();
    const { agent, csrf } = await comoAdmin();

    const res = await agent.post(`/api/admin/solicitacoes/${pedidoId}`).set("X-CSRF-Token", csrf)
      .send({ status: "DONE", resposta: "Conta anonimizada.", anonimizar: true });
    expect(res.status).toBe(200);

    const { rows: [u] } = await db.query("SELECT * FROM users WHERE id = $1", [titular.id]);
    expect(u.name).toBe("Titular anonimizado");
    expect(u.email).toMatch(/@anonimizado\.invalid$/);
    expect(u.anonymized_at).not.toBeNull();
    expect(u.status).toBe("SUSPENDED");

    // Guarda fiscal: reserva e pagamento continuam.
    const { rows: pag } = await db.query("SELECT status FROM payments WHERE booking_id = $1", [bookingId]);
    expect(pag[0].status).toBe("APPROVED");

    // Conteúdo pessoal sem obrigação de guarda: apagado — inclusive a
    // avaliação, cujo texto livre pode identificar a pessoa.
    expect((await db.query("SELECT 1 FROM trips WHERE user_id = $1", [titular.id])).rows).toHaveLength(0);
    expect((await db.query("SELECT 1 FROM reviews WHERE user_id = $1", [titular.id])).rows).toHaveLength(0);

    // O e-mail não sobrevive na auditoria.
    const { rows: aud } = await db.query("SELECT CAST(metadata AS CHAR) AS m FROM audit_log");
    expect(aud.map((a) => a.m).join(" ")).not.toContain("sair@aquatrip.local");

    // Nem com a senha antiga, nem com o e-mail antigo.
    const nova = request.agent(app);
    const pg = await nova.get("/login");
    const login = await nova.post("/login").type("form")
      .send({ email: "sair@aquatrip.local", senha: "SenhaDela123!", _csrf: extractCsrf(pg.text) });
    expect(decodeURIComponent(login.headers.location)).toContain("E-mail ou senha inválidos");
  });

  it("envia a resposta ANTES de apagar o e-mail", async () => {
    const { pedidoId } = await titularComHistorico();
    const { agent, csrf } = await comoAdmin();
    await agent.post(`/api/admin/solicitacoes/${pedidoId}`).set("X-CSRF-Token", csrf)
      .send({ status: "DONE", resposta: "Feito.", anonimizar: true });
    const mails = emailsGerados("lgpd_resposta");
    expect(mails).toHaveLength(1);
    expect(mails[0]).toContain("sair@aquatrip.local");
    expect(mails[0]).toContain("último e-mail");
  });

  it("recusa anonimizar quem tem reserva futura", async () => {
    const titular = await createUser({ email: "vaiviajar@aquatrip.local" });
    const { slot } = await createServiceWithSlot();
    await bookingService.createBooking({ userId: titular.id, slotId: slot.id, quantity: 1 });
    const r = await dataRightsService.createRequest({ userId: titular.id, kind: "DELETION", req: null });

    const { agent, csrf } = await comoAdmin();
    const res = await agent.post(`/api/admin/solicitacoes/${r.id}`).set("X-CSRF-Token", csrf)
      .send({ status: "DONE", resposta: "x", anonimizar: true });
    expect(res.body.codigo).toBe("HAS_LIVE_BOOKINGS");

    const { rows } = await db.query("SELECT u.anonymized_at, d.status FROM data_requests d JOIN users u ON u.id = d.user_id WHERE d.id = $1", [r.id]);
    expect(rows[0].anonymized_at).toBeNull();
    expect(rows[0].status).toBe("OPEN"); // nada foi alterado
  });

  it("não anonimiza a partir de outro tipo de pedido", async () => {
    const titular = await createUser({ email: "sopediuacesso@aquatrip.local" });
    const r = await dataRightsService.createRequest({ userId: titular.id, kind: "ACCESS", req: null });
    const { agent, csrf } = await comoAdmin();
    const res = await agent.post(`/api/admin/solicitacoes/${r.id}`).set("X-CSRF-Token", csrf)
      .send({ status: "DONE", resposta: "x", anonimizar: true });
    expect(res.body.codigo).toBe("WRONG_KIND");
  });
});
