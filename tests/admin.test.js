/* ==============================================================
   Testes — API administrativa (/api/admin/*)
   ============================================================== */
const request = require("supertest");
const crypto = require("crypto");
const {
  app, db, resetDatabase, truncateTables, createUser, createServiceWithSlot, extractCsrf, loginAs,
} = require("./helpers");
const bookingService = require("../app/services/bookingService");
const adminService = require("../app/services/adminService");

beforeEach(async () => {
  await resetDatabase();
  await truncateTables("trips");
});

/** Admin logado + token CSRF para as chamadas JSON. */
async function comoAdmin() {
  const admin = await createUser({ email: "chefe@aquatrip.local", role: "ADMIN" });
  const { agent, csrf } = await loginAs(admin);
  return { admin, agent, csrf };
}

function json(agent, metodo, url, csrf, corpo) {
  const r = agent[metodo](url).set("Accept", "application/json");
  if (csrf) r.set("X-CSRF-Token", csrf);
  return corpo ? r.send(corpo) : r;
}

describe("Permissões", () => {
  const rotas = [
    ["get", "/api/admin/painel"],
    ["get", "/api/admin/usuarios"],
    ["get", "/api/admin/experiencias"],
    ["get", "/api/admin/transacoes"],
  ];

  it("visitante recebe 401 em JSON (não redirect HTML)", async () => {
    for (const [m, url] of rotas) {
      const res = await request(app)[m](url);
      expect(res.status).toBe(401);
      expect(res.headers["content-type"]).toMatch(/json/);
    }
  });

  it("usuário comum recebe 403 em JSON", async () => {
    const user = await createUser({ email: "comum@aquatrip.local" });
    const { agent } = await loginAs(user);
    for (const [m, url] of rotas) {
      const res = await agent[m](url);
      expect(res.status).toBe(403);
      expect(res.body.error).toBeDefined();
    }
  });

  it("usuário comum não cria experiência nem com token válido", async () => {
    const user = await createUser({ email: "comum2@aquatrip.local" });
    const { agent, csrf } = await loginAs(user);
    const res = await json(agent, "post", "/api/admin/experiencias", csrf,
      { title: "Invasão", location: "X Y", category: "praia", preco: 10 });
    expect(res.status).toBe(403);
    const { rows } = await db.query("SELECT 1 FROM services");
    expect(rows).toHaveLength(0);
  });
});

describe("Painel", () => {
  it("mostra números reais do banco", async () => {
    const { agent } = await comoAdmin();
    await createUser({ email: "cliente@aquatrip.local" });
    await createServiceWithSlot({ priceCents: 20000 });

    const res = await agent.get("/api/admin/painel");
    expect(res.status).toBe(200);
    expect(res.body.metricas.usuarios).toBe(2);
    expect(res.body.metricas.experiencias_ativas).toBe(1);
    expect(res.body.receitaMensal).toHaveLength(6);
  });

  it("detecta pagamento aprovado com reserva não confirmada", async () => {
    const { agent } = await comoAdmin();
    const cliente = await createUser({ email: "pagou@aquatrip.local" });
    const { slot } = await createServiceWithSlot();
    const booking = await bookingService.createBooking({ userId: cliente.id, slotId: slot.id, quantity: 1 });

    // Reproduz o estado que o bug da Fase 4 deixava no banco.
    await db.query(
      `INSERT INTO payments (id, booking_id, provider, provider_payment_id, method, status,
                             amount_cents, currency, installments, idempotency_key, paid_at)
       VALUES ($1, $2, 'mock', 'mock_bug', 'PIX', 'APPROVED', 10000, 'BRL', 1, 'k-bug', NOW())`,
      [crypto.randomUUID(), booking.id]
    );

    const res = await agent.get("/api/admin/painel");
    expect(res.body.inconsistencias).toHaveLength(1);
    expect(res.body.inconsistencias[0].tipo).toBe("PAGO_SEM_CONFIRMACAO");
    expect(res.body.inconsistencias[0].email).toBe("pagou@aquatrip.local");
  });

  it("banco consistente não gera alerta", async () => {
    const { agent } = await comoAdmin();
    const res = await agent.get("/api/admin/painel");
    expect(res.body.inconsistencias).toHaveLength(0);
  });
});

