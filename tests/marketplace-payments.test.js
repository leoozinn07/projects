/* ==============================================================
   Testes — marketplace, fase 3: Mercado Pago do parceiro + divisão
   Executados contra o SIMULADOR (rede bloqueada para o Mercado Pago).
   ============================================================== */
const crypto = require("crypto");
const request = require("supertest");
const { app, db, resetDatabase, truncateTables, createUser, loginAs } = require("./helpers");
const bookingService = require("../app/services/bookingService");
const marketplace = require("../app/services/marketplaceService");
const mock = require("../app/lib/payments/mockProvider");
const cofre = require("../app/lib/cofre");

beforeEach(async () => {
  await resetDatabase();
  await truncateTables("partners");
});

let seq = 0;
/** Mensagem de erro do redirecionamento (URLSearchParams codifica espaço como "+"). */
const erroDe = (res) => new URL(res.headers.location, "http://x").searchParams.get("mp_erro") || "";
async function parceiro({ comissao = 15 } = {}) {
  const docs = ["52998224725", "12ABC34501DE35", "11222333000181", "00000000E08G12"];
  const user = await createUser({ email: `p${++seq}@aquatrip.local`, name: "Zé da Silva" });
  const partnerId = crypto.randomUUID();
  await db.query(
    `INSERT INTO partners (id, user_id, person_type, document, legal_name, display_name, phone, city, state, status, commission_pct)
     VALUES ($1, $2, 'PJ', $3, 'Zé Ltda', $4, '12999990000', 'Ilhabela', 'SP', 'APPROVED', $5)`,
    [partnerId, user.id, docs[seq % docs.length], `Passeios ${seq}`, comissao]
  );
  return { user, partnerId, ...(await loginAs(user)) };
}

/** Percorre o fluxo OAuth de verdade (no simulador): conectar -> consentir -> retorno. */
async function conectar(p, conta = 1001 + seq) {
  const ida = await p.agent.get("/parceiro/mercadopago/conectar");
  const state = new URL(ida.headers.location, "http://x").searchParams.get("state");
  const volta = await p.agent.get(`/parceiro/mercadopago/retorno?state=${state}&code=MOCK-CONTA-${conta}:abc`);
  return { state, volta };
}

async function experiencia(partnerId, precoCents = 25000) {
  const serviceId = crypto.randomUUID();
  await db.query(
    `INSERT INTO services (id, slug, title, location, category, price_cents, partner_id, review_status)
     VALUES ($1, $2, 'Passeio de Barco', 'Ilhabela, SP', 'mergulho', $3, $4, 'APPROVED')`,
    [serviceId, `exp-${crypto.randomBytes(3).toString("hex")}`, precoCents, partnerId]
  );
  const slotId = crypto.randomUUID();
  await db.query(
    `INSERT INTO service_slots (id, service_id, starts_at, capacity) VALUES ($1, $2, NOW() + INTERVAL 5 DAY, 10)`, [slotId, serviceId]
  );
  return { serviceId, slotId };
}

async function pagar(slotId, quantidade = 1) {
  const cliente = await createUser({ email: `cli${++seq}@aquatrip.local`, name: "Cliente" });
  const b = await bookingService.createBooking({ userId: cliente.id, slotId, quantity: quantidade });
  const u = { id: cliente.id, role: "USER", email: cliente.email, name: cliente.name };
  const r = await bookingService.startPayment({ bookingId: b.id, user: u, method: "CREDIT_CARD", cardLastFour: "4242" });
  return { booking: b, payment: r.payment, cliente: u };
}

