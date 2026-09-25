/* ==============================================================
   Testes — conta do usuário: ingressos e diário de viagens
   ============================================================== */
const request = require("supertest");
const {
  app, db, resetDatabase, truncateTables, createUser, createServiceWithSlot, loginAs,
} = require("./helpers");
const bookingService = require("../app/services/bookingService");
const accountController = require("../app/controllers/accountController");
const dataRightsService = require("../app/services/dataRightsService");

beforeEach(async () => {
  await resetDatabase();
  await truncateTables("trips");
});

async function reservaConfirmada(user, opts = {}) {
  const { slot, service } = await createServiceWithSlot(opts);
  const booking = await bookingService.createBooking({ userId: user.id, slotId: slot.id, quantity: 2 });
  await bookingService.startPayment({
    bookingId: booking.id,
    user: { id: user.id, role: "USER", email: user.email, name: user.name },
    method: "CREDIT_CARD",
    cardLastFour: "4242",
  });
  return { booking, service };
}

function json(agent, metodo, url, csrf, corpo) {
  const r = agent[metodo](url).set("Accept", "application/json");
  if (csrf) r.set("X-CSRF-Token", csrf);
  return corpo ? r.send(corpo) : r;
}

describe("Páginas pessoais exigem login", () => {
  it("/viagens e /ingressos redirecionam visitante", async () => {
    for (const rota of ["/viagens", "/ingressos"]) {
      const res = await request(app).get(rota);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain("/login");
    }
  });

  it("as APIs respondem 401 em JSON", async () => {
    expect((await request(app).get("/api/ingressos")).status).toBe(401);
    expect((await request(app).get("/api/viagens")).status).toBe(401);
  });
});

describe("Ingressos", () => {
  it("vêm das reservas confirmadas reais", async () => {
    const user = await createUser({ email: "turista@aquatrip.local" });
    await reservaConfirmada(user, { slug: "aq-1", title: "Visita ao Aquário" });

    const { agent } = await loginAs(user);
    const res = await agent.get("/api/ingressos");
    expect(res.status).toBe(200);
    expect(res.body.ingressos).toHaveLength(1);
    const t = res.body.ingressos[0];
    expect(t.title).toBe("Visita ao Aquário");
    expect(t.sub).toBe("2 pessoas");
    expect(t.status).toBe("valido");
    expect(t.tag).toBe("Mergulho"); // rótulo, não a chave crua
  });

  it("reserva pendente não vira ingresso", async () => {
    const user = await createUser({ email: "pendente@aquatrip.local" });
    const { slot } = await createServiceWithSlot();
    await bookingService.createBooking({ userId: user.id, slotId: slot.id, quantity: 1 });

    const { agent } = await loginAs(user);
    const res = await agent.get("/api/ingressos");
    expect(res.body.ingressos).toHaveLength(0);
  });

  it("um usuário não vê o ingresso de outro", async () => {
    const dono = await createUser({ email: "dono@aquatrip.local" });
    await reservaConfirmada(dono);
    const outro = await createUser({ email: "outro@aquatrip.local" });

    const { agent } = await loginAs(outro);
    const res = await agent.get("/api/ingressos");
    expect(res.body.ingressos).toHaveLength(0);
  });

  it("o código é estável e não expõe o id da reserva", async () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const a = accountController.codigoIngresso(id);
    const b = accountController.codigoIngresso(id);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9A-F]{3}-[0-9A-F]{4}$/);
    expect(id.toUpperCase()).not.toContain(a.replace("-", ""));
  });
});

