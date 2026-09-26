/* ==============================================================
   Testes — pagamentos e webhooks
   A parte do sistema que movimenta dinheiro. É aqui que uma
   regressão custa caro, então cobrimos cada proteção explicitamente.
   ============================================================== */
const request = require("supertest");
const {
  app,
  db,
  resetDatabase,
  createUser,
  createServiceWithSlot,
  loginAs,
  freshCsrf,
} = require("./helpers");
const bookingService = require("../app/services/bookingService");
const mockProvider = require("../app/lib/payments/mockProvider");

beforeEach(resetDatabase);

/** Cria usuário + reserva pendente pronta para pagar. */
async function cenarioComReserva({ priceCents = 20000 } = {}) {
  const user = await createUser();
  const { slot } = await createServiceWithSlot({ priceCents });
  const booking = await bookingService.createBooking({
    userId: user.id,
    slotId: slot.id,
    quantity: 1,
  });
  return { user, booking };
}

/** Monta um webhook assinado corretamente, como o gateway faria. */
function webhookAssinado(providerPaymentId, status) {
  const body = {
    id: `evt_${Math.random().toString(16).slice(2)}`,
    type: "payment.updated",
    data: { id: providerPaymentId, status },
  };
  const raw = JSON.stringify(body);
  return { body, raw, signature: mockProvider.signBody(raw) };
}

describe("Início do pagamento", () => {
  it("PIX nasce pendente e devolve código copia-e-cola", async () => {
    const { user, booking } = await cenarioComReserva();
    const { agent } = await loginAs(user);
    const csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);

    await agent
      .post(`/reservas/${booking.id}/pagar`)
      .type("form")
      .send({ method: "PIX", _csrf: csrf });

    const { rows } = await db.query("SELECT * FROM payments WHERE booking_id = $1", [booking.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PENDING");
    expect(rows[0].method).toBe("PIX");
    expect(rows[0].display_data.pixCopiaECola).toBeTruthy();

    // Reserva continua pendente até o gateway confirmar.
    const { rows: b } = await db.query("SELECT status FROM bookings WHERE id = $1", [booking.id]);
    expect(b[0].status).toBe("PENDING");
  });

  it("cartão aprovado confirma a reserva na hora", async () => {
    const { user, booking } = await cenarioComReserva();
    const { agent } = await loginAs(user);
    const csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);

    await agent
      .post(`/reservas/${booking.id}/pagar`)
      .type("form")
      .send({ method: "CREDIT_CARD", cardLastFour: "4242", cardLength: 16, cardExpMonth: 12, cardExpYear: 2030, installments: 3, _csrf: csrf });

    const { rows: p } = await db.query("SELECT * FROM payments WHERE booking_id = $1", [booking.id]);
    expect(p[0].status).toBe("APPROVED");
    expect(p[0].installments).toBe(3);

    const { rows: b } = await db.query("SELECT status, confirmed_at FROM bookings WHERE id = $1", [
      booking.id,
    ]);
    expect(b[0].status).toBe("CONFIRMED");
    expect(b[0].confirmed_at).not.toBeNull();
  });

  it("cartão recusado mantém a reserva no prazo para tentar de novo", async () => {
    const { user, booking } = await cenarioComReserva();
    const { agent } = await loginAs(user);
    const csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);

    await agent
      .post(`/reservas/${booking.id}/pagar`)
      .type("form")
      .send({ method: "CREDIT_CARD", cardLastFour: "0000", cardLength: 16, cardExpMonth: 12, cardExpYear: 2030, _csrf: csrf });

    const { rows: p } = await db.query("SELECT status FROM payments WHERE booking_id = $1", [
      booking.id,
    ]);
    expect(p[0].status).toBe("REJECTED");

    const { rows: b } = await db.query("SELECT status FROM bookings WHERE id = $1", [booking.id]);
    expect(b[0].status).toBe("PENDING");
  });

  it("nunca guarda dados sensíveis de cartão", async () => {
    const { user, booking } = await cenarioComReserva();
    const { agent } = await loginAs(user);
    const csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);

    await agent.post(`/reservas/${booking.id}/pagar`).type("form").send({
      method: "CREDIT_CARD",
      cardLastFour: "4242",
      cardLength: 16, cardExpMonth: 12, cardExpYear: 2030,
      cardNumber: "4111111111111111", // tentativa de injetar PAN
      card_number: "4111111111111111",
      cvv: "123",
      _csrf: csrf,
    });

    const { rows } = await db.query("SELECT * FROM payments WHERE booking_id = $1", [booking.id]);
    const serializado = JSON.stringify(rows[0]);
    expect(serializado).not.toContain("4111111111111111");
    expect(serializado).not.toContain("123456"); // nada de CVV/PAN
    expect(rows[0].display_data.lastFour).toBe("4242");
  });

  it("recusa método de pagamento inválido", async () => {
    const { user, booking } = await cenarioComReserva();
    const { agent } = await loginAs(user);
    const csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);

    const res = await agent
      .post(`/reservas/${booking.id}/pagar`)
      .type("form")
      .send({ method: "BITCOIN", _csrf: csrf });

    expect(decodeURIComponent(res.headers.location)).toMatch(/forma de pagamento válida/i);
    const { rows } = await db.query("SELECT 1 FROM payments WHERE booking_id = $1", [booking.id]);
    expect(rows).toHaveLength(0);
  });
});

