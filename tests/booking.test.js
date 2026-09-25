/* ==============================================================
   Testes — fluxo de reserva
   ============================================================== */
const {
  db,
  resetDatabase,
  createUser,
  createServiceWithSlot,
  loginAs,
  freshCsrf,
} = require("./helpers");
const bookingService = require("../app/services/bookingService");

beforeEach(resetDatabase);

describe("Criação de reserva", () => {
  it("cria reserva PENDING com prazo de expiração e valor calculado no servidor", async () => {
    const user = await createUser();
    const { service, slot } = await createServiceWithSlot({ priceCents: 12500 });
    const { agent, csrf } = await loginAs(user);

    const res = await agent
      .post("/reservar")
      .type("form")
      .send({ slotId: slot.id, quantity: 2, serviceSlug: service.slug, _csrf: csrf });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/reservas\/[0-9a-f-]+\/checkout/);

    const { rows } = await db.query("SELECT * FROM bookings");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PENDING");
    expect(rows[0].quantity).toBe(2);
    expect(rows[0].amount_cents).toBe(25000); // 12500 × 2, calculado no servidor
    expect(rows[0].expires_at).not.toBeNull();
  });

  it("ignora qualquer preço enviado pelo cliente", async () => {
    const user = await createUser();
    const { slot } = await createServiceWithSlot({ priceCents: 50000 });
    const { agent, csrf } = await loginAs(user);

    await agent.post("/reservar").type("form").send({
      slotId: slot.id,
      quantity: 1,
      amount_cents: 1, // tentativa de adulterar o valor
      amountCents: 1,
      price: 0,
      _csrf: csrf,
    });

    const { rows } = await db.query("SELECT amount_cents FROM bookings");
    expect(rows[0].amount_cents).toBe(50000);
  });

  it("recusa reserva sem token CSRF", async () => {
    const user = await createUser();
    const { slot } = await createServiceWithSlot();
    const { agent } = await loginAs(user);

    const res = await agent
      .post("/reservar")
      .type("form")
      .send({ slotId: slot.id, quantity: 1 });

    expect(res.status).toBe(403);
    const { rows } = await db.query("SELECT 1 FROM bookings");
    expect(rows).toHaveLength(0);
  });

  it("recusa quantidade acima do permitido", async () => {
    const user = await createUser();
    const { slot } = await createServiceWithSlot({ capacity: 50 });
    const { agent, csrf } = await loginAs(user);

    const res = await agent
      .post("/reservar")
      .type("form")
      .send({ slotId: slot.id, quantity: 999, _csrf: csrf });

    expect(decodeURIComponent(res.headers.location)).toMatch(/Máximo de 20 pessoas/);
    const { rows } = await db.query("SELECT 1 FROM bookings");
    expect(rows).toHaveLength(0);
  });
});

