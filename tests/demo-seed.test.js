/* ==============================================================
   Testes — conteúdo de demonstração da Comunidade
   (database/seed_comunidade.js, users.is_demo)
   Conteúdo de exemplo precisa estar SEMPRE identificado, fora do
   catálogo e das métricas, bloqueado em produção e removível.
   ============================================================== */
const request = require("supertest");
const argon2 = require("argon2");
const { app, db, resetDatabase, createUser } = require("./helpers");
const seed = require("../database/seed_comunidade");
const adminRepository = require("../app/repositories/adminRepository");
const catalogRepository = require("../app/repositories/catalogRepository");
const chatbotService = require("../app/services/chatbotService");

jest.setTimeout(60000);

beforeAll(async () => {
  await resetDatabase();
  await seed.semear();
});

async function umaViagem(chaveSlug) {
  const { rows } = await db.query(`SELECT id, slug FROM services WHERE slug LIKE ?`, [`${chaveSlug}%`]);
  return rows[0];
}

describe("seed de demonstração da Comunidade", () => {
  it("cria contas marcadas como exemplo, sem senha conhecida", async () => {
    const { rows } = await db.query(`SELECT email, is_demo, password_hash FROM users WHERE email LIKE ?`, [`%@${seed.DOMINIO}`]);
    expect(rows.length).toBe(8);
    expect(rows.every((r) => Number(r.is_demo) === 1)).toBe(true);
    // Senha aleatória descartada: nem a senha das contas de demonstração entra.
    expect(await argon2.verify(rows[0].password_hash, "Demo12345!")).toBe(false);
  });

  it("feed mostra as viagens futuras com o selo Exemplo", async () => {
    const r = await request(app).get("/api/comunidade/feed");
    expect(r.status).toBe(200);
    const exemplos = r.body.experiencias.filter((e) => e.exemplo);
    expect(exemplos.length).toBe(8); // as 2 que já aconteceram não estão no feed
    const pagina = await request(app).get("/comunidade");
    expect(pagina.text).toContain("tag-exemplo");
  });

  it("página da viagem avisa que é demonstração, sai dos buscadores e não declara nota", async () => {
    const porto = await umaViagem("piscinas-naturais-de-porto-de-galinhas-exemplo");
    const r = await request(app).get(`/reservar/${porto.slug}`);
    expect(r.status).toBe(200);
    expect(r.headers["x-robots-tag"]).toMatch(/noindex/);
    expect(r.text).toContain("aviso-exemplo");
    expect(r.text).not.toContain("AggregateRating");
    expect(r.text).not.toMatch(/avaliaç(ão|ões) verificada/);
    // Avaliações e comentários de exemplo levam o selo.
    expect((r.text.match(/class="tag-exemplo"/g) || []).length).toBeGreaterThanOrEqual(4);
  });

  it("perfil de exemplo é identificado e fica fora dos buscadores", async () => {
    const { rows } = await db.query(`SELECT id FROM users WHERE email = ?`, [`juliana@${seed.DOMINIO}`]);
    const r = await request(app).get(`/usuarios/${rows[0].id}`);
    expect(r.status).toBe(200);
    expect(r.headers["x-robots-tag"]).toMatch(/noindex/);
    expect(r.text).toContain("aviso-exemplo");
  });

  it("fica fora do catálogo, do sitemap e do assistente virtual", async () => {
    const catalogo = await catalogRepository.listAll();
    expect(catalogo.some((s) => /-exemplo/.test(s.slug))).toBe(false);
    const contagem = await catalogRepository.countByCategory();
    expect(Object.values(contagem).reduce((a, n) => a + Number(n), 0)).toBe(0);
    const sitemap = await request(app).get("/sitemap.xml");
    expect(sitemap.text).not.toContain("-exemplo");
    const bot = await chatbotService.buscarExperiencias({ termo: "Noronha" });
    expect(JSON.stringify(bot)).not.toContain("Noronha");
  });

  it("não entra nas métricas do painel do admin", async () => {
    await createUser({ email: "real@aquatrip.local", name: "Pessoa Real" });
    const m = await adminRepository.platformCounts();
    expect(m.experiencias_total).toBe(0);
    expect(m.experiencias_comunidade).toBe(0);
    expect(m.participantes).toBe(0);
    expect(m.avaliacoes_experiencias).toBe(0);
    expect(m.comentarios).toBe(0);
    expect(m.curtidas).toBe(0);
    expect(m.conexoes).toBe(0);
    const f = await adminRepository.metrics({ platformFeePercent: 10 });
    expect(f.usuarios).toBe(1);
  });

  it("rodar de novo não duplica", async () => {
    await seed.semear();
    const { rows } = await db.query(`SELECT COUNT(*) AS n FROM users WHERE is_demo`);
    expect(Number(rows[0].n)).toBe(8);
  });

  it("recusa rodar em produção", async () => {
    const antes = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(seed.semear()).rejects.toThrow(/NODE_ENV=production/);
      await expect(seed.limpar()).rejects.toThrow(/NODE_ENV=production/);
    } finally {
      process.env.NODE_ENV = antes;
    }
  });

  it("limpar apaga tudo, inclusive participação de conta real e fotos", async () => {
    const real = await createUser({ email: "vai-junto@aquatrip.local", name: "Vai Junto" });
    const { rows: [slot] } = await db.query(
      `SELECT sl.id FROM service_slots sl JOIN services s ON s.id = sl.service_id
       WHERE s.slug LIKE 'mergulho-em-fernando-de-noronha-exemplo%'`
    );
    await db.query(
      `INSERT INTO bookings (id, user_id, slot_id, status, quantity, amount_cents, confirmed_at)
       VALUES (UUID(), ?, ?, 'CONFIRMED', 1, 0, NOW())`,
      [real.id, slot.id]
    );
    const r = await seed.limpar();
    expect(r.contas).toBe(8);
    expect(r.fotos).toBe(9);
    const { rows } = await db.query(
      `SELECT (SELECT COUNT(*) FROM users WHERE is_demo) AS u,
              (SELECT COUNT(*) FROM services WHERE creator_user_id IS NOT NULL) AS s,
              (SELECT COUNT(*) FROM media) AS m,
              (SELECT COUNT(*) FROM bookings) AS b,
              (SELECT COUNT(*) FROM users WHERE id = ?) AS realFica`,
      [real.id]
    );
    expect(rows[0]).toMatchObject({ u: 0, s: 0, m: 0, b: 0, realFica: 1 });
  });
});