describe("Diário de viagens", () => {
  const viagem = {
    place: "Bonito", region: "Mato Grosso do Sul",
    startsOn: "2026-05-10", endsOn: "2026-05-14",
    rating: 5, tags: ["Flutuação", "Natureza"], notes: "Rio da Prata.",
  };

  it("cria, lista e exclui", async () => {
    const user = await createUser({ email: "diario@aquatrip.local" });
    const { agent, csrf } = await loginAs(user);

    const criada = await json(agent, "post", "/api/viagens", csrf, viagem);
    expect(criada.status).toBe(201);
    expect(criada.body.viagem.tags).toEqual(["Flutuação", "Natureza"]);

    const lista = await agent.get("/api/viagens");
    expect(lista.body.viagens).toHaveLength(1);

    const del = await json(agent, "delete", `/api/viagens/${criada.body.viagem.id}`, csrf);
    expect(del.status).toBe(204);
    expect((await agent.get("/api/viagens")).body.viagens).toHaveLength(0);
  });

  it("começa vazio — sem viagens de exemplo inventadas", async () => {
    const user = await createUser({ email: "novo@aquatrip.local" });
    const { agent } = await loginAs(user);
    const res = await agent.get("/api/viagens");
    expect(res.body.viagens).toEqual([]);
  });

  it("valida datas e campos", async () => {
    const user = await createUser({ email: "valida@aquatrip.local" });
    const { agent, csrf } = await loginAs(user);

    const volta = await json(agent, "post", "/api/viagens", csrf,
      { place: "Teste", startsOn: "2026-05-14", endsOn: "2026-05-10" });
    expect(volta.status).toBe(422);
    expect(volta.body.error).toMatch(/volta/i);

    const nota = await json(agent, "post", "/api/viagens", csrf, { place: "Teste", rating: 9 });
    expect(nota.status).toBe(422);

    const semLugar = await json(agent, "post", "/api/viagens", csrf, { region: "SP" });
    expect(semLugar.status).toBe(422);
  });

  it("exige CSRF para gravar", async () => {
    const user = await createUser({ email: "csrfviagem@aquatrip.local" });
    const { agent } = await loginAs(user);
    const res = await json(agent, "post", "/api/viagens", null, viagem);
    expect(res.status).toBe(403);
  });

  it("um usuário não edita nem exclui a viagem de outro (IDOR)", async () => {
    const dono = await createUser({ email: "donoviagem@aquatrip.local" });
    const { agent: agDono, csrf: csDono } = await loginAs(dono);
    const criada = await json(agDono, "post", "/api/viagens", csDono, viagem);
    const id = criada.body.viagem.id;

    const intruso = await createUser({ email: "intrusoviagem@aquatrip.local" });
    const { agent, csrf } = await loginAs(intruso);

    // 404, não 403: 403 confirmaria que o id existe.
    const edit = await json(agent, "put", `/api/viagens/${id}`, csrf, { ...viagem, place: "Hackeado" });
    expect(edit.status).toBe(404);
    const del = await json(agent, "delete", `/api/viagens/${id}`, csrf);
    expect(del.status).toBe(404);
    expect((await agent.get("/api/viagens")).body.viagens).toHaveLength(0);

    const { rows } = await db.query("SELECT place FROM trips WHERE id = $1", [id]);
    expect(rows[0].place).toBe("Bonito"); // intacta
  });

  it("entra na exportação de dados da LGPD", async () => {
    const user = await createUser({ email: "exporta@aquatrip.local" });
    const { agent, csrf } = await loginAs(user);
    await json(agent, "post", "/api/viagens", csrf, viagem);

    const dados = await dataRightsService.exportUserData(user.id);
    expect(dados.diario_de_viagens).toHaveLength(1);
    expect(dados.diario_de_viagens[0].place).toBe("Bonito");
  });

  it("é apagado junto com a conta", async () => {
    const user = await createUser({ email: "apaga@aquatrip.local" });
    const { agent, csrf } = await loginAs(user);
    await json(agent, "post", "/api/viagens", csrf, viagem);

    await db.query("DELETE FROM users WHERE id = $1", [user.id]);
    const { rows } = await db.query("SELECT 1 FROM trips");
    expect(rows).toHaveLength(0);
  });
});