describe("Conexão OAuth", () => {
  it("conecta pelo fluxo completo e guarda os tokens CIFRADOS", async () => {
    const p = await parceiro();
    const { volta } = await conectar(p, 1001);
    expect(volta.headers.location).toBe("/parceiro?mp=conectado");

    const { rows } = await db.query("SELECT * FROM partners WHERE id = $1", [p.partnerId]);
    expect(rows[0].mp_connected_at).not.toBeNull();
    expect(rows[0].mp_user_id).toBe("1001");
    expect(rows[0].mp_access_token_enc).toMatch(/^v1\./);
    expect(rows[0].mp_access_token_enc).not.toContain("TEST-SIM"); // nada em claro
    const aud = (await db.query("SELECT CAST(metadata AS CHAR) m FROM audit_log WHERE action = 'PARTNER_MP_CONNECTED'")).rows;
    expect(aud[0].m).not.toMatch(/TEST-SIM|TG-SIM/);
  });

  it("recusa state errado e state reutilizado (uso único)", async () => {
    const p = await parceiro();
    const ida = await p.agent.get("/parceiro/mercadopago/conectar");
    const state = new URL(ida.headers.location, "http://x").searchParams.get("state");
    const errado = await p.agent.get(`/parceiro/mercadopago/retorno?state=${"0".repeat(64)}&code=MOCK-CONTA-1:x`);
    expect(erroDe(errado)).toMatch(/Link de conexão inválido/);
    // A tentativa errada já consumiu o state: nem o certo vale mais.
    const certo = await p.agent.get(`/parceiro/mercadopago/retorno?state=${state}&code=MOCK-CONTA-1:x`);
    expect(certo.headers.location).toMatch(/mp_erro/);
    expect((await db.query("SELECT mp_connected_at FROM partners WHERE id = $1", [p.partnerId])).rows[0].mp_connected_at).toBeNull();
  });

  it("ataque: o state do atacante não serve na sessão da vítima", async () => {
    const atacante = await parceiro();
    const vitima = await parceiro();
    const ida = await atacante.agent.get("/parceiro/mercadopago/conectar");
    const stateDoAtacante = new URL(ida.headers.location, "http://x").searchParams.get("state");
    // A vítima é induzida a abrir o link de retorno montado pelo atacante.
    const r = await vitima.agent.get(`/parceiro/mercadopago/retorno?state=${stateDoAtacante}&code=MOCK-CONTA-6666:x`);
    expect(r.headers.location).toMatch(/mp_erro/);
    expect((await db.query("SELECT mp_user_id FROM partners WHERE id = $1", [vitima.partnerId])).rows[0].mp_user_id).toBeNull();
  });

  it("state expirado é recusado", () => {
    const req = { session: { mpOauth: { state: "abc", partnerId: "x", expira: Date.now() - 1 } } };
    expect(() => marketplace._conferirState(req, "abc")).toThrow(/expirou/);
  });

  it("recusa a conta do próprio AquaTrip e conta já usada por outro parceiro", async () => {
    process.env.MP_PLATFORM_USER_ID = "7777";
    const p1 = await parceiro();
    const r1 = await conectar(p1, 7777);
    expect(erroDe(r1.volta)).toMatch(/conta do próprio AquaTrip/);
    delete process.env.MP_PLATFORM_USER_ID;

    await conectar(p1, 5000);
    const p2 = await parceiro();
    const r2 = await conectar(p2, 5000);
    expect(erroDe(r2.volta)).toMatch(/não pode ser usada/);
  });

  it("PAYMENT_PROVIDER vazio (automático) também usa o simulador — mesma decisão dos pagamentos", async () => {
    // Regressão: a conexão comparava com "mock" literal, e a camada de
    // pagamento trata vazio como automático -> simulador. Achado rodando
    // o fluxo contra o servidor de desenvolvimento, não pelos testes.
    const antes = process.env.PAYMENT_PROVIDER;
    process.env.PAYMENT_PROVIDER = "";
    const p = await parceiro();
    const ida = await p.agent.get("/parceiro/mercadopago/conectar");
    process.env.PAYMENT_PROVIDER = antes;
    expect(ida.headers.location).toMatch(/^\/parceiro\/mercadopago\/simulador\?state=/);
  });

  it("o simulador de consentimento não existe fora do modo simulado", async () => {
    const p = await parceiro();
    process.env.PAYMENT_PROVIDER = "mercadopago";
    const r = await p.agent.get("/parceiro/mercadopago/simulador?state=x");
    process.env.PAYMENT_PROVIDER = "mock";
    expect(r.status).toBe(404);
  });
});

