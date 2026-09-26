/* Textos da página inicial pedidos pelo dono do projeto. */
const request = require("supertest");
const { app } = require("./helpers");

describe("Página inicial", () => {
  it("título das categorias com o número: '6 jeitos de entrar na água.'", async () => {
    const pt = await request(app).get("/").set("Cookie", "lang=pt");
    expect(pt.text).toContain("6 jeitos de entrar na água.");
    expect(pt.text).not.toContain("Seis jeitos");
    expect(pt.text).toContain("Lugares que merecem entrar no seu mapa.");
  });
});
