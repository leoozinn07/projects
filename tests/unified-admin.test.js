/* ==============================================================
   Testes — painel único (/admin absorveu /gestao)
   ============================================================== */
const request = require("supertest");
const { app, resetDatabase, createUser, loginAs } = require("./helpers");

beforeEach(resetDatabase);

describe("Unificação do painel", () => {
  it("/gestao redireciona permanentemente para /admin", async () => {
    const res = await request(app).get("/gestao");
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("/admin");
  });

  it("o redirecionamento não abre o painel: /admin continua exigindo ADMIN", async () => {
    const comum = await createUser({ email: "comum@aquatrip.local" });
    const { agent } = await loginAs(comum);
    const destino = await agent.get("/gestao").redirects(1);
    expect(destino.status).toBe(403);
    expect((await request(app).get("/gestao").redirects(1)).status).toBe(302); // visitante -> login
  });

  it("o painel único traz os recursos herdados da gestão", async () => {
    const admin = await createUser({ email: "chefe@aquatrip.local", role: "ADMIN" });
    const { agent } = await loginAs(admin);
    const html = (await agent.get("/admin")).text;
    // Filtros de experiência, situação de usuário, totais do filtro e diálogo de suspensão.
    for (const id of ["pkg-busca", "pkg-categoria-filtro", "pkg-status-filtro", "user-status",
                      "bill-recebido", "bill-taxa", "filter-busca", "suspend-modal", "suspend-dias"]) {
      expect(html).toContain(`id="${id}"`);
    }
    // Suspensão por lista fechada de durações (não mais window.prompt).
    expect(html).toMatch(/<select id="suspend-dias">[\s\S]*Sem prazo/);
  });

  it("os arquivos da gestão foram removidos (sem código morto)", async () => {
    expect((await request(app).get("/js/gestao.js")).status).toBe(404);
    expect((await request(app).get("/css/gestao.css")).status).toBe(404);
  });

  it("nenhuma página aponta mais para /gestao", async () => {
    const admin = await createUser({ email: "chefe2@aquatrip.local", role: "ADMIN" });
    const { agent } = await loginAs(admin);
    for (const r of ["/", "/admin", "/admin/auditoria"]) {
      expect((await agent.get(r)).text).not.toMatch(/href="\/gestao"/);
    }
  });
});