describe("Cofre", () => {
  it("token copiado para outro parceiro no banco não decifra", async () => {
    const a = await parceiro(); await conectar(a, 3001);
    const b = await parceiro(); await conectar(b, 3002);
    // MySQL não deixa referenciar a MESMA tabela alvo do UPDATE dentro da
    // subquery — só funciona por trás de uma tabela derivada (subquery
    // aliada), que força o MySQL a materializar o resultado antes.
    await db.query(
      `UPDATE partners SET mp_access_token_enc = (
         SELECT tok FROM (SELECT mp_access_token_enc AS tok FROM partners WHERE id = $1) x
       ) WHERE id = $2`,
      [a.partnerId, b.partnerId]
    );
    await expect(marketplace.credencialDoParceiro(b.partnerId)).rejects.toThrow();
  });

  it("renova o token quando falta menos de 7 dias", async () => {
    const p = await parceiro(); await conectar(p);
    await db.query("UPDATE partners SET mp_token_expires_at = NOW() + INTERVAL 2 DAY WHERE id = $1", [p.partnerId]);
    const antes = (await db.query("SELECT mp_access_token_enc FROM partners WHERE id = $1", [p.partnerId])).rows[0].mp_access_token_enc;
    await marketplace.credencialDoParceiro(p.partnerId);
    const { rows } = await db.query(
      "SELECT mp_access_token_enc, mp_token_expires_at > NOW() + INTERVAL 170 DAY AS renovado FROM partners WHERE id = $1", [p.partnerId]);
    // MySQL não tem booleano nativo: uma expressão de comparação vira 1/0.
    expect(Boolean(rows[0].renovado)).toBe(true);
    expect(rows[0].mp_access_token_enc).not.toBe(antes);
  });
});

describe("Divisão do pagamento", () => {
  it("venda de parceiro: criada com o token DELE e comissão calculada no servidor", async () => {
    const p = await parceiro({ comissao: 15 }); await conectar(p);
    const { slotId } = await experiencia(p.partnerId, 25000);
    const { payment } = await pagar(slotId, 2); // 2 × R$ 250 = R$ 500

    expect(payment.partner_id).toBe(p.partnerId);
    expect(Number(payment.commission_pct)).toBe(15);
    expect(payment.application_fee_cents).toBe(7500); // 15% de R$ 500

    const { accessToken } = await marketplace.credencialDoParceiro(p.partnerId);
    const registro = mock._inspecionar(payment.provider_payment_id);
    expect(registro.vendedor).toEqual({ fp: mock._impressao(accessToken), feeCents: 7500 });
  });

  it("venda da própria AquaTrip continua sem divisão", async () => {
    const serviceId = crypto.randomUUID();
    await db.query(
      `INSERT INTO services (id, slug, title, category, price_cents) VALUES ($1, 'da-casa', 'Da Casa', 'pesca', 10000)`, [serviceId]);
    const slotId = crypto.randomUUID();
    await db.query(
      `INSERT INTO service_slots (id, service_id, starts_at, capacity) VALUES ($1, $2, NOW() + INTERVAL 3 DAY, 5)`, [slotId, serviceId]);
    const { payment } = await pagar(slotId);
    expect(payment.partner_id).toBeNull();
    expect(payment.application_fee_cents).toBeNull();
    expect(mock._inspecionar(payment.provider_payment_id).vendedor).toBeNull();
  });

  it("a comissão fica congelada na venda", async () => {
    const p = await parceiro({ comissao: 15 }); await conectar(p);
    const { slotId } = await experiencia(p.partnerId, 10000);
    const { payment } = await pagar(slotId);
    await db.query("UPDATE partners SET commission_pct = 30 WHERE id = $1", [p.partnerId]);
    const { rows } = await db.query("SELECT commission_pct, application_fee_cents FROM payments WHERE id = $1", [payment.id]);
    expect(Number(rows[0].commission_pct)).toBe(15);
    expect(rows[0].application_fee_cents).toBe(1500);
  });

  it("arredondamento da comissão e nunca igual ao valor", () => {
    expect(marketplace.calcularComissao(1001, 15)).toBe(150);
    expect(marketplace.calcularComissao(10000, 12.5)).toBe(1250);
    expect(marketplace.calcularComissao(1, 50)).toBe(0);
    expect(marketplace.calcularComissao(100, 0)).toBe(0);
  });

  it("o banco recusa divisão incoerente", async () => {
    const p = await parceiro(); await conectar(p);
    const { slotId } = await experiencia(p.partnerId, 10000);
    const { payment } = await pagar(slotId);
    await expect(db.query("UPDATE payments SET application_fee_cents = amount_cents WHERE id = $1", [payment.id]))
      .rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  });

  it("parceiro desconectado: some da vitrine e não recebe pagamento", async () => {
    const p = await parceiro(); await conectar(p);
    const { slotId } = await experiencia(p.partnerId);
    const cliente = await createUser({ email: "espera@aquatrip.local" });
    const b = await bookingService.createBooking({ userId: cliente.id, slotId, quantity: 1 });
    expect((await request(app).get("/mergulho")).text).toContain("Passeio de Barco");

    await p.agent.post("/api/parceiro/mercadopago/desconectar").set("X-CSRF-Token", p.csrf);
    expect((await request(app).get("/mergulho")).text).not.toContain("Passeio de Barco");
    await expect(bookingService.startPayment({
      bookingId: b.id, user: { id: cliente.id, role: "USER", email: cliente.email, name: "C" },
      method: "CREDIT_CARD", cardLastFour: "4242",
    })).rejects.toMatchObject({ code: "NOT_CONNECTED" });
  });
});

