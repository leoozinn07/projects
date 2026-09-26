/* ==============================================================
   Testes — checkout de TESTE (simulador)
   PIX com QR Code simulado e "Já realizei o pagamento"; cartão com
   número, validade e CVV conferidos no navegador e revalidados no
   servidor sem nunca receber o número completo nem o CVV.
   ============================================================== */
const request = require("supertest");
const { app, db, resetDatabase, createUser, createServiceWithSlot, loginAs, freshCsrf } = require("./helpers");
const bookingService = require("../app/services/bookingService");
const { resolveProviderName, isSimulated } = require("../app/lib/payments");

beforeEach(resetDatabase);

async function cenario() {
  const user = await createUser();
  const { slot } = await createServiceWithSlot({ priceCents: 12000 });
  const booking = await bookingService.createBooking({ userId: user.id, slotId: slot.id, quantity: 1 });
  const { agent } = await loginAs(user);
  return { user, booking, agent };
}

async function pagar(agent, booking, dados) {
  const csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);
  return agent.post(`/reservas/${booking.id}/pagar`).type("form").send({ ...dados, _csrf: csrf });
}

const cartaoOk = { cardLastFour: "1111", cardLength: 16, cardExpMonth: 12, cardExpYear: 2030 };
const ultimoPagamento = async (booking) =>
  (await db.query("SELECT * FROM payments WHERE booking_id = ? ORDER BY created_at DESC LIMIT 1", [booking.id])).rows[0];
const statusReserva = async (booking) =>
  (await db.query("SELECT status FROM bookings WHERE id = ?", [booking.id])).rows[0].status;

describe("Checkout: a tela", () => {
  it("cartão de teste tem número, validade e CVV, mas número e CVV não têm name (nunca são enviados)", async () => {
    const { booking, agent } = await cenario();
    const res = await agent.get(`/reservas/${booking.id}/checkout`);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/id="cardNumber"/);
    expect(res.text).toMatch(/id="cardExp"/);
    expect(res.text).toMatch(/id="cardCvv"/);
    // Os campos sensíveis não são enviados no formulário.
    expect(res.text).not.toMatch(/<input[^>]*id="cardNumber"[^>]*name=/);
    expect(res.text).not.toMatch(/<input[^>]*id="cardCvv"[^>]*name=/);
    expect(res.text).not.toMatch(/name="cardNumber"|name="cvv"|name="cardCvv"/);
    // Não existe mais o campo "últimos 4 dígitos" que aparecia na tela.
    expect(res.text).not.toContain("Últimos 4 dígitos");
    // PIX vem marcado e com o aviso do QR Code de teste.
    expect(res.text).toMatch(/value="PIX" checked/);
    expect(res.text).toContain("QR Code PIX de teste");
  });

  it("volta com o método que a pessoa estava usando", async () => {
    const { booking, agent } = await cenario();
    const res = await agent.get(`/reservas/${booking.id}/checkout?metodo=DEBIT_CARD`);
    expect(res.text).toMatch(/value="DEBIT_CARD" checked/);
    expect(res.text).not.toMatch(/value="PIX" checked/);
  });
});