describe("Proteção contra cobrança duplicada", () => {
  it("duplo clique não gera dois pagamentos", async () => {
    const { user, booking } = await cenarioComReserva();
    const { agent } = await loginAs(user);
    const csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);

    await Promise.all([
      agent.post(`/reservas/${booking.id}/pagar`).type("form").send({ method: "PIX", _csrf: csrf }),
      agent.post(`/reservas/${booking.id}/pagar`).type("form").send({ method: "PIX", _csrf: csrf }),
    ]);

    const { rows } = await db.query("SELECT 1 FROM payments WHERE booking_id = $1", [booking.id]);
    expect(rows).toHaveLength(1);
  });

  it("não aceita novo pagamento para reserva já confirmada", async () => {
    const { user, booking } = await cenarioComReserva();
    const { agent } = await loginAs(user);
    let csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);

    await agent
      .post(`/reservas/${booking.id}/pagar`)
      .type("form")
      .send({ method: "CREDIT_CARD", cardLastFour: "4242", cardLength: 16, cardExpMonth: 12, cardExpYear: 2030, _csrf: csrf });

    csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);
    const res = await agent
      .post(`/reservas/${booking.id}/pagar`)
      .type("form")
      .send({ method: "PIX", _csrf: csrf });

    expect(decodeURIComponent(res.headers.location)).toMatch(/não está aguardando pagamento/i);
    const { rows } = await db.query("SELECT 1 FROM payments WHERE booking_id = $1", [booking.id]);
    expect(rows).toHaveLength(1);
  });

  it("o app impede dois pagamentos ativos para a mesma reserva", async () => {
    // No Postgres original isso era um índice único parcial no banco.
    // No MySQL, a restrição de coluna gerada + FK em cascata do InnoDB
    // não permite recriar esse índice (limitação documentada na migração),
    // então a proteção contra duplicata passou a viver na camada de
    // aplicação: startPayment() consulta findActiveByBooking() antes de
    // criar uma nova cobrança e devolve a existente em vez de duplicar.
    const { user, booking } = await cenarioComReserva();

    const primeira = await bookingService.startPayment({ bookingId: booking.id, user, method: "PIX" });
    const segunda = await bookingService.startPayment({ bookingId: booking.id, user, method: "PIX" });

    expect(segunda.reused).toBe(true);
    expect(segunda.payment.id).toBe(primeira.payment.id);

    const { rows } = await db.query(
      "SELECT COUNT(*) AS n FROM payments WHERE booking_id = $1 AND status IN ('PENDING','APPROVED')",
      [booking.id]
    );
    expect(Number(rows[0].n)).toBe(1);
  });
});

