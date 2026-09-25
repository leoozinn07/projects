/* ==============================================================
   Testes — SEO
   ============================================================== */
const request = require("supertest");
const crypto = require("crypto");
const { app, db, resetDatabase, createUser, createServiceWithSlot, loginAs } = require("./helpers");
const bookingService = require("../app/services/bookingService");

beforeEach(resetDatabase);

function jsonLd(html) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}
const meta = (html, re) => (html.match(re) || [])[1];

describe("robots.txt", () => {
  it("fora de produção, bloqueia tudo (staging não pode ir para o Google)", async () => {
    const res = await request(app).get("/robots.txt");
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toMatch(/Disallow: \/\n/);
  });

  it("em produção, libera o público, bloqueia o privado e aponta o sitemap", async () => {
    const antes = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const res = await request(app).get("/robots.txt");
    process.env.NODE_ENV = antes;
    expect(res.text).toContain("Disallow: /admin");
    expect(res.text).toContain("Disallow: /api/");
    expect(res.text).not.toMatch(/Disallow: \/\n/);
    expect(res.text).toMatch(/Sitemap: .*\/sitemap\.xml/);
  });
});

describe("sitemap.xml", () => {
  it("lista só experiências ativas e nenhuma página privada", async () => {
    await createServiceWithSlot({ slug: "ativa-no-mapa" });
    await db.query(
      `INSERT INTO services (id, slug, title, category, price_cents, active) VALUES ($1, 'desativada', 'X', 'pesca', 100, false)`,
      [crypto.randomUUID()]
    );
    const res = await request(app).get("/sitemap.xml");
    expect(res.headers["content-type"]).toMatch(/xml/);
    expect(res.text).toContain("/reservar/ativa-no-mapa");
    expect(res.text).not.toContain("/reservar/desativada");
    for (const priv of ["/admin", "/api/", "/perfil", "/login", "/minhas-reservas"]) {
      expect(res.text).not.toContain(priv);
    }
    expect(res.text).toMatch(/^<\?xml version="1\.0"/);
    expect(res.text.match(/<url>/g).length).toBe(res.text.match(/<\/url>/g).length);
  });
});

describe("Páginas privadas fora dos buscadores", () => {
  it("recebem X-Robots-Tag noindex — inclusive a API", async () => {
    for (const r of ["/admin", "/api/admin/painel", "/perfil", "/minhas-reservas", "/login", "/configuracoes/privacidade"]) {
      const res = await request(app).get(r);
      expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    }
  });

  it("páginas públicas não recebem", async () => {
    for (const r of ["/", "/mergulho", "/reservar", "/termos-de-uso"]) {
      expect((await request(app).get(r)).headers["x-robots-tag"]).toBeUndefined();
    }
  });
});

describe("Metadados", () => {
  it("cada página pública tem título, descrição e canônica próprios", async () => {
    const vistos = new Set();
    for (const r of ["/", "/mergulho", "/pesca", "/reservar", "/contato", "/termos-de-uso", "/politica-de-privacidade"]) {
      const html = (await request(app).get(r)).text;
      const titulo = meta(html, /<title>(.*?)<\/title>/);
      expect(titulo).toBeTruthy();
      expect(vistos.has(titulo)).toBe(false); // título duplicado prejudica a indexação
      vistos.add(titulo);
      expect(html.match(/name="description"/g)).toHaveLength(1);
      expect(meta(html, /rel="canonical" href="([^"]+)"/)).toMatch(new RegExp(r.replace(/\//g, "\\/") + "$"));
      expect(html).toContain('property="og:image"');
    }
  });

  it("a canônica ignora parâmetros de campanha (sem páginas duplicadas)", async () => {
    const html = (await request(app).get("/mergulho?utm_source=instagram&utm_medium=bio")).text;
    expect(meta(html, /rel="canonical" href="([^"]+)"/)).toMatch(/\/mergulho$/);
  });
});

describe("Página da experiência", () => {
  it("título começa pela experiência e descrição não repete a cidade", async () => {
    await db.query(
      `INSERT INTO services (id, slug, title, location, category, price_cents)
       VALUES ($1, 'noronha', 'Mergulho em Fernando de Noronha', 'Fernando de Noronha, PE', 'mergulho', 65000)`,
      [crypto.randomUUID()]
    );
    const html = (await request(app).get("/reservar/noronha")).text;
    expect(meta(html, /<title>(.*?)<\/title>/)).toBe("Mergulho em Fernando de Noronha | AquaTrip");
    expect(meta(html, /name="description" content="([^"]+)"/)).not.toMatch(/Noronha em Fernando de Noronha/);
  });

  it("JSON-LD com preço e disponibilidade reais", async () => {
    const { service } = await createServiceWithSlot({ slug: "com-vaga", priceCents: 12345 });
    const ld = jsonLd((await request(app).get(`/reservar/${service.slug}`)).text);
    expect(ld["@type"]).toBe("Product");
    expect(ld.offers).toMatchObject({ price: "123.45", priceCurrency: "BRL", availability: "https://schema.org/InStock" });

    await db.query("DELETE FROM service_slots WHERE service_id = $1", [service.id]);
    const esgotada = jsonLd((await request(app).get(`/reservar/${service.slug}`)).text);
    expect(esgotada.offers.availability).toBe("https://schema.org/SoldOut");
  });

  it("nota nos dados estruturados só existe com avaliação real", async () => {
    const user = await createUser({ email: "foi@aquatrip.local" });
    const { slot, service } = await createServiceWithSlot({ slug: "avaliada" });
    expect(jsonLd((await request(app).get("/reservar/avaliada")).text).aggregateRating).toBeUndefined();

    const b = await bookingService.createBooking({ userId: user.id, slotId: slot.id, quantity: 1 });
    await bookingService.startPayment({ bookingId: b.id, user: { id: user.id, role: "USER", email: user.email, name: user.name }, method: "CREDIT_CARD", cardLastFour: "4242" });
    await db.query("UPDATE service_slots SET starts_at = NOW() - INTERVAL 1 DAY WHERE id = $1", [slot.id]);
    const { agent, csrf } = await loginAs(user);
    await agent.post("/api/avaliacoes").set("X-CSRF-Token", csrf).send({ bookingId: b.id, nota: 4 });

    const ld = jsonLd((await request(app).get(`/reservar/${service.slug}`)).text);
    expect(ld.aggregateRating).toMatchObject({ ratingValue: 4, reviewCount: 1 });
  });

  it("título malicioso não escapa do JSON-LD (XSS armazenado)", async () => {
    const ataque = '</script><script>alert(document.cookie)</script>';
    const serviceId = crypto.randomUUID();
    await db.query(
      `INSERT INTO services (id, slug, title, location, category, price_cents)
       VALUES ($1, 'ataque', $2, 'X', 'pesca', 1000)`,
      [serviceId, ataque]
    );
    await db.query(
      `INSERT INTO service_slots (id, service_id, starts_at, capacity)
       VALUES ($1, $2, NOW() + INTERVAL 2 DAY, 5)`,
      [crypto.randomUUID(), serviceId]
    );
    const html = (await request(app).get("/reservar/ataque")).text;

    // O único <script executável da página não pode ter nascido do título.
    expect(html).not.toContain("<script>alert(document.cookie)</script>");
    // O JSON-LD continua um JSON válido e devolve o título intacto.
    const ld = jsonLd(html);
    expect(ld.name).toBe(ataque);
  });
});