describe("PIX de teste", () => {
  it("gera QR Code simulado, confirma com 'Já realizei o pagamento' e mostra o comprovante de teste", async () => {
    const { booking, agent } = await cenario();
    await pagar(agent, booking, { method: "PIX" });
    const p = await ultimoPagamento(booking);
    expect(p.status).toBe("PENDING");
    expect(p.display_data.simulated).toBe(true);
    expect(p.display_data.pixCopiaECola).toContain("SIMULADO-NAO-PAGAVEL");

    const pagina = await agent.get(`/reservas/${booking.id}/checkout`);
    expect(pagina.text).toMatch(/id="pixQrTeste"[^>]*src="data:image\/png;base64,/);
    expect(pagina.text).toContain("não pode ser pago em nenhum banco");
    expect(pagina.text).toContain("Já realizei o pagamento");
    expect(pagina.text).not.toMatch(/id="cardNumber"/); // PIX pendente: nada de cartão

    const csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);
    const conf = await agent.post(`/reservas/${booking.id}/pix/confirmar-teste`).type("form").send({ _csrf: csrf });
    expect(conf.status).toBe(302);
    expect(conf.headers.location).toBe(`/reservas/${booking.id}/comprovante`);
    expect((await ultimoPagamento(booking)).status).toBe("APPROVED");
    expect(await statusReserva(booking)).toBe("CONFIRMED");

    const comp = await agent.get(`/reservas/${booking.id}/comprovante`);
    expect(comp.text).toContain("Comprovante de teste");
    expect(comp.text).toContain("Transação de teste");
    expect(comp.text).toContain("Nenhum dinheiro foi movimentado");
  });

  it("não confirma sem ter gerado o PIX", async () => {
    const { booking, agent } = await cenario();
    const csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);
    const r = await agent.post(`/reservas/${booking.id}/pix/confirmar-teste`).type("form").send({ _csrf: csrf });
    expect(decodeURIComponent(r.headers.location)).toContain("Gere o QR Code PIX antes");
    expect(await statusReserva(booking)).toBe("PENDING");
  });

  it("não confirma um pagamento de cartão pelo botão do PIX", async () => {
    const { booking, agent } = await cenario();
    await pagar(agent, booking, { method: "CREDIT_CARD", ...cartaoOk, cardLastFour: "0001" }); // fica em análise
    const csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);
    await agent.post(`/reservas/${booking.id}/pix/confirmar-teste`).type("form").send({ _csrf: csrf });
    expect((await ultimoPagamento(booking)).status).toBe("PENDING");
  });

  it("outra pessoa não confirma o PIX de uma reserva que não é dela", async () => {
    const { booking, agent } = await cenario();
    await pagar(agent, booking, { method: "PIX" });
    const intruso = await loginAs(await createUser({ email: "intruso@aquatrip.local" }));
    const csrf = await freshCsrf(intruso.agent, "/perfil_editado");
    const r = await intruso.agent.post(`/reservas/${booking.id}/pix/confirmar-teste`).type("form").send({ _csrf: csrf });
    expect(r.status).toBe(404);
    expect((await ultimoPagamento(booking)).status).toBe("PENDING");
  });

  it("exige login e CSRF", async () => {
    const { booking, agent } = await cenario();
    await pagar(agent, booking, { method: "PIX" });
    const semLogin = await request(app).post(`/reservas/${booking.id}/pix/confirmar-teste`);
    expect([302, 403]).toContain(semLogin.status);
    const semCsrf = await agent.post(`/reservas/${booking.id}/pix/confirmar-teste`).type("form").send({});
    expect(semCsrf.status).toBe(403);
    expect((await ultimoPagamento(booking)).status).toBe("PENDING");
  });
});

