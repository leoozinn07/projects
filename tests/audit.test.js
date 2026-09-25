/* ==============================================================
   Testes — trilha de auditoria e rate limiting
   ============================================================== */
const request = require("supertest");
const {
  app,
  db,
  resetDatabase,
  createUser,
  createServiceWithSlot,
  extractCsrf,
  loginAs,
  freshCsrf,
} = require("./helpers");
const auditService = require("../app/services/auditService");
const bookingService = require("../app/services/bookingService");
const { AuditAction } = auditService;

beforeEach(resetDatabase);

async function eventos(action = null) {
  const { rows } = await db.query(
    action
      ? "SELECT * FROM audit_log WHERE action = $1 ORDER BY id"
      : "SELECT * FROM audit_log ORDER BY id",
    action ? [action] : []
  );
  return rows;
}

describe("Sanitização do metadata", () => {
  it("descarta chaves sensíveis", () => {
    const limpo = auditService.sanitize({
      email: "user@teste.com",
      senha: "SenhaSecreta123!",
      password: "outra",
      _csrf: "token-csrf",
      cardToken: "tok_123",
      cvv: "123",
      card_number: "4111111111111111",
      authorization: "Bearer xyz",
      valorCentavos: 5000,
    });

    expect(limpo).toEqual({ email: "user@teste.com", valorCentavos: 5000 });
  });

  it("não guarda objetos aninhados (vetor comum de vazamento)", () => {
    const limpo = auditService.sanitize({
      ok: 1,
      aninhado: { segredo: "não deveria estar aqui" },
      lista: [1, 2, 3],
    });

    expect(limpo.aninhado).toBe("[objeto]");
    expect(limpo.lista).toBe("[3 itens]");
    expect(JSON.stringify(limpo)).not.toContain("não deveria");
  });
});

describe("Auditoria de autenticação", () => {
  it("registra login bem-sucedido com usuário e IP", async () => {
    const user = await createUser({ email: "audit@aquatrip.local" });
    await loginAs(user);

    const rows = await eventos(AuditAction.LOGIN_SUCCESS);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(user.id);
    expect(rows[0].ip_address).toBeTruthy();
    expect(rows[0].metadata.email).toBe(user.email);
  });

  it("registra tentativa de login falha sem gravar a senha", async () => {
    await createUser({ email: "vitima@aquatrip.local", password: "SenhaCerta123!" });
    const agent = request.agent(app);
    const page = await agent.get("/login");
    const csrf = extractCsrf(page.text);

    await agent.post("/login").type("form").send({
      email: "vitima@aquatrip.local",
      senha: "TentativaDeInvasao123!",
      _csrf: csrf,
    });

    const rows = await eventos(AuditAction.LOGIN_FAILED);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.email).toBe("vitima@aquatrip.local");
    expect(JSON.stringify(rows[0].metadata)).not.toContain("TentativaDeInvasao");
  });

  it("registra cadastro e logout", async () => {
    const agent = request.agent(app);
    const page = await agent.get("/cadastro");
    const csrf = extractCsrf(page.text);
    await agent.post("/cadastro").type("form").send({
      nome: "Novo Usuário",
      email: "novo@aquatrip.local",
      senha: "SenhaForte123!",
      "confirma-senha": "SenhaForte123!",
      aceite: "on",
      _csrf: csrf,
    });

    expect(await eventos(AuditAction.USER_REGISTERED)).toHaveLength(1);

    const user = { email: "novo@aquatrip.local", password: "SenhaForte123!" };
    const { agent: logado, csrf: csrf2 } = await loginAs(user);
    await logado.post("/logout").type("form").send({ _csrf: csrf2 });

    expect(await eventos(AuditAction.LOGOUT)).toHaveLength(1);
  });

  it("registra bloqueio de conta após tentativas repetidas", async () => {
    const user = await createUser({ email: "trava@aquatrip.local" });
    const agent = request.agent(app);

    for (let i = 0; i < 6; i++) {
      const page = await agent.get("/login");
      const csrf = extractCsrf(page.text);
      await agent
        .post("/login")
        .type("form")
        .send({ email: user.email, senha: `Errada${i}!`, _csrf: csrf });
    }

    expect((await eventos(AuditAction.ACCOUNT_LOCKED)).length).toBeGreaterThan(0);
  });
});

