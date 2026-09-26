/* ==============================================================
   Testes: checkout com Mercado Pago (cartão pelo Brick e PIX)
   A API do Mercado Pago é substituída por um fetch falso: nada sai
   da máquina, e cada teste confere o corpo exato que seria enviado.
   ============================================================== */
const request = require("supertest");
const {
  app, db, resetDatabase, createUser, createServiceWithSlot, loginAs, freshCsrf,
} = require("./helpers");
const bookingService = require("../app/services/bookingService");
const { ampliar } = require("../app/middlewares/cspMercadoPago");

const ENV = ["PAYMENT_PROVIDER", "MP_ACCESS_TOKEN", "MP_PUBLIC_KEY", "PAYMENT_ENV"];
let envOriginal;
let fetchOriginal;

beforeEach(async () => {
  await resetDatabase();
  envOriginal = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  fetchOriginal = global.fetch;
});
afterEach(() => {
  for (const [k, v] of Object.entries(envOriginal)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  global.fetch = fetchOriginal;
});

function ligarMercadoPago({ publicKey = "TEST-pub-plataforma" } = {}) {
  process.env.PAYMENT_PROVIDER = "mercadopago";
  process.env.MP_ACCESS_TOKEN = "TEST-token-plataforma";
  process.env.PAYMENT_ENV = "sandbox";
  if (publicKey) process.env.MP_PUBLIC_KEY = publicKey;
  else delete process.env.MP_PUBLIC_KEY;
}

/** fetch falso: guarda as chamadas e responde como a API do MP. */
function apiFalsa(resposta) {
  const chamadas = [];
  global.fetch = jest.fn(async (url, opts = {}) => {
    const corpo = opts.body ? JSON.parse(opts.body) : null;
    chamadas.push({ url, opts, corpo });
    const dados = typeof resposta === "function" ? resposta(corpo) : resposta;
    return { ok: true, status: 201, text: async () => JSON.stringify(dados) };
  });
  return chamadas;
}

async function cenario() {
  const user = await createUser();
  const { slot } = await createServiceWithSlot({ priceCents: 25000 });
  const booking = await bookingService.createBooking({ userId: user.id, slotId: slot.id, quantity: 1 });
  const { agent } = await loginAs(user);
  return { user, booking, agent };
}

async function pagar(agent, booking, dados) {
  const csrf = await freshCsrf(agent, `/reservas/${booking.id}/checkout`);
  return agent.post(`/reservas/${booking.id}/pagar`).type("form").send({ ...dados, _csrf: csrf });
}

describe("CSP da página de pagamento", () => {
  it("acrescenta as origens do Mercado Pago sem perder as existentes", () => {
    const nova = ampliar("default-src 'self';script-src 'self';connect-src 'self';object-src 'none'");
    expect(nova).toMatch(/script-src 'self' https:\/\/sdk\.mercadopago\.com/);
    expect(nova).toMatch(/connect-src 'self' [^;]*https:\/\/\*\.mercadopago\.com/);
    expect(nova).toMatch(/frame-src 'self' [^;]*mercadopago/);
    expect(nova).toContain("object-src 'none'");
  });

  it("no simulador, nenhum script de terceiro é liberado", async () => {
    const { booking, agent } = await cenario();
    const res = await agent.get(`/reservas/${booking.id}/checkout`);
    expect(res.headers["content-security-policy"]).not.toContain("mercadopago");
    expect(res.text).not.toContain("sdk.mercadopago.com");
    expect(res.text).not.toContain('id="cardBrick"');
  });

  it("o resto do site continua fechado mesmo com o Mercado Pago ligado", async () => {
    ligarMercadoPago();
    const res = await request(app).get("/reservar");
    expect(res.headers["content-security-policy"]).not.toContain("mercadopago");
  });
});

describe("Checkout com Mercado Pago", () => {
  it("monta o formulário oficial com a chave pública e libera o SDK só aqui", async () => {
    ligarMercadoPago();
    const { booking, agent } = await cenario();
    const res = await agent.get(`/reservas/${booking.id}/checkout`);
    expect(res.headers["content-security-policy"]).toContain("https://sdk.mercadopago.com");
    expect(res.text).toContain('<script src="https://sdk.mercadopago.com/js/v2" defer></script>');
    expect(res.text).toContain('data-public-key="TEST-pub-plataforma"');
    expect(res.text).toContain('data-amount="250"');
    expect(res.text).not.toContain("Modo simulado");
    // Nenhum campo de número de cartão no HTML do AquaTrip
    expect(res.text).not.toMatch(/name="(cardNumber|card_number|cvv|securityCode)"/);
  });

  it("sem chave pública, desativa o cartão e mantém o PIX", async () => {
    ligarMercadoPago({ publicKey: null });
    const { booking, agent } = await cenario();
    const res = await agent.get(`/reservas/${booking.id}/checkout`);
    expect(res.text).toMatch(/value="CREDIT_CARD" disabled/);
    expect(res.text).toContain('id="cardUnavailable"');
    expect(res.text).not.toContain("sdk.mercadopago.com");
  });

  it("recusa cartão sem token, sem chamar o Mercado Pago", async () => {
    ligarMercadoPago();
    const chamadas = apiFalsa({});
    const { booking, agent } = await cenario();
    const res = await pagar(agent, booking, { method: "CREDIT_CARD", installments: 3 });
    expect(res.headers.location).toMatch(/error=/);
    expect(chamadas).toHaveLength(0);
  });

  it("envia só token, bandeira, emissor, parcelas e CPF, e confirma se aprovado", async () => {
    ligarMercadoPago();
    const chamadas = apiFalsa({
      id: 991, status: "approved", status_detail: "accredited",
      payment_method_id: "master", installments: 3, card: { last_four_digits: "4321" },
    });
    const { user, booking, agent } = await cenario();
    await pagar(agent, booking, {
      method: "CREDIT_CARD", installments: 3, cardToken: "tok_abc123",
      paymentMethodId: "master", issuerId: "24", docType: "CPF", docNumber: "123.456.789-09",
      cardNumber: "5031433215406351", // campo intruso: precisa ser descartado
    });

    expect(chamadas).toHaveLength(1);
    const { url, opts, corpo } = chamadas[0];
    expect(url).toBe("https://api.mercadopago.com/v1/payments");
    expect(opts.headers.Authorization).toBe("Bearer TEST-token-plataforma");
    expect(opts.headers["X-Idempotency-Key"]).toMatch(/^[a-f0-9]{64}$/);
    expect(corpo).toMatchObject({
      transaction_amount: 250,
      token: "tok_abc123",
      installments: 3,
      payment_method_id: "master",
      issuer_id: 24,
      external_reference: booking.id,
      payer: { email: user.email, identification: { type: "CPF", number: "12345678909" } },
    });
    expect(JSON.stringify(corpo)).not.toContain("5031433215406351");

    const { rows: b } = await db.query("SELECT status FROM bookings WHERE id = $1", [booking.id]);
    expect(b[0].status).toBe("CONFIRMED");
    const { rows: p } = await db.query("SELECT display_data FROM payments WHERE booking_id = $1", [booking.id]);
    expect(p[0].display_data).toMatchObject({ lastFour: "4321", brand: "master" });
  });

  it("débito nunca parcela", async () => {
    ligarMercadoPago();
    const chamadas = apiFalsa({ id: 992, status: "approved", card: { last_four_digits: "1111" } });
    const { booking, agent } = await cenario();
    await pagar(agent, booking, { method: "DEBIT_CARD", installments: 6, cardToken: "tok_deb", paymentMethodId: "debmaster" });
    expect(chamadas[0].corpo.installments).toBe(1);
    const { rows } = await db.query("SELECT installments FROM payments WHERE booking_id = $1", [booking.id]);
    expect(rows[0].installments).toBe(1);
  });

  it("PIX mostra o QR Code e o copia e cola devolvidos pelo Mercado Pago", async () => {
    ligarMercadoPago();
    const chamadas = apiFalsa({
      id: 993, status: "pending",
      point_of_interaction: { transaction_data: { qr_code: "00020126PIXREAL", qr_code_base64: "iVBORw0KGgo=" } },
    });
    const { booking, agent } = await cenario();
    await pagar(agent, booking, { method: "PIX" });
    expect(chamadas[0].corpo.payment_method_id).toBe("pix");

    const res = await agent.get(`/reservas/${booking.id}/checkout`);
    expect(res.text).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(res.text).toContain("00020126PIXREAL");
    expect(res.text).toContain(`data-status-url="/reservas/${booking.id}/status"`);
    // Aguardando: o formulário de cartão não é carregado de novo
    expect(res.text).not.toContain("sdk.mercadopago.com");
  });

  it("cartão recusado explica o motivo e deixa tentar de novo", async () => {
    ligarMercadoPago();
    let vez = 0;
    const chamadas = apiFalsa(() => (++vez === 1
      ? { id: 994, status: "rejected", status_detail: "cc_rejected_bad_filled_security_code" }
      : { id: 995, status: "approved", card: { last_four_digits: "9999" } }));
    const { booking, agent } = await cenario();

    await pagar(agent, booking, { method: "CREDIT_CARD", cardToken: "tok_1", paymentMethodId: "visa" });
    const pagina = await agent.get(`/reservas/${booking.id}/checkout`);
    expect(pagina.text).toContain("o código de segurança (CVV) está incorreto");
    expect(pagina.text).toContain('id="cardBrick"');

    await pagar(agent, booking, { method: "CREDIT_CARD", cardToken: "tok_2", paymentMethodId: "visa" });
    expect(chamadas).toHaveLength(2);
    // Cada tentativa tem sua chave: senão o MP devolveria a recusa de novo
    expect(chamadas[0].opts.headers["X-Idempotency-Key"]).not.toBe(chamadas[1].opts.headers["X-Idempotency-Key"]);
    const { rows } = await db.query("SELECT status FROM bookings WHERE id = $1", [booking.id]);
    expect(rows[0].status).toBe("CONFIRMED");
  });

  it("erro da API do Mercado Pago vira mensagem amigável", async () => {
    ligarMercadoPago();
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, text: async () => '{"message":"invalid token"}' }));
    const { booking, agent } = await cenario();
    const res = await pagar(agent, booking, { method: "CREDIT_CARD", cardToken: "tok_x", paymentMethodId: "visa" });
    expect(decodeURIComponent(res.headers.location)).toContain("Não foi possível iniciar o pagamento");
  });
});