describe("Experiências", () => {
  it("cria com preço no formato brasileiro e grava em centavos", async () => {
    const { agent, csrf } = await comoAdmin();
    const res = await json(agent, "post", "/api/admin/experiencias", csrf, {
      title: "Flutuação no Rio da Prata", location: "Bonito, MS",
      category: "mergulho", preco: "1.890,50", description: "Águas cristalinas.",
    });
    expect(res.status).toBe(201);
    expect(res.body.experiencia.price_cents).toBe(189050);
    expect(res.body.experiencia.slug).toBe("flutuacao-no-rio-da-prata");
  });

  it("gera slug único quando o título se repete", async () => {
    const { agent, csrf } = await comoAdmin();
    const corpo = { title: "Mergulho Noturno", location: "Arraial, RJ", category: "mergulho", preco: 100 };
    const a = await json(agent, "post", "/api/admin/experiencias", csrf, corpo);
    const b = await json(agent, "post", "/api/admin/experiencias", csrf, corpo);
    expect(a.body.experiencia.slug).toBe("mergulho-noturno");
    expect(b.body.experiencia.slug).toBe("mergulho-noturno-2");
  });

  it("valida categoria, preço e campos obrigatórios", async () => {
    const { agent, csrf } = await comoAdmin();
    const casos = [
      { title: "Teste ok", location: "Local", category: "parque-aquatico", preco: 10 },
      { title: "Teste ok", location: "Local", category: "praia", preco: -5 },
      { title: "Teste ok", location: "Local", category: "praia", preco: "abc" },
      { title: "x", location: "Local", category: "praia", preco: 10 },
    ];
    for (const corpo of casos) {
      const res = await json(agent, "post", "/api/admin/experiencias", csrf, corpo);
      expect(res.status).toBe(422);
    }
    const { rows } = await db.query("SELECT 1 FROM services");
    expect(rows).toHaveLength(0);
  });

  it("exige CSRF", async () => {
    const { agent } = await comoAdmin();
    const res = await json(agent, "post", "/api/admin/experiencias", null,
      { title: "Sem token", location: "Local", category: "praia", preco: 10 });
    expect(res.status).toBe(403);
  });

  it("atualiza uma experiência", async () => {
    const { agent, csrf } = await comoAdmin();
    const { service } = await createServiceWithSlot({ priceCents: 5000 });
    const res = await json(agent, "put", `/api/admin/experiencias/${service.id}`, csrf, {
      title: "Novo título", location: "Nova cidade", category: "caiaque", preco: "75,00",
    });
    expect(res.status).toBe(200);
    expect(res.body.experiencia.price_cents).toBe(7500);
    expect(res.body.experiencia.category).toBe("caiaque");
  });

  it("recusa desativar experiência com reserva ativa", async () => {
    const { agent, csrf } = await comoAdmin();
    const cliente = await createUser({ email: "reservou@aquatrip.local" });
    const { service, slot } = await createServiceWithSlot();
    await bookingService.createBooking({ userId: cliente.id, slotId: slot.id, quantity: 1 });

    const res = await json(agent, "post", `/api/admin/experiencias/${service.id}/status`, csrf, { ativa: false });
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe("HAS_LIVE_BOOKINGS");

    const { rows } = await db.query("SELECT active FROM services WHERE id = $1", [service.id]);
    expect(rows[0].active).toBe(true);
  });

  it("desativa e reativa quando não há reserva viva", async () => {
    const { agent, csrf } = await comoAdmin();
    const { service } = await createServiceWithSlot();

    let res = await json(agent, "post", `/api/admin/experiencias/${service.id}/status`, csrf, { ativa: false });
    expect(res.body.experiencia.active).toBe(false);
    res = await json(agent, "post", `/api/admin/experiencias/${service.id}/status`, csrf, { ativa: true });
    expect(res.body.experiencia.active).toBe(true);
  });

  it("id malformado devolve 400, não erro 500", async () => {
    const { agent, csrf } = await comoAdmin();
    const res = await json(agent, "put", "/api/admin/experiencias/nao-e-uuid", csrf,
      { title: "Teste ok", location: "Local", category: "praia", preco: 10 });
    expect(res.status).toBe(400);
  });
});

describe("Categorias", () => {
  it("o banco recusa categoria fora do padrão (constraint)", async () => {
    // 'invalida' — não pode ser algo como 'Mergulho' com maiúscula: a
    // collation padrão do MySQL (utf8mb4_0900_ai_ci) é case-insensitive,
    // então o CHECK aceitaria por bater com 'mergulho' ignorando o caso.
    await expect(
      db.query(
        `INSERT INTO services (id, slug, title, category, price_cents) VALUES ($1,'z','z','invalida',1)`,
        [crypto.randomUUID()]
      )
    ).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  });
});