describe("Webhook", () => {
  async function pagamentoPixPendente() {
    const { user, booking } = await cenarioComReserva();
    const { payment } = await bookingService.startPayment({
      bookingId: booking.id,
      user: { id: user.id, role: "USER", email: user.email, name: user.name },
      method: "PIX",
    });
    return { user, booking, payment };
  }

  it("rejeita webhook com assinatura inválida e não altera nada", async () => {
    const { booking, payment } = await pagamentoPixPendente();

    const res = await request(app)
      .post("/webhooks/payments")
      .set("x-aquatrip-signature", "assinatura-falsa")
      .send({
        id: "evt_forjado",
        type: "payment.updated",
        data: { id: payment.provider_payment_id, status: "APPROVED" },
      });

    expect(res.status).toBe(401);
    const { rows } = await db.query("SELECT status FROM bookings WHERE id = $1", [booking.id]);
    expect(rows[0].status).toBe("PENDING"); // não foi confirmada por um forjado
  });

  it("rejeita webhook sem assinatura nenhuma", async () => {
    const { payment } = await pagamentoPixPendente();

    const res = await request(app)
      .post("/webhooks/payments")
      .send({
        id: "evt_sem_assinatura",
        type: "payment.updated",
        data: { id: payment.provider_payment_id, status: "APPROVED" },
      });

    expect(res.status).toBe(401);
  });

  it("confirma a reserva com webhook válido", async () => {
    const { booking, payment } = await pagamentoPixPendente();
    const { body, raw, signature } = webhookAssinado(payment.provider_payment_id, "APPROVED");

    const res = await request(app)
      .post("/webhooks/payments")
      .set("x-aquatrip-signature", signature)
      .set("Content-Type", "application/json")
      .send(raw);

    expect(res.status).toBe(200);

    const { rows: b } = await db.query("SELECT status FROM bookings WHERE id = $1", [booking.id]);
    expect(b[0].status).toBe("CONFIRMED");
    const { rows: p } = await db.query("SELECT status, paid_at FROM payments WHERE id = $1", [
      payment.id,
    ]);
    expect(p[0].status).toBe("APPROVED");
    expect(p[0].paid_at).not.toBeNull();
    expect(body.data.id).toBe(payment.provider_payment_id);
  });

  it("evento reenviado não é reprocessado (idempotência)", async () => {
    const { payment } = await pagamentoPixPendente();
    const { raw, signature } = webhookAssinado(payment.provider_payment_id, "APPROVED");

    const envio = () =>
      request(app)
        .post("/webhooks/payments")
        .set("x-aquatrip-signature", signature)
        .set("Content-Type", "application/json")
        .send(raw);

    const primeira = await envio();
    const segunda = await envio();
    const terceira = await envio();

    expect(primeira.status).toBe(200);
    expect(primeira.body.duplicate).toBeUndefined();
    expect(segunda.body.duplicate).toBe(true);
    expect(terceira.body.duplicate).toBe(true);

    const { rows } = await db.query("SELECT COUNT(*) AS n FROM webhook_events");
    expect(rows[0].n).toBe(1);
  });

  it("webhook de cancelamento libera a vaga", async () => {
    const { booking, payment } = await pagamentoPixPendente();
    const { raw, signature } = webhookAssinado(payment.provider_payment_id, "CANCELLED");

    await request(app)
      .post("/webhooks/payments")
      .set("x-aquatrip-signature", signature)
      .set("Content-Type", "application/json")
      .send(raw);

    const { rows } = await db.query("SELECT status FROM bookings WHERE id = $1", [booking.id]);
    expect(rows[0].status).toBe("CANCELLED");
  });

  it("webhook atrasado não rebaixa pagamento já aprovado", async () => {
    const { booking, payment } = await pagamentoPixPendente();

    const aprova = webhookAssinado(payment.provider_payment_id, "APPROVED");
    await request(app)
      .post("/webhooks/payments")
      .set("x-aquatrip-signature", aprova.signature)
      .set("Content-Type", "application/json")
      .send(aprova.raw);

    // Chega depois um evento antigo dizendo "pendente".
    const atrasado = webhookAssinado(payment.provider_payment_id, "PENDING");
    await request(app)
      .post("/webhooks/payments")
      .set("x-aquatrip-signature", atrasado.signature)
      .set("Content-Type", "application/json")
      .send(atrasado.raw);

    const { rows: p } = await db.query("SELECT status FROM payments WHERE id = $1", [payment.id]);
    expect(p[0].status).toBe("APPROVED");
    const { rows: b } = await db.query("SELECT status FROM bookings WHERE id = $1", [booking.id]);
    expect(b[0].status).toBe("CONFIRMED");
  });
});

describe("Cancelamento e estorno", () => {
  it("cancela reserva pendente sem estorno", async () => {
    const { user, booking } = await cenarioComReserva();
    const { agent } = await loginAs(user);
    const csrf = await freshCsrf(agent);

    await agent.post(`/reservas/${booking.id}/cancelar`).type("form").send({ _csrf: csrf });

    const { rows } = await db.query("SELECT status FROM bookings WHERE id = $1", [booking.id]);
    expect(rows[0].status).toBe("CANCELLED");
  });

  it("estorna reserva confirmada", async () => {
    const { user, booking } = await cenarioComReserva();
    const { agent } = await loginAs(user);
    let csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);

    await agent
      .post(`/reservas/${booking.id}/pagar`)
      .type("form")
      .send({ method: "CREDIT_CARD", cardLastFour: "4242", cardLength: 16, cardExpMonth: 12, cardExpYear: 2030, _csrf: csrf });

    csrf = await freshCsrf(agent);
    await agent.post(`/reservas/${booking.id}/cancelar`).type("form").send({ _csrf: csrf });

    const { rows: b } = await db.query("SELECT status FROM bookings WHERE id = $1", [booking.id]);
    expect(b[0].status).toBe("REFUNDED");
    const { rows: p } = await db.query(
      "SELECT status, refunded_at FROM payments WHERE booking_id = $1",
      [booking.id]
    );
    expect(p[0].status).toBe("REFUNDED");
    expect(p[0].refunded_at).not.toBeNull();
  });
});

describe("Comprovante", () => {
  it("só fica disponível depois da confirmação", async () => {
    const { user, booking } = await cenarioComReserva();
    const { agent } = await loginAs(user);

    // Pendente: redireciona de volta ao checkout.
    const antes = await agent.get(`/reservas/${booking.id}/comprovante`);
    expect(antes.status).toBe(302);

    const csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);
    await agent
      .post(`/reservas/${booking.id}/pagar`)
      .type("form")
      .send({ method: "CREDIT_CARD", cardLastFour: "4242", cardLength: 16, cardExpMonth: 12, cardExpYear: 2030, _csrf: csrf });

    const depois = await agent.get(`/reservas/${booking.id}/comprovante`);
    expect(depois.status).toBe(200);
    expect(depois.text).toContain("Comprovante de teste");
  });
});