describe("Auditoria de autorização", () => {
  it("registra tentativa negada de acesso à área administrativa", async () => {
    const user = await createUser({ email: "curioso@aquatrip.local", role: "USER" });
    const { agent } = await loginAs(user);

    await agent.get("/admin");

    const rows = await eventos(AuditAction.ACCESS_DENIED);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(user.id);
    expect(rows[0].metadata.rota).toBe("/admin");
    expect(rows[0].metadata.papelAtual).toBe("USER");
  });

  it("registra acesso legítimo de ADMIN", async () => {
    const admin = await createUser({ email: "chefe@aquatrip.local", role: "ADMIN" });
    const { agent } = await loginAs(admin);

    await agent.get("/admin");

    const rows = await eventos(AuditAction.ADMIN_ACCESS);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].user_id).toBe(admin.id);
  });
});

describe("Auditoria de reservas e pagamentos", () => {
  it("registra a cadeia completa: reserva, pagamento, confirmação", async () => {
    const user = await createUser();
    const { slot } = await createServiceWithSlot({ priceCents: 15000 });
    const { agent } = await loginAs(user);
    let csrf = await freshCsrf(agent, "/reservar");

    const res = await agent
      .post("/reservar")
      .type("form")
      .send({ slotId: slot.id, quantity: 1, _csrf: csrf });
    const bookingId = res.headers.location.match(/reservas\/([0-9a-f-]+)/)[1];

    csrf = await freshCsrf(agent, `/reservas/${bookingId}/checkout`);
    await agent
      .post(`/reservas/${bookingId}/pagar`)
      .type("form")
      .send({ method: "CREDIT_CARD", cardLastFour: "4242", _csrf: csrf });

    const criada = await eventos(AuditAction.BOOKING_CREATED);
    expect(criada).toHaveLength(1);
    expect(criada[0].metadata.valorCentavos).toBe(15000);

    expect(await eventos(AuditAction.PAYMENT_STARTED)).toHaveLength(1);

    const mudanca = await eventos(AuditAction.PAYMENT_STATUS_CHANGED);
    expect(mudanca.length).toBeGreaterThan(0);
    expect(mudanca[0].metadata.para).toBe("APPROVED");

    expect(await eventos(AuditAction.BOOKING_CONFIRMED)).toHaveLength(1);
  });

  it("registra estorno com o valor envolvido", async () => {
    const user = await createUser();
    const { slot } = await createServiceWithSlot({ priceCents: 30000 });
    const { agent } = await loginAs(user);
    let csrf = await freshCsrf(agent, "/reservar");

    const res = await agent
      .post("/reservar")
      .type("form")
      .send({ slotId: slot.id, quantity: 1, _csrf: csrf });
    const bookingId = res.headers.location.match(/reservas\/([0-9a-f-]+)/)[1];

    csrf = await freshCsrf(agent, `/reservas/${bookingId}/checkout`);
    await agent
      .post(`/reservas/${bookingId}/pagar`)
      .type("form")
      .send({ method: "CREDIT_CARD", cardLastFour: "4242", _csrf: csrf });

    csrf = await freshCsrf(agent);
    await agent.post(`/reservas/${bookingId}/cancelar`).type("form").send({ _csrf: csrf });

    const estorno = await eventos(AuditAction.PAYMENT_REFUNDED);
    expect(estorno).toHaveLength(1);
    expect(estorno[0].metadata.valorCentavos).toBe(30000);

    const cancel = await eventos(AuditAction.BOOKING_CANCELLED);
    expect(cancel[0].metadata.estornado).toBe(true);
  });

  it("registra expiração de reserva pendente", async () => {
    const user = await createUser();
    const { slot } = await createServiceWithSlot();
    const booking = await bookingService.createBooking({
      userId: user.id,
      slotId: slot.id,
      quantity: 1,
    });
    await db.query("UPDATE bookings SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = $1", [
      booking.id,
    ]);
    await bookingService.expirePendingBookings();

    const rows = await eventos(AuditAction.BOOKING_EXPIRED);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.bookingId).toBe(booking.id);
  });
});

