/* ==============================================================
   Testes — avaliações verificadas
   ============================================================== */
const request = require("supertest");
const { app, db, resetDatabase, createUser, createServiceWithSlot, loginAs } = require("./helpers");
const bookingService = require("../app/services/bookingService");
const reviewService = require("../app/services/reviewService");
const dataRightsService = require("../app/services/dataRightsService");

beforeEach(resetDatabase);

/** Reserva confirmada; `passada` move a data para trás. */
async function reserva({ email = "foi@aquatrip.local", name = "Lia Beatriz Souza", passada = true, confirmar = true, slug } = {}) {
  const user = await createUser({ email, name });
  const { slot, service } = await createServiceWithSlot(slug ? { slug, title: "Experiência " + slug } : {});
  const b = await bookingService.createBooking({ userId: user.id, slotId: slot.id, quantity: 1 });
  if (confirmar) {
    await bookingService.startPayment({
      bookingId: b.id, user: { id: user.id, role: "USER", email: user.email, name: user.name },
      method: "CREDIT_CARD", cardLastFour: "4242",
    });
  }
  if (passada) await db.query("UPDATE service_slots SET starts_at = NOW() - INTERVAL 2 DAY WHERE id = $1", [slot.id]);
  return { user, service, bookingId: b.id };
}

async function avaliar(agent, csrf, corpo) {
  return agent.post("/api/avaliacoes").set("X-CSRF-Token", csrf).send(corpo);
}