describe("Webhook e estorno usam a credencial do parceiro", () => {
  it("webhook sem status consulta o pagamento COM O TOKEN DO PARCEIRO e confirma a reserva", async () => {
    const p = await parceiro(); await conectar(p);
    const { slotId } = await experiencia(p.partnerId);
    const cliente = await createUser({ email: "pix@aquatrip.local" });
    const b = await bookingService.createBooking({ userId: cliente.id, slotId, quantity: 1 });
    const r = await bookingService.startPayment({
      bookingId: b.id, user: { id: cliente.id, role: "USER", email: cliente.email, name: "C" }, method: "PIX",
    });
    mock.simulateStatusChange(r.payment.provider_payment_id, "APPROVED");

    // Sem data.status: força o caminho real (consulta à API do gateway).
    const corpo = JSON.stringify({ id: "evt-" + Date.now(), type: "payment", data: { id: r.payment.provider_payment_id } });
    const res = await request(app).post("/webhooks/payments")
      .set("Content-Type", "application/json")
      .set("x-aquatrip-signature", crypto.createHmac("sha256", process.env.PAYMENT_WEBHOOK_SECRET).update(corpo).digest("hex"))
      .send(corpo);
    expect(res.status).toBe(200);
    const { rows } = await db.query("SELECT status FROM bookings WHERE id = $1", [b.id]);
    expect(rows[0].status).toBe("CONFIRMED");
  });

  it("consultar com o token da plataforma falha (como no Mercado Pago real)", async () => {
    const p = await parceiro(); await conectar(p);
    const { slotId } = await experiencia(p.partnerId);
    const { payment } = await pagar(slotId);
    await expect(mock.getPayment(payment.provider_payment_id, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("estorno de venda de parceiro usa o token dele", async () => {
    const p = await parceiro(); await conectar(p);
    const { slotId } = await experiencia(p.partnerId);
    const { booking, cliente } = await pagar(slotId);
    await bookingService.cancelBooking({ bookingId: booking.id, user: cliente });
    const { rows } = await db.query("SELECT status FROM payments WHERE booking_id = $1", [booking.id]);
    expect(rows[0].status).toBe("REFUNDED");
  });
});

describe("Cofre direto", () => {
  it("cifra amarrado ao dono", () => {
    const t = cofre.cifrar("segredo", { finalidade: "f", dono: "A" });
    expect(cofre.decifrar(t, { finalidade: "f", dono: "A" })).toBe("segredo");
    expect(() => cofre.decifrar(t, { finalidade: "f", dono: "B" })).toThrow();
    expect(() => cofre.decifrar(t, { finalidade: "g", dono: "A" })).toThrow();
  });
});