describe("Suspensão de usuário", () => {
  it("suspende, derruba a sessão ativa e bloqueia o login", async () => {
    const { agent, csrf } = await comoAdmin();
    const alvo = await createUser({ email: "alvo@aquatrip.local", password: "SenhaDoAlvo123!" });
    const { agent: sessaoDoAlvo } = await loginAs(alvo);
    expect((await sessaoDoAlvo.get("/minhas-reservas")).status).toBe(200);

    const res = await json(agent, "post", `/api/admin/usuarios/${alvo.id}/suspender`, csrf,
      { dias: 7, motivo: "teste" });
    expect(res.status).toBe(200);
    expect(res.body.usuario.status).toBe("SUSPENDED");

    // A sessão que estava aberta morre na hora.
    expect((await sessaoDoAlvo.get("/minhas-reservas")).status).toBe(302);

    // E um novo login com a senha certa é recusado com o motivo.
    const nova = request.agent(app);
    const pagina = await nova.get("/login");
    const r = await nova.post("/login").type("form")
      .send({ email: alvo.email, senha: "SenhaDoAlvo123!", _csrf: extractCsrf(pagina.text) });
    expect(decodeURIComponent(r.headers.location)).toMatch(/suspensa/i);
  });

  it("não revela a suspensão para quem erra a senha (anti-enumeração)", async () => {
    const alvo = await createUser({ email: "enum@aquatrip.local", password: "SenhaCerta123!" });
    await db.query(
      "UPDATE users SET status = 'SUSPENDED', suspended_until = NOW() + INTERVAL 7 DAY WHERE id = $1",
      [alvo.id]
    );
    const agent = request.agent(app);
    const pagina = await agent.get("/login");
    const r = await agent.post("/login").type("form")
      .send({ email: alvo.email, senha: "Chute999!", _csrf: extractCsrf(pagina.text) });
    const msg = decodeURIComponent(r.headers.location);
    expect(msg).toContain("E-mail ou senha inválidos");
    expect(msg).not.toMatch(/suspensa/i);
  });

  it("suspensão vencida volta a permitir o login", async () => {
    const alvo = await createUser({ email: "venceu@aquatrip.local", password: "SenhaCerta123!" });
    await db.query(
      "UPDATE users SET status = 'SUSPENDED', suspended_until = NOW() - INTERVAL 1 DAY WHERE id = $1",
      [alvo.id]
    );
    const agent = request.agent(app);
    const pagina = await agent.get("/login");
    const r = await agent.post("/login").type("form")
      .send({ email: alvo.email, senha: "SenhaCerta123!", redirect: "/", _csrf: extractCsrf(pagina.text) });
    expect(r.headers.location).toBe("/");
  });

  it("admin não suspende a si mesmo nem outro admin", async () => {
    const { admin, agent, csrf } = await comoAdmin();
    const outro = await createUser({ email: "outroadmin@aquatrip.local", role: "ADMIN" });

    const a = await json(agent, "post", `/api/admin/usuarios/${admin.id}/suspender`, csrf, { dias: 1 });
    expect(a.body.codigo).toBe("SELF_SUSPEND");
    const b = await json(agent, "post", `/api/admin/usuarios/${outro.id}/suspender`, csrf, { dias: 1 });
    expect(b.body.codigo).toBe("ADMIN_PROTECTED");
  });

  it("reativa o usuário", async () => {
    const { agent, csrf } = await comoAdmin();
    const alvo = await createUser({ email: "volta@aquatrip.local" });
    await json(agent, "post", `/api/admin/usuarios/${alvo.id}/suspender`, csrf, { dias: null });
    const res = await json(agent, "post", `/api/admin/usuarios/${alvo.id}/reativar`, csrf);
    expect(res.body.usuario.status).toBe("ACTIVE");
    expect(res.body.usuario.suspended_until).toBeNull();
  });

  it("registra suspensão e reativação na auditoria", async () => {
    const { agent, csrf } = await comoAdmin();
    const alvo = await createUser({ email: "audit@aquatrip.local" });
    await json(agent, "post", `/api/admin/usuarios/${alvo.id}/suspender`, csrf, { dias: 3, motivo: "spam" });
    await json(agent, "post", `/api/admin/usuarios/${alvo.id}/reativar`, csrf);

    const { rows } = await db.query(
      "SELECT action, metadata FROM audit_log WHERE action LIKE 'ADMIN_USER_%' ORDER BY id"
    );
    expect(rows.map((r) => r.action)).toEqual(["ADMIN_USER_SUSPENDED", "ADMIN_USER_REACTIVATED"]);
    expect(rows[0].metadata.motivo).toBe("spam");
  });
});

describe("Transações", () => {
  it("lista pagamentos reais com a taxa da plataforma", async () => {
    const { agent } = await comoAdmin();
    const cliente = await createUser({ email: "comprou@aquatrip.local" });
    const { slot } = await createServiceWithSlot({ priceCents: 30000 });
    const booking = await bookingService.createBooking({ userId: cliente.id, slotId: slot.id, quantity: 1 });
    await bookingService.startPayment({
      bookingId: booking.id,
      user: { id: cliente.id, role: "USER", email: cliente.email, name: cliente.name },
      method: "CREDIT_CARD",
      cardLastFour: "4242",
    });

    const res = await agent.get("/api/admin/transacoes?status=APPROVED");
    expect(res.body.transacoes).toHaveLength(1);
    const t = res.body.transacoes[0];
    expect(t.amount_cents).toBe(30000);
    expect(t.taxa_cents).toBe(Math.round(30000 * adminService.PLATFORM_FEE_PERCENT / 100));
    expect(t.cliente_email).toBe("comprou@aquatrip.local");
  });
});

describe("Escape de HTML no cliente", () => {
  it("neutraliza marcação vinda do servidor", () => {
    global.window = {};
    require("../app/public/js/escape.js");
    const esc = global.window.escHTML;
    expect(esc('<img src=x onerror="alert(1)">')).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(esc(null)).toBe("");
    expect(esc(42)).toBe("42");
    delete global.window;
  });
});
