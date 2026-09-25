/* ==============================================================
   Testes — horários (slots) e fuso horário
   ============================================================== */
const request = require("supertest");
const crypto = require("crypto");
const { app, db, resetDatabase, createUser, createServiceWithSlot, loginAs } = require("./helpers");
const adminService = require("../app/services/adminService");
const bookingService = require("../app/services/bookingService");
const fmt = require("../app/lib/datas");

beforeEach(resetDatabase);

async function comoAdmin() {
  const admin = await createUser({ email: "chefe@aquatrip.local", role: "ADMIN" });
  const { agent, csrf } = await loginAs(admin);
  return { admin, agent, csrf };
}

async function experienciaSemHorario() {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO services (id, slug, title, location, category, price_cents)
     VALUES ($1, 'sem-horario', 'Sem horário', 'Bonito, MS', 'mergulho', 10000)`,
    [id]
  );
  const { rows } = await db.query(`SELECT * FROM services WHERE id = $1`, [id]);
  return rows[0];
}

/** Próximo ano inteiro, para as datas nunca caírem no passado. */
const ANO = new Date().getUTCFullYear() + 1;

describe("Expansão da programação", () => {
  it("gera só os dias da semana pedidos", () => {
    // Outubro/2026: 9 dias de fim de semana (5 sábados + 4 domingos).
    const c = adminService.expandirProgramacao({
      dataInicio: "2026-10-01", dataFim: "2026-10-31", diasSemana: [0, 6], horarios: ["09:00", "14:00"],
    });
    expect(c).toHaveLength(18);
    expect(c[0]).toEqual({ data: "2026-10-03", hora: "09:00" }); // 1º sábado
  });

  it("não depende do fuso do servidor para calcular o dia da semana", () => {
    const antes = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14: o extremo
    const c = adminService.expandirProgramacao({
      dataInicio: "2026-10-03", dataFim: "2026-10-03", diasSemana: [6], horarios: ["09:00"],
    });
    process.env.TZ = antes;
    expect(c).toEqual([{ data: "2026-10-03", hora: "09:00" }]);
  });
});

describe("Criação de horários", () => {
  it("cria a programação e é idempotente", async () => {
    const { agent, csrf } = await comoAdmin();
    const exp = await experienciaSemHorario();
    const corpo = {
      dataInicio: `${ANO}-03-01`, dataFim: `${ANO}-03-31`,
      diasSemana: [6], horarios: ["09:00"], capacidade: 8,
    };

    const a = await agent.post(`/api/admin/experiencias/${exp.id}/horarios`).set("X-CSRF-Token", csrf).send(corpo);
    expect(a.status).toBe(201);
    expect(a.body.criados).toBeGreaterThanOrEqual(4);

    const b = await agent.post(`/api/admin/experiencias/${exp.id}/horarios`).set("X-CSRF-Token", csrf).send(corpo);
    expect(b.body.criados).toBe(0);
    expect(b.body.ignorados).toBe(a.body.criados);
  });

  it("ignora combinações no passado", async () => {
    const { agent, csrf } = await comoAdmin();
    const exp = await experienciaSemHorario();
    const res = await agent.post(`/api/admin/experiencias/${exp.id}/horarios`).set("X-CSRF-Token", csrf)
      .send({ dataInicio: "2020-01-01", dataFim: "2020-01-31", diasSemana: [0, 1, 2, 3, 4, 5, 6], horarios: ["09:00"], capacidade: 5 });
    expect(res.body.criados).toBe(0);
    const { rows } = await db.query("SELECT 1 FROM service_slots WHERE service_id = $1", [exp.id]);
    expect(rows).toHaveLength(0);
  });

  it("valida período, horário, dias e capacidade", async () => {
    const { agent, csrf } = await comoAdmin();
    const exp = await experienciaSemHorario();
    const base = { dataInicio: `${ANO}-03-01`, dataFim: `${ANO}-03-31`, diasSemana: [6], horarios: ["09:00"], capacidade: 5 };
    const invalidos = [
      { ...base, dataFim: `${ANO}-02-01` },
      { ...base, horarios: ["25:00"] },
      { ...base, horarios: [] },
      { ...base, diasSemana: [] },
      { ...base, capacidade: 0 },
      { ...base, dataInicio: `${ANO}-01-01`, dataFim: `${ANO + 2}-01-01` },
    ];
    for (const corpo of invalidos) {
      const r = await agent.post(`/api/admin/experiencias/${exp.id}/horarios`).set("X-CSRF-Token", csrf).send(corpo);
      expect(r.status).toBe(422);
    }
  });

  it("recusa lote grande demais", async () => {
    const { agent, csrf } = await comoAdmin();
    const exp = await experienciaSemHorario();
    const res = await agent.post(`/api/admin/experiencias/${exp.id}/horarios`).set("X-CSRF-Token", csrf).send({
      dataInicio: `${ANO}-01-01`, dataFim: `${ANO}-12-31`,
      diasSemana: [0, 1, 2, 3, 4, 5, 6], horarios: ["08:00", "10:00", "12:00"], capacidade: 5,
    });
    expect(res.body.codigo).toBe("SCHEDULE_TOO_LARGE");
  });

  it("exige ADMIN e CSRF", async () => {
    const exp = await experienciaSemHorario();
    const corpo = { dataInicio: `${ANO}-03-01`, dataFim: `${ANO}-03-02`, diasSemana: [0, 1, 2, 3, 4, 5, 6], horarios: ["09:00"], capacidade: 5 };

    const user = await createUser({ email: "comum@aquatrip.local" });
    const { agent: comum, csrf: csrfComum } = await loginAs(user);
    expect((await comum.post(`/api/admin/experiencias/${exp.id}/horarios`).set("X-CSRF-Token", csrfComum).send(corpo)).status).toBe(403);

    const { agent } = await comoAdmin();
    expect((await agent.post(`/api/admin/experiencias/${exp.id}/horarios`).send(corpo)).status).toBe(403);
  });
});

describe("Fuso horário (regressão do bug das 3 horas)", () => {
  it("'09:00' digitado é gravado como 09:00 de Brasília (12:00 UTC)", async () => {
    const { agent, csrf } = await comoAdmin();
    const exp = await experienciaSemHorario();
    await agent.post(`/api/admin/experiencias/${exp.id}/horarios`).set("X-CSRF-Token", csrf)
      .send({ dataInicio: `${ANO}-03-02`, dataFim: `${ANO}-03-02`, diasSemana: [0, 1, 2, 3, 4, 5, 6], horarios: ["09:00"], capacidade: 5 });

    const { rows } = await db.query(
      `SELECT DATE_FORMAT(starts_at, '%H:%i') AS utc,
              DATE_FORMAT(CONVERT_TZ(starts_at, 'UTC', 'America/Sao_Paulo'), '%H:%i') AS brasilia
       FROM service_slots WHERE service_id = $1`, [exp.id]);
    expect(rows[0].brasilia).toBe("09:00");
    expect(rows[0].utc).toBe("12:00");
  });

  it("o cliente vê 09:00 na página de reserva, não 12:00", async () => {
    const { agent, csrf } = await comoAdmin();
    const exp = await experienciaSemHorario();
    await agent.post(`/api/admin/experiencias/${exp.id}/horarios`).set("X-CSRF-Token", csrf)
      .send({ dataInicio: `${ANO}-03-02`, dataFim: `${ANO}-03-02`, diasSemana: [0, 1, 2, 3, 4, 5, 6], horarios: ["09:00"], capacidade: 5 });

    const cliente = await createUser({ email: "cliente@aquatrip.local" });
    const { agent: ag } = await loginAs(cliente);
    const res = await ag.get("/reservar/sem-horario");
    expect(res.text).toMatch(/às 09:00/);
    expect(res.text).not.toMatch(/às 12:00/);
  });

  it("o formatador usa o fuso de operação, não o do servidor", () => {
    const meioDiaUTC = new Date("2026-10-03T12:00:00Z");
    expect(fmt.hora(meioDiaUTC)).toBe("09:00");
    expect(fmt.data(meioDiaUTC)).toBe("03/10/2026");
    // Perto da meia-noite o DIA também muda: 01:30 UTC ainda é "ontem" em Brasília.
    expect(fmt.data(new Date("2026-10-04T01:30:00Z"))).toBe("03/10/2026");
  });
});

describe("Capacidade e remoção", () => {
  it("não reduz a capacidade abaixo das vagas ocupadas", async () => {
    const { agent, csrf } = await comoAdmin();
    const cliente = await createUser({ email: "reservou@aquatrip.local" });
    const { slot } = await createServiceWithSlot({ capacity: 10 });
    await bookingService.createBooking({ userId: cliente.id, slotId: slot.id, quantity: 3 });

    const baixo = await agent.put(`/api/admin/horarios/${slot.id}`).set("X-CSRF-Token", csrf).send({ capacidade: 2 });
    expect(baixo.status).toBe(409);
    expect(baixo.body.codigo).toBe("BELOW_OCCUPIED");

    const ok = await agent.put(`/api/admin/horarios/${slot.id}`).set("X-CSRF-Token", csrf).send({ capacidade: 3 });
    expect(ok.status).toBe(200);
    expect(ok.body.horario.capacity).toBe(3);
  });

  it("remove horário sem reservas", async () => {
    const { agent, csrf } = await comoAdmin();
    const { slot } = await createServiceWithSlot();
    const res = await agent.delete(`/api/admin/horarios/${slot.id}`).set("X-CSRF-Token", csrf);
    expect(res.status).toBe(204);
    const { rows } = await db.query("SELECT 1 FROM service_slots WHERE id = $1", [slot.id]);
    expect(rows).toHaveLength(0);
  });

  it("não remove horário com reserva no histórico, mesmo cancelada", async () => {
    const { agent, csrf } = await comoAdmin();
    const cliente = await createUser({ email: "cancelou@aquatrip.local" });
    const { slot } = await createServiceWithSlot();
    const b = await bookingService.createBooking({ userId: cliente.id, slotId: slot.id, quantity: 1 });
    await db.query("UPDATE bookings SET status = 'CANCELLED' WHERE id = $1", [b.id]);

    const res = await agent.delete(`/api/admin/horarios/${slot.id}`).set("X-CSRF-Token", csrf);
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe("HAS_BOOKINGS");
  });

  it("registra as operações na auditoria", async () => {
    const { agent, csrf } = await comoAdmin();
    const exp = await experienciaSemHorario();
    await agent.post(`/api/admin/experiencias/${exp.id}/horarios`).set("X-CSRF-Token", csrf)
      .send({ dataInicio: `${ANO}-03-02`, dataFim: `${ANO}-03-02`, diasSemana: [0, 1, 2, 3, 4, 5, 6], horarios: ["09:00"], capacidade: 5 });
    const { rows } = await db.query("SELECT metadata FROM audit_log WHERE action = 'ADMIN_SLOTS_CREATED'");
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.criados).toBe(1);
  });
});
