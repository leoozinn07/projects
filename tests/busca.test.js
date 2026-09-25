/* ==============================================================
   Testes: busca e filtros do catálogo (/reservar?q=&vagas=&max=&ordem=)
   e índice da busca do cabeçalho (/api/busca)
   ============================================================== */
const request = require("supertest");
const crypto = require("crypto");
const { app, db, resetDatabase } = require("./helpers");

beforeEach(resetDatabase);

async function servico({ slug, title, location = "Local", category = "mergulho", preco = 100, vaga = true }) {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO services (id, slug, title, location, category, price_cents) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, slug, title, location, category, preco * 100]
  );
  if (vaga) {
    await db.query(
      `INSERT INTO service_slots (id, service_id, starts_at, capacity) VALUES ($1, $2, NOW() + INTERVAL 3 DAY, 5)`,
      [crypto.randomUUID(), id]
    );
  }
  return id;
}

/** Cartões visíveis (sem o atributo hidden), na ordem da página. */
function visiveis(html) {
  return [...html.matchAll(/<li class="card-item"[^>]*?data-title="([^"]+)"[^>]*?>/g)]
    .filter((m) => !/\shidden(\s|>)/.test(m[0]))
    .map((m) => m[1]);
}

describe("Busca e filtros do catálogo", () => {
  beforeEach(async () => {
    await servico({ slug: "a", title: "Mergulho em São Sebastião", location: "São Sebastião, SP", preco: 300 });
    await servico({ slug: "b", title: "Caiaque no Rio", location: "Ubatuba, SP", category: "caiaque", preco: 90 });
    await servico({ slug: "c", title: "Pesca Lotada", location: "Manaus, AM", category: "pesca", preco: 500, vaga: false });
  });

  it("busca por texto sem acento e em qualquer ordem de palavras", async () => {
    const res = await request(app).get("/reservar?q=sebastiao%20mergulho");
    expect(visiveis(res.text)).toEqual(["Mergulho em São Sebastião"]);
  });

  it("busca também pela cidade", async () => {
    const res = await request(app).get("/reservar?q=ubatuba");
    expect(visiveis(res.text)).toEqual(["Caiaque no Rio"]);
  });

  it("filtra só com vagas e por preço máximo", async () => {
    expect(visiveis((await request(app).get("/reservar?vagas=1")).text)).not.toContain("Pesca Lotada");
    expect(visiveis((await request(app).get("/reservar?max=100")).text)).toEqual(["Caiaque no Rio"]);
  });

  it("ordena por preço", async () => {
    const res = await request(app).get("/reservar?ordem=preco_desc");
    expect(visiveis(res.text)).toEqual(["Pesca Lotada", "Mergulho em São Sebastião", "Caiaque no Rio"]);
  });

  it("mostra o aviso quando nada passa e mantém a busca nos links de categoria", async () => {
    const res = await request(app).get("/reservar?q=inexistente");
    expect(visiveis(res.text)).toEqual([]);
    expect(res.text).toMatch(/id="no-results"(?! hidden)/);
    expect(res.text).toContain('href="/mergulho?q=inexistente"');
  });

  it("ignora parâmetros inválidos", async () => {
    const res = await request(app).get("/reservar?ordem=DROP&max=abc&vagas=talvez");
    expect(res.status).toBe(200);
    expect(visiveis(res.text)).toHaveLength(3);
  });

  it("a busca vale dentro da categoria", async () => {
    const res = await request(app).get("/caiaque?q=rio");
    expect(visiveis(res.text)).toEqual(["Caiaque no Rio"]);
  });
});

describe("Índice da busca do cabeçalho", () => {
  it("devolve experiências públicas com link", async () => {
    await servico({ slug: "idx", title: "Aquário Público", category: "aquario" });
    const res = await request(app).get("/api/busca");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ titulo: "Aquário Público", href: "/reservar/idx" })]));
  });
});