describe("Cartão de teste: validação no servidor", () => {
  it("não avança sem número, validade e CVV (e volta com o método escolhido)", async () => {
    const { booking, agent } = await cenario();
    const r = await pagar(agent, booking, { method: "DEBIT_CARD" });
    const destino = decodeURIComponent(r.headers.location);
    expect(destino).toContain("Preencha número, validade e CVV");
    expect(destino).toContain("metodo=DEBIT_CARD");
    expect(await ultimoPagamento(booking)).toBeUndefined();
  });

  it("débito exige 16 dígitos", async () => {
    const { booking, agent } = await cenario();
    for (const n of [15, 17]) {
      const r = await pagar(agent, booking, { method: "DEBIT_CARD", ...cartaoOk, cardLength: n });
      expect(decodeURIComponent(r.headers.location)).toContain("16 dígitos");
    }
    await pagar(agent, booking, { method: "DEBIT_CARD", ...cartaoOk });
    const p = await ultimoPagamento(booking);
    expect(p.status).toBe("APPROVED");
    expect(p.display_data.installments).toBe(1);
  });

  it("crédito aceita 17 dígitos (e a faixa de 13 a 19)", async () => {
    const { booking, agent } = await cenario();
    const r = await pagar(agent, booking, { method: "CREDIT_CARD", ...cartaoOk, cardLength: 12 });
    expect(decodeURIComponent(r.headers.location)).toContain("13 a 19 dígitos");
    await pagar(agent, booking, { method: "CREDIT_CARD", ...cartaoOk, cardLastFour: "1234", cardLength: 17 });
    const p = await ultimoPagamento(booking);
    expect(p.status).toBe("APPROVED");
    expect(p.display_data.lastFour).toBe("1234");
  });

  it("recusa validade vencida, mês inválido e validade absurda", async () => {
    const { booking, agent } = await cenario();
    const agora = new Date();
    const casos = [
      [{ cardExpMonth: 1, cardExpYear: 2020 }, "vencido"],
      [{ cardExpMonth: agora.getUTCMonth() === 0 ? 12 : agora.getUTCMonth(), cardExpYear: agora.getUTCMonth() === 0 ? agora.getUTCFullYear() - 1 : agora.getUTCFullYear() }, "vencido"],
      [{ cardExpMonth: 13, cardExpYear: 2030 }, "MM/AA"],
      [{ cardExpMonth: 12, cardExpYear: agora.getUTCFullYear() + 30 }, "muito distante"],
    ];
    for (const [validade, msg] of casos) {
      const r = await pagar(agent, booking, { method: "CREDIT_CARD", ...cartaoOk, ...validade });
      expect(decodeURIComponent(r.headers.location)).toContain(msg);
    }
    // Mês atual ainda vale (o cartão vence no fim do mês).
    await pagar(agent, booking, { method: "CREDIT_CARD", ...cartaoOk, cardExpMonth: agora.getUTCMonth() + 1, cardExpYear: agora.getUTCFullYear() });
    expect((await ultimoPagamento(booking)).status).toBe("APPROVED");
  });

  it("número completo e CVV enviados à força não são guardados", async () => {
    const { booking, agent } = await cenario();
    await pagar(agent, booking, { method: "CREDIT_CARD", ...cartaoOk, cardNumber: "4111111111111111", cardCvv: "987", cvv: "987" });
    const p = await ultimoPagamento(booking);
    expect(JSON.stringify(p)).not.toContain("4111111111111111");
    // O que fica guardado do cartão é só isto (nada de CVV, número ou validade).
    expect(Object.keys(p.display_data).sort()).toEqual(["installments", "lastFour", "simulated"]);
    expect(p.display_data.lastFour).toBe("1111");
  });
});

describe("Pagamento sempre simulado", () => {
  const ENV = ["PAYMENT_PROVIDER", "MP_ACCESS_TOKEN"];
  let antes;
  beforeEach(() => { antes = Object.fromEntries(ENV.map((k) => [k, process.env[k]])); });
  afterEach(() => { for (const k of ENV) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; } });

  it("ter um token do Mercado Pago no .env NÃO liga o gateway real", () => {
    process.env.PAYMENT_PROVIDER = "";
    process.env.MP_ACCESS_TOKEN = "APP_USR-token-real-qualquer";
    expect(resolveProviderName()).toBe("mock");
    expect(isSimulated()).toBe(true);
  });

  it("o botão do PIX de teste não funciona fora do simulador", async () => {
    const { booking, agent } = await cenario();
    await pagar(agent, booking, { method: "PIX" });
    const csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);
    process.env.PAYMENT_PROVIDER = "mercadopago";
    process.env.MP_ACCESS_TOKEN = "TEST-token";
    const r = await agent.post(`/reservas/${booking.id}/pix/confirmar-teste`).type("form").send({ _csrf: csrf });
    expect(r.status).toBe(404);
    expect((await ultimoPagamento(booking)).status).toBe("PENDING");
  });
});
