/* ==============================================================
   Testes — marketplace, fase 4: reservas e vendas do parceiro
   ============================================================== */
const crypto = require("crypto");
const request = require("supertest");
const { app, db, resetDatabase, truncateTables, createUser, loginAs } = require("./helpers");
const bookingService = require("../app/services/bookingService");
const { codigoIngresso } = require("../app/lib/ingresso");

beforeEach(async () => {
  await resetDatabase();
  await truncateTables("partners");
});

let seq = 0;
async function parceiro(comissao = 15) {
  const docs = ["52998224725", "12ABC34501DE35", "11222333000181", "00000000E08G12"];
  const user = await createUser({ email: `p${++seq}@aquatrip.local`, name: "Zé" });
  const partnerId = crypto.randomUUID();
  await db.query(
    `INSERT INTO partners (id, user_id, person_type, document, legal_name, display_name, phone, city, state, status, commission_pct)
     VALUES ($1, $2, 'PJ', $3, 'Zé', $4, '1', 'X', 'SP', 'APPROVED', $5)`,
    [partnerId, user.id, docs[seq % docs.length], `Parceiro ${seq}`, comissao]);
  const s = await loginAs(user);
  const ida = await s.agent.get("/parceiro/mercadopago/conectar");
  const state = new URL(ida.headers.location, "http://x").searchParams.get("state");
  await s.agent.get(`/parceiro/mercadopago/retorno?state=${state}&code=MOCK-CONTA-${8000 + seq}:x`);
  return { user, partnerId, ...s };
}
async function experiencia(partnerId, preco, titulo, dias = 5) {
  const serviceId = crypto.randomUUID();
  await db.query(
    `INSERT INTO services (id, slug, title, category, price_cents, partner_id, review_status)
     VALUES ($1, $2, $3, 'mergulho', $4, $5, 'APPROVED')`,
    [serviceId, `e-${crypto.randomBytes(3).toString("hex")}`, titulo, preco, partnerId]);
  const slotId = crypto.randomUUID();
  const startsAt = new Date(Date.now() + Number(dias) * 24 * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO service_slots (id, service_id, starts_at, capacity) VALUES ($1, $2, $3, 20)`,
    [slotId, serviceId, startsAt]);
  return slotId;
}
async function venda(slotId, qtd, nome = "Maria Clara Souza") {
  const c = await createUser({ email: `c${++seq}@cliente.local`, name: nome });
  const u = { id: c.id, role: "USER", email: c.email, name: c.name };
  const b = await bookingService.createBooking({ userId: c.id, slotId, quantity: qtd });
  await bookingService.startPayment({ bookingId: b.id, user: u, method: "CREDIT_CARD", cardLastFour: "4242" });
  return { booking: b, cliente: u };
}

describe("Reservas do parceiro", () => {
  it("mostra quem vem, quantas pessoas e o MESMO código de ingresso do cliente", async () => {
    const p = await parceiro();
    const { booking } = await venda(await experiencia(p.partnerId, 10000, "Mergulho A"), 3);
    const { body } = await p.agent.get("/api/parceiro/reservas");
    expect(body.reservas).toHaveLength(1);
    expect(body.reservas[0]).toMatchObject({ cliente: "Maria Clara Souza", quantity: 3, experiencia: "Mergulho A" });
    expect(body.reservas[0].codigo).toBe(codigoIngresso(booking.id));
  });

  it("não expõe e-mail do cliente nem o id da reserva", async () => {
    const p = await parceiro();
    await venda(await experiencia(p.partnerId, 10000, "Mergulho A"), 1);
    const texto = JSON.stringify((await p.agent.get("/api/parceiro/reservas")).body);
    expect(texto).not.toMatch(/@cliente\.local/);
    expect(texto).not.toMatch(/"id"/);
  });

  it("um parceiro não vê as reservas do outro", async () => {
    const a = await parceiro();
    const b = await parceiro();
    await venda(await experiencia(a.partnerId, 10000, "Do A"), 1);
    expect((await b.agent.get("/api/parceiro/reservas")).body.reservas).toHaveLength(0);
  });

  it("reserva não paga não aparece; próximas e realizadas separadas", async () => {
    const p = await parceiro();
    const slot = await experiencia(p.partnerId, 10000, "Mergulho A");
    const c = await createUser({ email: "naopagou@cliente.local" });
    await bookingService.createBooking({ userId: c.id, slotId: slot, quantity: 1 }); // pendente
    expect((await p.agent.get("/api/parceiro/reservas")).body.reservas).toHaveLength(0);
    await venda(slot, 1);
    await db.query("UPDATE service_slots SET starts_at = NOW() - INTERVAL 1 DAY WHERE id = $1", [slot]);
    expect((await p.agent.get("/api/parceiro/reservas?quando=proximas")).body.reservas).toHaveLength(0);
    expect((await p.agent.get("/api/parceiro/reservas?quando=passadas")).body.reservas).toHaveLength(1);
  });

  it("só parceiro acessa", async () => {
    const c = await createUser({ email: "comum@x.local" });
    const { agent } = await loginAs(c);
    expect((await agent.get("/api/parceiro/reservas")).status).toBe(403);
    expect((await agent.get("/api/parceiro/vendas")).status).toBe(403);
    expect((await request(app).get("/api/parceiro/vendas")).status).toBe(401);
  });
});

describe("Vendas e comissões", () => {
  it("bruto, comissão e líquido batem com os valores congelados", async () => {
    const p = await parceiro(15);
    const slot = await experiencia(p.partnerId, 20000, "Mergulho A");
    await venda(slot, 2);          // R$ 400 -> comissão R$ 60
    await db.query("UPDATE partners SET commission_pct = 10 WHERE id = $1", [p.partnerId]);
    await venda(slot, 1);          // R$ 200 -> comissão R$ 20 (nova taxa)
    const { body } = await p.agent.get("/api/parceiro/vendas?dias=30");
    expect(body.resumo).toMatchObject({ vendas: 2, brutoCents: 60000, comissaoCents: 8000, liquidoCents: 52000, estornadasCents: 0 });
  });

  it("estorno sai do recebido e aparece separado", async () => {
    const p = await parceiro(15);
    const slot = await experiencia(p.partnerId, 10000, "Mergulho A");
    await venda(slot, 1);
    const { booking, cliente } = await venda(slot, 1);
    await bookingService.cancelBooking({ bookingId: booking.id, user: cliente });
    const { body } = await p.agent.get("/api/parceiro/vendas");
    expect(body.resumo).toMatchObject({ vendas: 1, brutoCents: 10000, liquidoCents: 8500, estornadasCents: 10000 });
  });

  it("período inválido volta para 30 dias", async () => {
    const p = await parceiro();
    expect((await p.agent.get("/api/parceiro/vendas?dias=999999")).body.periodoDias).toBe(30);
  });
});