describe("Quem pode avaliar", () => {
  it("quem fez a experiência avalia", async () => {
    const { user, bookingId } = await reserva();
    const { agent, csrf } = await loginAs(user);
    const res = await avaliar(agent, csrf, { bookingId, nota: 5, titulo: "Incrível", texto: "Guia excelente." });
    expect(res.status).toBe(201);
    expect(res.body.redirecionar).toMatch(/#avaliacoes$/);
  });

  it("não avalia antes da data da experiência", async () => {
    const { user, bookingId } = await reserva({ passada: false });
    const { agent, csrf } = await loginAs(user);
    const res = await avaliar(agent, csrf, { bookingId, nota: 5 });
    expect(res.body.codigo).toBe("NOT_YET");
  });

  it("não avalia reserva que não foi paga", async () => {
    const { user, bookingId } = await reserva({ confirmar: false });
    const { agent, csrf } = await loginAs(user);
    const res = await avaliar(agent, csrf, { bookingId, nota: 5 });
    expect(res.body.codigo).toBe("NOT_CONFIRMED");
  });

  it("não avalia a reserva de outra pessoa (e não confirma que ela existe)", async () => {
    const { bookingId } = await reserva();
    const intruso = await createUser({ email: "intruso@aquatrip.local" });
    const { agent, csrf } = await loginAs(intruso);
    const res = await avaliar(agent, csrf, { bookingId, nota: 1, texto: "avaliação falsa" });
    expect(res.status).toBe(404);
    expect((await db.query("SELECT 1 FROM reviews")).rows).toHaveLength(0);
  });

  it("uma avaliação por reserva, mesmo com envio duplo simultâneo", async () => {
    const { user, bookingId } = await reserva();
    const { agent, csrf } = await loginAs(user);
    const [a, b] = await Promise.all([
      avaliar(agent, csrf, { bookingId, nota: 4 }),
      avaliar(agent, csrf, { bookingId, nota: 4 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await db.query("SELECT 1 FROM reviews")).rows).toHaveLength(1);
  });

  it("só a nota é obrigatória, e é validada", async () => {
    const { user, bookingId } = await reserva();
    const { agent, csrf } = await loginAs(user);
    expect((await avaliar(agent, csrf, { bookingId, nota: 0 })).status).toBe(422);
    expect((await avaliar(agent, csrf, { bookingId, nota: 6 })).status).toBe(422);
    expect((await avaliar(agent, csrf, { bookingId, nota: 3, texto: "x".repeat(801) })).status).toBe(422);
    expect((await avaliar(agent, csrf, { bookingId, nota: 3 })).status).toBe(201);
  });

  it("exige login e CSRF", async () => {
    const { user, bookingId } = await reserva();
    expect((await request(app).post("/api/avaliacoes").send({ bookingId, nota: 5 })).status).toBe(401);
    const { agent } = await loginAs(user);
    expect((await agent.post("/api/avaliacoes").send({ bookingId, nota: 5 })).status).toBe(403);
  });
});

describe("Exibição", () => {
  it("aparece na página da experiência, com média e nome abreviado", async () => {
    const { user, service, bookingId } = await reserva();
    const { agent, csrf } = await loginAs(user);
    await avaliar(agent, csrf, { bookingId, nota: 4, titulo: "Muito bom", texto: "Voltaria." });

    const html = (await request(app).get(`/reservar/${service.slug}`)).text;
    expect(html).toContain("Muito bom");
    expect(html).toContain("Lia S.");
    expect(html).not.toContain("Lia Beatriz Souza"); // nome completo não vaza
    expect(html).toMatch(/1 avaliação verificada/);
  });

  it("o catálogo mostra a nota real — e nada quando não há avaliação", async () => {
    const { user, bookingId } = await reserva({ slug: "com-nota" });
    const { agent, csrf } = await loginAs(user);
    await avaliar(agent, csrf, { bookingId, nota: 5 });

    const html = (await request(app).get("/mergulho")).text;
    expect(html).toMatch(/5,0/);
    expect(html).toMatch(/1 avaliação verificada/);
  });

  it("abrevia nomes corretamente", () => {
    expect(reviewService.nomeExibido("Lia Beatriz Souza")).toBe("Lia S.");
    expect(reviewService.nomeExibido("Madonna")).toBe("Madonna");
    expect(reviewService.nomeExibido("Titular anonimizado")).toBe("Viajante");
    expect(reviewService.nomeExibido("")).toBe("Viajante");
  });

  it("minhas reservas oferece 'Avaliar' só quando cabe", async () => {
    const { user, bookingId } = await reserva();
    const { agent, csrf } = await loginAs(user);
    expect((await agent.get("/minhas-reservas")).text).toContain(`/avaliacao/${bookingId}`);
    await avaliar(agent, csrf, { bookingId, nota: 5 });
    const depois = (await agent.get("/minhas-reservas")).text;
    expect(depois).not.toContain(`/avaliacao/${bookingId}`);
    expect(depois).toContain("Ver sua avaliação");
  });
});

describe("Autor e moderação", () => {
  it("o autor exclui a própria avaliação; outro usuário não", async () => {
    const { user, bookingId } = await reserva();
    const { agent, csrf } = await loginAs(user);
    const criada = await avaliar(agent, csrf, { bookingId, nota: 2 });
    const id = criada.body.avaliacao.id;

    const outro = await createUser({ email: "outro@aquatrip.local" });
    const { agent: ag2, csrf: c2 } = await loginAs(outro);
    expect((await ag2.delete(`/api/avaliacoes/${id}`).set("X-CSRF-Token", c2)).status).toBe(404);

    expect((await agent.delete(`/api/avaliacoes/${id}`).set("X-CSRF-Token", csrf)).status).toBe(204);
    expect((await db.query("SELECT 1 FROM reviews")).rows).toHaveLength(0);
  });

  it("admin só oculta com motivo, e a nota fica na auditoria", async () => {
    const { user, service, bookingId } = await reserva();
    const { agent, csrf } = await loginAs(user);
    const id = (await avaliar(agent, csrf, { bookingId, nota: 1, texto: "Péssimo" })).body.avaliacao.id;

    const admin = await createUser({ email: "chefe@aquatrip.local", role: "ADMIN" });
    const { agent: ad, csrf: cad } = await loginAs(admin);
    const sem = await ad.post(`/api/admin/avaliacoes/${id}`).set("X-CSRF-Token", cad).send({ ocultar: true, motivo: "ruim" });
    expect(sem.body.codigo).toBe("REASON_REQUIRED");

    const ok = await ad.post(`/api/admin/avaliacoes/${id}`).set("X-CSRF-Token", cad)
      .send({ ocultar: true, motivo: "Contém telefone pessoal de terceiro" });
    expect(ok.body.avaliacao.status).toBe("HIDDEN");
    expect((await request(app).get(`/reservar/${service.slug}`)).text).not.toContain("Péssimo");

    const { rows } = await db.query("SELECT metadata FROM audit_log WHERE action = 'REVIEW_HIDDEN'");
    expect(rows[0].metadata).toMatchObject({ nota: 1, motivo: "Contém telefone pessoal de terceiro" });
  });

  it("usuário comum não modera", async () => {
    const u = await createUser({ email: "comum@aquatrip.local" });
    const { agent, csrf } = await loginAs(u);
    const res = await agent.post("/api/admin/avaliacoes/00000000-0000-0000-0000-000000000000")
      .set("X-CSRF-Token", csrf).send({ ocultar: true, motivo: "qualquer motivo aqui" });
    expect(res.status).toBe(403);
  });
});

describe("LGPD", () => {
  it("avaliações entram na exportação de dados", async () => {
    const { user, bookingId } = await reserva();
    const { agent, csrf } = await loginAs(user);
    await avaliar(agent, csrf, { bookingId, nota: 5, texto: "Ótimo" });
    const dados = await dataRightsService.exportUserData(user.id);
    expect(dados.avaliacoes).toHaveLength(1);
    expect(dados.avaliacoes[0].texto).toBe("Ótimo");
  });
});