describe("Auditoria de webhook", () => {
  it("registra tentativa de webhook forjado", async () => {
    await request(app)
      .post("/webhooks/payments")
      .set("x-aquatrip-signature", "assinatura-invalida")
      .send({ id: "evt_x", type: "payment.updated", data: { id: "mock_x", status: "APPROVED" } });

    const rows = await eventos(AuditAction.WEBHOOK_REJECTED);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.motivo).toBe("assinatura_invalida");
    expect(rows[0].ip_address).toBeTruthy();
  });
});

describe("Painel de auditoria", () => {
  it("só é acessível para ADMIN", async () => {
    expect((await request(app).get("/admin/auditoria")).status).toBe(302);

    const comum = await createUser({ email: "comum@aquatrip.local", role: "USER" });
    const { agent } = await loginAs(comum);
    expect((await agent.get("/admin/auditoria")).status).toBe(403);
  });

  it("lista os eventos para o ADMIN", async () => {
    const admin = await createUser({ email: "chefe2@aquatrip.local", role: "ADMIN" });
    const { agent } = await loginAs(admin);

    const res = await agent.get("/admin/auditoria");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Trilha de auditoria");
    expect(res.text).toContain("LOGIN_SUCCESS");
  });

  it("filtra por ação", async () => {
    const admin = await createUser({ email: "chefe3@aquatrip.local", role: "ADMIN" });
    const { agent } = await loginAs(admin);

    const res = await agent.get("/admin/auditoria?action=LOGIN_SUCCESS");
    expect(res.status).toBe(200);
  });
});

describe("Auditoria não derruba o fluxo principal", () => {
  it("continua respondendo mesmo se a gravação falhar", async () => {
    const user = await createUser({ email: "resiliente@aquatrip.local" });

    // Simula indisponibilidade da auditoria.
    const original = db.query;
    const spy = jest.spyOn(db, "query").mockImplementation((text, params) => {
      if (typeof text === "string" && text.includes("INSERT INTO audit_log")) {
        return Promise.reject(new Error("auditoria indisponível"));
      }
      return original.call(db, text, params);
    });

    const { agent } = await loginAs(user);
    const res = await agent.get("/minhas-reservas");

    // Login e navegação seguem funcionando: auditoria quebrada não
    // pode impedir alguém de usar o sistema.
    expect(res.status).toBe(200);

    spy.mockRestore();
  });
});

describe("Rate limiting", () => {
  it("expõe os headers de limite nas rotas de escrita", async () => {
    const user = await createUser({ email: "limite@aquatrip.local" });
    const { slot } = await createServiceWithSlot();
    const { agent } = await loginAs(user);
    const csrf = await freshCsrf(agent, "/reservar");

    const res = await agent
      .post("/reservar")
      .type("form")
      .send({ slotId: slot.id, quantity: 1, _csrf: csrf });

    expect(res.headers["ratelimit-limit"]).toBeDefined();
  });

  it("aplica limite ao webhook", async () => {
    const res = await request(app)
      .post("/webhooks/payments")
      .set("x-aquatrip-signature", "x")
      .send({ id: "e", type: "t", data: { id: "mock_a", status: "APPROVED" } });

    expect(res.headers["ratelimit-limit"]).toBeDefined();
  });
});
