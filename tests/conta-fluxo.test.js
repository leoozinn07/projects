/* ==============================================================
   Testes: aceite dos Termos, cadastro -> login, boas-vindas e
   troca de idioma
   ============================================================== */
const request = require("supertest");
const { app, db, resetDatabase, createUser, extractCsrf, loginAs } = require("./helpers");
const termos = require("../app/lib/termos");

beforeEach(resetDatabase);

async function cadastrar(agent, extra = {}) {
  const page = await agent.get("/cadastro");
  return agent.post("/cadastro").type("form").send({
    nome: "Joana Prado",
    email: "joana@aquatrip.local",
    senha: "SenhaForte123!",
    "confirma-senha": "SenhaForte123!",
    _csrf: extractCsrf(page.text),
    ...extra,
  });
}

describe("Aceite dos Termos de Uso e da Política de Privacidade", () => {
  it("recusa o cadastro sem o aceite", async () => {
    const agent = request.agent(app);
    const res = await cadastrar(agent);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/cadastro\?error=/);
    const { rows } = await db.query("SELECT 1 FROM users WHERE email = 'joana@aquatrip.local'");
    expect(rows).toHaveLength(0);
  });

  it("grava versão e data do aceite no cadastro", async () => {
    const agent = request.agent(app);
    await cadastrar(agent, { aceite: "on" });
    const { rows } = await db.query("SELECT terms_version, terms_accepted_at FROM users WHERE email = 'joana@aquatrip.local'");
    expect(rows[0].terms_version).toBe(termos.VERSAO);
    expect(rows[0].terms_accepted_at).not.toBeNull();
  });

  it("pede o aceite a quem entrou sem ter aceitado e registra ao aceitar", async () => {
    const user = await createUser({ email: "antiga@aquatrip.local" });
    const { agent } = await loginAs(user);
    const pagina = await agent.get("/reservar");
    expect(pagina.text).toContain("terms-gate");

    const res = await agent.post("/aceite-termos").type("form")
      .send({ aceite: "on", redirect: "/reservar", _csrf: extractCsrf(pagina.text) });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/reservar");

    const { rows } = await db.query("SELECT terms_version FROM users WHERE id = $1", [user.id]);
    expect(rows[0].terms_version).toBe(termos.VERSAO);
    expect((await agent.get("/reservar")).text).not.toContain("terms-gate");
  });

  it("não deixa o aceite redirecionar para fora do site", async () => {
    const user = await createUser({ email: "redir@aquatrip.local" });
    const { agent } = await loginAs(user);
    const pagina = await agent.get("/reservar");
    const res = await agent.post("/aceite-termos").type("form")
      .send({ aceite: "on", redirect: "//evil.example", _csrf: extractCsrf(pagina.text) });
    expect(res.headers.location).toBe("/");
  });
});

describe("Cadastro leva ao login com o e-mail preenchido", () => {
  it("preenche só o e-mail, uma vez, e nunca a senha", async () => {
    const agent = request.agent(app);
    const res = await cadastrar(agent, { aceite: "on" });
    expect(res.headers.location).toBe("/login?cadastro=ok");
    expect(res.headers.location).not.toContain("joana"); // e-mail não vai pela URL

    const login = await agent.get("/login?cadastro=ok");
    expect(login.text).toContain('value="joana@aquatrip.local"');
    expect(login.text).not.toContain("SenhaForte123!");

    const deNovo = await agent.get("/login");
    expect(deNovo.text).not.toContain('value="joana@aquatrip.local"');
  });
});

describe("Boas-vindas depois do login", () => {
  it("mostra o primeiro nome na próxima página, só uma vez", async () => {
    const user = await createUser({ name: "Ana Beatriz Souza", email: "ana@aquatrip.local" });
    const agent = request.agent(app);
    const page = await agent.get("/login");
    await agent.post("/login").type("form")
      .send({ email: user.email, senha: user.password, redirect: "/", _csrf: extractCsrf(page.text) });
    const home = await agent.get("/");
    expect(home.text).toContain('id="welcome"');
    expect(home.text).toContain("Boas-vindas, Ana");
    expect((await agent.get("/")).text).not.toContain('id="welcome"');
  });
});

describe("Idioma", () => {
  it("troca o idioma por cookie e muda o lang do HTML", async () => {
    const agent = request.agent(app);
    const page = await agent.get("/configuracoes");
    const res = await agent.post("/configuracoes/idioma").type("form")
      .send({ idioma: "en", redirect: "/configuracoes", _csrf: extractCsrf(page.text) });
    expect(res.status).toBe(302);
    expect(res.headers["set-cookie"].join(";")).toContain("aquatrip_lang=en");
    const depois = await agent.get("/configuracoes");
    expect(depois.text).toContain('<html lang="en">');
  });

  it("ignora idioma desconhecido", async () => {
    const agent = request.agent(app);
    const page = await agent.get("/configuracoes");
    const res = await agent.post("/configuracoes/idioma").type("form")
      .send({ idioma: "xx", redirect: "/configuracoes", _csrf: extractCsrf(page.text) });
    expect(res.headers["set-cookie"] || []).not.toEqual(expect.arrayContaining([expect.stringContaining("aquatrip_lang=xx")]));
  });

  it("salva o idioma na conta de quem está logado", async () => {
    const user = await createUser({ email: "lang@aquatrip.local" });
    const { agent } = await loginAs(user);
    const page = await agent.get("/configuracoes");
    await agent.post("/configuracoes/idioma").type("form")
      .send({ idioma: "es", redirect: "/configuracoes", _csrf: extractCsrf(page.text) });
    const { rows } = await db.query("SELECT locale FROM users WHERE id = $1", [user.id]);
    expect(rows[0].locale).toBe("es");
  });

  it("português continua o padrão sem escolha", async () => {
    const res = await request(app).get("/configuracoes");
    expect(res.text).toContain('<html lang="pt-BR">');
  });
});