describe("Simulador (sem credenciais)", () => {
  it("depois de uma recusa, a mesma reserva pode ser paga", async () => {
    const { booking, agent } = await cenario();
    await pagar(agent, booking, { method: "CREDIT_CARD", cardLastFour: "0000", cardLength: 16, cardExpMonth: 12, cardExpYear: 2030 });
    const pagina = await agent.get(`/reservas/${booking.id}/checkout`);
    expect(pagina.text).toContain("limite ou saldo suficiente");

    await pagar(agent, booking, { method: "CREDIT_CARD", cardLastFour: "4242", cardLength: 16, cardExpMonth: 12, cardExpYear: 2030 });
    const { rows } = await db.query("SELECT status FROM payments WHERE booking_id = $1 ORDER BY created_at", [booking.id]);
    expect(rows.map((r) => r.status)).toEqual(["REJECTED", "APPROVED"]);
  });

  it("reserva expirada não mostra o formulário de pagamento", async () => {
    const { booking, agent } = await cenario();
    await db.query("UPDATE bookings SET status = 'EXPIRED' WHERE id = $1", [booking.id]);
    const res = await agent.get(`/reservas/${booking.id}/checkout`);
    expect(res.text).toContain("Reserva encerrada");
    expect(res.text).not.toContain('id="payForm"');
  });
});

describe("Status do pagamento (JSON)", () => {
  it("responde ao dono e esconde de outras contas", async () => {
    const { booking, agent } = await cenario();
    await pagar(agent, booking, { method: "PIX" });
    const res = await agent.get(`/reservas/${booking.id}/status`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({ booking: "PENDING", payment: "PENDING" });

    const outra = await createUser({ email: "outra@aquatrip.local" });
    const { agent: intrusa } = await loginAs(outra);
    expect((await intrusa.get(`/reservas/${booking.id}/status`)).status).toBe(404);
  });
});
