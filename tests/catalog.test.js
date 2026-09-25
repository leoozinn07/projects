/* ==============================================================
   Testes — catálogo público e fluxo antigo aposentado
   ============================================================== */
const request = require("supertest");
const crypto = require("crypto");
const { app, db, resetDatabase, createUser, createServiceWithSlot, loginAs } = require("./helpers");
const bookingService = require("../app/services/bookingService");

beforeEach(resetDatabase);

async function servico({ slug, title, category, active = true, comHorario = true, capacity = 5 }) {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO services (id, slug, title, location, category, price_cents, active)
     VALUES ($1, $2, $3, 'Local, UF', $4, 15000, $5)`,
    [id, slug, title, category, active]
  );
  const { rows } = await db.query(`SELECT * FROM services WHERE id = $1`, [id]);
  let slot = null;
  if (comHorario) {
    const slotId = crypto.randomUUID();
    await db.query(
      `INSERT INTO service_slots (id, service_id, starts_at, capacity)
       VALUES ($1, $2, NOW() + INTERVAL 5 DAY, $3)`,
      [slotId, rows[0].id, capacity]
    );
    const r = await db.query(`SELECT * FROM service_slots WHERE id = $1`, [slotId]);
    slot = r.rows[0];
  }
  return { service: rows[0], slot };
}

describe("Catálogo", () => {
  it("as seis rotas respondem", async () => {
    for (const r of ["/praias", "/mergulho", "/caiaque", "/pesca", "/aquarios", "/expedicoes"]) {
      expect((await request(app).get(r)).status).toBe(200);
    }
  });

  it("mostra só experiências reais, ativas e da categoria", async () => {
    await servico({ slug: "m-ativa", title: "Mergulho Ativo", category: "mergulho" });
    await servico({ slug: "m-inativa", title: "Mergulho Desativado", category: "mergulho", active: false });
    await servico({ slug: "p-outra", title: "Pesca de Outra Categoria", category: "pesca" });

    const res = await request(app).get("/mergulho");
    expect(res.text).toContain("Mergulho Ativo");
    expect(res.text).not.toContain("Mergulho Desativado");
    expect(res.text).not.toContain("Pesca de Outra Categoria");
  });

  it("não exibe avaliações inventadas", async () => {
    await servico({ slug: "a", title: "Aquário X", category: "aquario" });
    const res = await request(app).get("/aquarios");
    expect(res.text).not.toMatch(/avalia[çc][õo]es/i);
    expect(res.text).not.toContain("★★★★");
  });

  it("o card leva ao fluxo de reserva real", async () => {
    await servico({ slug: "caiaque-real", title: "Caiaque Real", category: "caiaque" });
    const res = await request(app).get("/caiaque");
    expect(res.text).toContain('href="/reservar/caiaque-real"');
  });

  it("categoria sem experiências mostra estado vazio honesto", async () => {
    await servico({ slug: "so-pesca", title: "Pesca", category: "pesca" });
    const res = await request(app).get("/praias");
    expect(res.text).toContain("Ainda não há experiências de praia");
    expect(res.text).toContain('href="/pesca"'); // aponta para onde há o que reservar
    expect(res.text).not.toContain('class="card-item"');
  });

  it("indica disponibilidade real: com vaga, sem horário e lotado", async () => {
    await servico({ slug: "com-vaga", title: "Com Vaga", category: "mergulho" });
    await servico({ slug: "sem-horario", title: "Sem Horário", category: "mergulho", comHorario: false });
    const { slot } = await servico({ slug: "lotado", title: "Lotado", category: "mergulho", capacity: 1 });
    const cliente = await createUser({ email: "lotou@aquatrip.local" });
    await bookingService.createBooking({ userId: cliente.id, slotId: slot.id, quantity: 1 });

    const html = (await request(app).get("/mergulho")).text;
    const bloco = (titulo) => html.slice(html.indexOf(titulo), html.indexOf(titulo) + 900);

    expect(bloco("Com Vaga")).toMatch(/Próxima:/);
    expect(bloco("Sem Horário")).toMatch(/Sem datas abertas/);
    expect(bloco("Lotado")).toMatch(/Sem datas abertas/); // vaga ocupada não conta
  });

  it("mostra o horário no fuso de Brasília", async () => {
    const serviceId = crypto.randomUUID();
    await db.query(
      `INSERT INTO services (id, slug, title, location, category, price_cents)
       VALUES ($1, 'fuso', 'Teste Fuso', 'X', 'pesca', 1000)`,
      [serviceId]
    );
    // 12:00 UTC = 09:00 em Brasília
    await db.query(
      `INSERT INTO service_slots (id, service_id, starts_at, capacity)
       VALUES ($1, $2, DATE_ADD(DATE(DATE_ADD(NOW(), INTERVAL 3 DAY)), INTERVAL 12 HOUR), 5)`,
      [crypto.randomUUID(), serviceId]
    );
    const res = await request(app).get("/pesca");
    expect(res.text).toMatch(/· 09:00/);
  });
});

describe("Página da experiência", () => {
  it("é pública e pede login só na hora de reservar", async () => {
    await servico({ slug: "publica", title: "Experiência Pública", category: "mergulho" });
    const res = await request(app).get("/reservar/publica");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Experiência Pública");
    expect(res.text).toContain("Entrar para reservar");
    expect(res.text).toContain(encodeURIComponent("/reservar/publica"));
  });

  it("para quem está logado, mostra o botão de reservar", async () => {
    await servico({ slug: "logado", title: "Para Logado", category: "mergulho" });
    const user = await createUser({ email: "logado@aquatrip.local" });
    const { agent } = await loginAs(user);
    const res = await agent.get("/reservar/logado");
    expect(res.text).toContain("Continuar para o pagamento");
    expect(res.text).not.toContain("Entrar para reservar");
  });
});

describe("Fluxo antigo de compra", () => {
  it("as rotas antigas redirecionam (301) para o fluxo real", async () => {
    for (const r of ["/produto", "/produto_churaumi", "/dados_pagamento", "/mercado-pago"]) {
      const res = await request(app).get(r);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe("/reservar");
    }
  });

  it("nenhuma página aponta mais para o fluxo antigo", async () => {
    await servico({ slug: "x", title: "X", category: "mergulho" });
    for (const r of ["/", "/mergulho", "/reservar", "/avaliacao"]) {
      const html = (await request(app).get(r)).text;
      expect(html).not.toMatch(/href="\/(produto|dados_pagamento|mercado-pago)"/);
    }
  });
});