describe("Capacidade e concorrência", () => {
  it("não permite exceder a capacidade do horário", async () => {
    const user = await createUser();
    const { slot } = await createServiceWithSlot({ capacity: 3 });

    await bookingService.createBooking({ userId: user.id, slotId: slot.id, quantity: 2 });

    await expect(
      bookingService.createBooking({ userId: user.id, slotId: slot.id, quantity: 2 })
    ).rejects.toMatchObject({ code: "NO_CAPACITY" });
  });

  it("segura a vaga enquanto a reserva está pendente e a devolve ao expirar", async () => {
    const user = await createUser();
    const { service, slot } = await createServiceWithSlot({ capacity: 1 });

    const booking = await bookingService.createBooking({
      userId: user.id,
      slotId: slot.id,
      quantity: 1,
    });

    // Lotado: o horário some da lista de disponíveis.
    let disponiveis = await bookingService.getServiceWithSlots(service.slug);
    expect(disponiveis.slots).toHaveLength(0);

    // Força o vencimento e roda o expirador.
    await db.query("UPDATE bookings SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = $1", [
      booking.id,
    ]);
    await bookingService.expirePendingBookings();

    const { rows } = await db.query("SELECT status FROM bookings WHERE id = $1", [booking.id]);
    expect(rows[0].status).toBe("EXPIRED");

    // Vaga de volta à disponibilidade.
    disponiveis = await bookingService.getServiceWithSlots(service.slug);
    expect(disponiveis.slots).toHaveLength(1);
  });

  it("não conta pendências vencidas como ocupadas mesmo antes do job rodar", async () => {
    const user = await createUser();
    const { service, slot } = await createServiceWithSlot({ capacity: 1 });

    const booking = await bookingService.createBooking({
      userId: user.id,
      slotId: slot.id,
      quantity: 1,
    });
    await db.query("UPDATE bookings SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = $1", [
      booking.id,
    ]);

    // Sem chamar expirePendingBookings: a própria consulta já ignora.
    const { slots } = await bookingService.getServiceWithSlots(service.slug);
    expect(slots).toHaveLength(1);
  });

  it("recusa horário no passado", async () => {
    const user = await createUser();
    const { slot } = await createServiceWithSlot({ hoursFromNow: 48 });
    await db.query("UPDATE service_slots SET starts_at = NOW() - INTERVAL 1 HOUR WHERE id = $1", [
      slot.id,
    ]);

    await expect(
      bookingService.createBooking({ userId: user.id, slotId: slot.id, quantity: 1 })
    ).rejects.toMatchObject({ code: "SLOT_IN_PAST" });
  });
});

describe("Isolamento entre usuários (IDOR/BOLA)", () => {
  async function reservaDeOutroUsuario() {
    const dono = await createUser({ email: "dono@aquatrip.local" });
    const { slot } = await createServiceWithSlot();
    const booking = await bookingService.createBooking({
      userId: dono.id,
      slotId: slot.id,
      quantity: 1,
    });
    return booking;
  }

  it("esconde checkout e comprovante de reserva alheia (404, não 403)", async () => {
    const booking = await reservaDeOutroUsuario();
    const intruso = await createUser({ email: "intruso@aquatrip.local" });
    const { agent } = await loginAs(intruso);

    // 404 em vez de 403: 403 confirmaria que o recurso existe.
    expect((await agent.get(`/reservas/${booking.id}/checkout`)).status).toBe(404);
    expect((await agent.get(`/reservas/${booking.id}/comprovante`)).status).toBe(404);
  });

  it("impede cancelamento de reserva alheia", async () => {
    const booking = await reservaDeOutroUsuario();
    const intruso = await createUser({ email: "intruso2@aquatrip.local" });
    const { agent } = await loginAs(intruso);
    const csrf = await freshCsrf(agent);

    await agent.post(`/reservas/${booking.id}/cancelar`).type("form").send({ _csrf: csrf });

    const { rows } = await db.query("SELECT status FROM bookings WHERE id = $1", [booking.id]);
    expect(rows[0].status).toBe("PENDING"); // intacta
  });

  it("impede iniciar pagamento de reserva alheia", async () => {
    const booking = await reservaDeOutroUsuario();
    const intruso = await createUser({ email: "intruso3@aquatrip.local" });
    const { agent } = await loginAs(intruso);
    const csrf = await freshCsrf(agent);

    await agent
      .post(`/reservas/${booking.id}/pagar`)
      .type("form")
      .send({ method: "PIX", _csrf: csrf });

    const { rows } = await db.query("SELECT 1 FROM payments WHERE booking_id = $1", [booking.id]);
    expect(rows).toHaveLength(0);
  });

  it("lista apenas as reservas do próprio usuário", async () => {
    const booking = await reservaDeOutroUsuario();
    const outro = await createUser({ email: "outro@aquatrip.local" });
    const { agent } = await loginAs(outro);

    const res = await agent.get("/minhas-reservas");
    expect(res.text).not.toContain(booking.id);
  });
});
