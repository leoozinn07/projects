/* ==============================================================
   Testes — experiências da comunidade, rede social, perfis,
   moderação administrativa, presença, feedback e assistente
   ============================================================== */
const crypto = require("crypto");
const request = require("supertest");
const { app, db, resetDatabase, createUser, loginAs } = require("./helpers");
const chatbotService = require("../app/services/chatbotService");

beforeEach(async () => {
  await resetDatabase();
  chatbotService._definirCliente(null);
});

let seq = 0;
async function novo(extra = {}) {
  const u = await createUser({ email: `u${++seq}@aquatrip.local`, name: `Pessoa Teste${seq} Silva`, ...extra });
  const s = await loginAs(u);
  return { user: u, ...s };
}
function dataFutura(dias = 10) {
  return new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
}
const base = () => ({
  title: "Fim de semana em Santos",
  description: "Vou passar o sábado no Aquário de Santos e na praia do Gonzaga. Bora junto?",
  location: "Santos, SP",
  category: "aquario",
  date: dataFutura(),
  time: "09:30",
  capacity: 3,
  preco: "",
  tripInfo: "Encontro na entrada do aquário.",
});
const criar = (p, extra = {}) =>
  p.agent.post("/api/comunidade/experiencias").set("X-CSRF-Token", p.csrf).send({ ...base(), ...extra });
const api = (p, metodo, url, corpo) =>
  p.agent[metodo](url).set("X-CSRF-Token", p.csrf).set("Accept", "application/json").send(corpo);

describe("experiência criada por usuário comum", () => {
  it("gratuita é publicada na hora e aparece no feed e na página", async () => {
    const dono = await novo();
    const r = await criar(dono);
    expect(r.status).toBe(201);
    expect(r.body.slug).toBe("fim-de-semana-em-santos");

    const feed = await request(app).get("/api/comunidade/feed");
    expect(feed.body.experiencias).toHaveLength(1);
    expect(feed.body.experiencias[0].vagas_restantes).toBe(3);
    // Nome público abreviado; e-mail nunca aparece.
    expect(feed.body.experiencias[0].criador.nome).toMatch(/^Pessoa Silva\.?|^Pessoa S\.$/);
    expect(JSON.stringify(feed.body)).not.toContain(dono.user.email);

    const pagina = await request(app).get(`/reservar/${r.body.slug}`);
    expect(pagina.status).toBe(200);
    expect(pagina.text).toContain("Encontro na entrada do aquário.");
  });

  it("paga sem recebimento conectado é recusada com explicação", async () => {
    const dono = await novo();
    const r = await criar(dono, { preco: "120,00" });
    expect(r.status).toBe(422);
    expect(r.body.codigo).toBe("PAYOUT_REQUIRED");
    expect((await db.query("SELECT COUNT(*) AS n FROM services")).rows[0].n).toBe(0);
  });

  it("paga com parceiro aprovado e Mercado Pago conectado vai para o parceiro", async () => {
    const dono = await novo();
    const pid = crypto.randomUUID();
    await db.query(
      `INSERT INTO partners (id, user_id, person_type, document, legal_name, display_name, phone, city, state, status, mp_connected_at)
       VALUES (?, ?, 'PF', '52998224725', 'Pessoa', 'Pessoa Passeios', '13999990000', 'Santos', 'SP', 'APPROVED', NOW())`,
      [pid, dono.user.id]
    );
    const r = await criar(dono, { preco: "150" });
    expect(r.status).toBe(201);
    const { rows } = await db.query("SELECT partner_id, price_cents FROM services WHERE id = ?", [r.body.id]);
    expect(rows[0]).toEqual({ partner_id: pid, price_cents: 15000 });
  });

  it("valida data no passado e campos obrigatórios", async () => {
    const dono = await novo();
    expect((await criar(dono, { date: "2020-01-01" })).body.codigo).toBe("DATE_IN_PAST");
    const r = await criar(dono, { title: "abc" });
    expect(r.status).toBe(422);
    expect(r.body.campo).toBe("title");
  });

  it("só o criador edita; outra pessoa recebe 404", async () => {
    const dono = await novo();
    const outro = await novo();
    const { body } = await criar(dono);
    expect((await api(outro, "put", `/api/comunidade/experiencias/${body.id}`, { title: "Roubei a experiência" })).status).toBe(404);
    const ok = await api(dono, "put", `/api/comunidade/experiencias/${body.id}`, { capacity: 5 });
    expect(ok.status).toBe(200);
    expect((await db.query("SELECT capacity FROM service_slots WHERE service_id = ?", [body.id])).rows[0].capacity).toBe(5);
  });

  it("participação gratuita confirma na hora, sem checkout", async () => {
    const dono = await novo();
    const vai = await novo();
    const { body } = await criar(dono);
    const slot = (await db.query("SELECT id FROM service_slots WHERE service_id = ?", [body.id])).rows[0];
    const r = await vai.agent.post("/reservar").type("form")
      .send({ slotId: slot.id, quantity: 2, serviceSlug: body.slug, _csrf: vai.csrf });
    expect(r.status).toBe(302);
    expect(r.headers.location).toMatch(/\/comprovante$/);
    const { rows } = await db.query("SELECT status, amount_cents FROM bookings WHERE user_id = ?", [vai.user.id]);
    expect(rows[0]).toEqual({ status: "CONFIRMED", amount_cents: 0 });

    const pessoas = await dono.agent.get(`/api/comunidade/experiencias/${body.id}/pessoas`);
    expect(pessoas.body.participantes).toHaveLength(1);
    expect(pessoas.body.participantes[0].vagas).toBe(2);
    // Data travada depois que alguém confirmou.
    const mudar = await api(dono, "put", `/api/comunidade/experiencias/${body.id}`, { date: dataFutura(20), time: "10:00" });
    expect(mudar.body.codigo).toBe("DATE_LOCKED");
    // Vagas não podem ficar abaixo das ocupadas.
    expect((await api(dono, "put", `/api/comunidade/experiencias/${body.id}`, { capacity: 1 })).body.codigo).toBe("CAPACITY_BELOW_TAKEN");
  });
});

describe("rede social", () => {
  it("curtida é única por pessoa e conta no perfil do criador", async () => {
    const dono = await novo();
    const fa = await novo();
    const { body } = await criar(dono);
    expect((await request(app).post(`/api/experiencias/${body.id}/curtir`).send({ curtir: true })).status).toBe(401);
    await api(fa, "post", `/api/experiencias/${body.id}/curtir`, { curtir: true });
    const dupla = await api(fa, "post", `/api/experiencias/${body.id}/curtir`, { curtir: true });
    expect(dupla.body.curtidas).toBe(1);

    const perfil = await dono.agent.get("/meu-perfil");
    expect(perfil.status).toBe(200);
    const stats = await require("../app/services/socialService").estatisticas(dono.user.id);
    expect(stats.curtidas_recebidas).toBe(1);

    const desfaz = await api(fa, "post", `/api/experiencias/${body.id}/curtir`, { curtir: false });
    expect(desfaz.body.curtidas).toBe(0);
  });

  it("comentários: criar, listar e apagar com as permissões certas", async () => {
    const dono = await novo();
    const autor = await novo();
    const terceiro = await novo();
    const { body } = await criar(dono);
    const c = await api(autor, "post", `/api/experiencias/${body.id}/comentarios`, { texto: "Quero muito ir! Levo protetor?" });
    expect(c.status).toBe(201);
    expect(c.body.comentario.pode_apagar).toBe(true);
    expect((await api(autor, "post", `/api/experiencias/${body.id}/comentarios`, { texto: " " })).status).toBe(422);

    const lista = await request(app).get(`/api/experiencias/${body.id}/comentarios`);
    expect(lista.body.comentarios).toHaveLength(1);
    expect(lista.body.comentarios[0].pode_apagar).toBe(false);

    expect((await api(terceiro, "delete", `/api/comentarios/${c.body.comentario.id}`)).status).toBe(404);
    expect((await api(dono, "delete", `/api/comentarios/${c.body.comentario.id}`)).status).toBe(204);
  });

  it("seguir: sem duplicata, sem seguir a si mesmo", async () => {
    const a = await novo();
    const b = await novo();
    expect((await api(a, "post", `/api/usuarios/${a.user.id}/seguir`, { seguir: true })).status).toBe(422);
    await api(a, "post", `/api/usuarios/${b.user.id}/seguir`, { seguir: true });
    const r = await api(a, "post", `/api/usuarios/${b.user.id}/seguir`, { seguir: true });
    expect(r.body.seguidores).toBe(1);
    const seguidores = await request(app).get(`/api/usuarios/${b.user.id}/seguidores`);
    expect(seguidores.body.usuarios).toHaveLength(1);
    expect(JSON.stringify(seguidores.body)).not.toContain("@");
    const perfil = await request(app).get(`/usuarios/${b.user.id}`);
    expect(perfil.status).toBe(200);
    expect(perfil.text).not.toContain(b.user.email);
  });

  it("interesse não vale para o próprio criador", async () => {
    const dono = await novo();
    const fa = await novo();
    const { body } = await criar(dono);
    expect((await api(dono, "post", `/api/experiencias/${body.id}/interesse`, { quer: true })).status).toBe(409);
    expect((await api(fa, "post", `/api/experiencias/${body.id}/interesse`, { quer: true })).body.interessados).toBe(1);
  });
});

describe("moderação administrativa", () => {
  async function comoAdmin() {
    return novo({ role: "ADMIN" });
  }

  it("rotas admin recusam usuário comum", async () => {
    const u = await novo();
    for (const url of ["/api/admin/comunidade", "/api/admin/feedback", `/api/admin/usuarios/${u.user.id}`]) {
      expect((await u.agent.get(url)).status).toBe(403);
    }
    expect((await api(u, "post", `/api/admin/usuarios/${u.user.id}/banir`, { motivo: "tentativa indevida" })).status).toBe(403);
  });

  it("denúncia aparece para o admin; suspender tira do ar e trava edição", async () => {
    const dono = await novo();
    const denunciante = await novo();
    const admin = await comoAdmin();
    const { body } = await criar(dono);
    await api(denunciante, "post", `/api/experiencias/${body.id}/denunciar`, { motivo: "GOLPE", detalhes: "Pediu PIX por fora" });

    const lista = await admin.agent.get("/api/admin/comunidade");
    expect(lista.body.experiencias[0].denuncias_abertas).toBe(1);

    expect((await api(admin, "post", `/api/admin/comunidade/${body.id}/moderar`, { status: "SUSPENDED" })).status).toBe(422);
    const r = await api(admin, "post", `/api/admin/comunidade/${body.id}/moderar`, { status: "SUSPENDED", motivo: "Cobrança fora da plataforma" });
    expect(r.status).toBe(200);
    expect((await request(app).get(`/reservar/${body.slug}`)).status).toBe(404);
    expect((await api(dono, "put", `/api/comunidade/experiencias/${body.id}`, { capacity: 4 })).body.codigo).toBe("MODERATED");

    await api(admin, "post", `/api/admin/comunidade/${body.id}/moderar`, { status: "ACTIVE" });
    expect((await request(app).get(`/reservar/${body.slug}`)).status).toBe(200);
  });

  it("banir: derruba login, tira experiências do ar e fica auditado", async () => {
    const dono = await novo();
    const admin = await comoAdmin();
    const { body } = await criar(dono);
    const r = await api(admin, "post", `/api/admin/usuarios/${dono.user.id}/banir`, { motivo: "Golpes repetidos" });
    expect(r.status).toBe(200);
    expect((await db.query("SELECT moderation_status FROM services WHERE id = ?", [body.id])).rows[0].moderation_status).toBe("BANNED");
    // Sessão derrubada.
    expect((await dono.agent.get("/api/comunidade/minhas")).status).toBe(401);
    // Login recusado com a senha certa.
    const tentativa = await loginAs(dono.user);
    expect((await tentativa.agent.get("/api/comunidade/minhas")).status).toBe(401);
    const audit = await db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ADMIN_USER_BANNED'");
    expect(audit.rows[0].n).toBe(1);
  });

  it("perfil completo inclui CPF do parceiro e registra o acesso", async () => {
    const u = await novo();
    const admin = await comoAdmin();
    await db.query(
      `INSERT INTO partners (id, user_id, person_type, document, legal_name, display_name, phone, city, state)
       VALUES (?, ?, 'PF', '52998224725', 'Pessoa', 'Pessoa Passeios', '13999990000', 'Santos', 'SP')`,
      [crypto.randomUUID(), u.user.id]
    );
    const r = await admin.agent.get(`/api/admin/usuarios/${u.user.id}`);
    expect(r.body.usuario.document).toBe("52998224725");
    expect(r.body.usuario.email).toBe(u.user.email);
    const audit = await db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ADMIN_USER_VIEWED'");
    expect(audit.rows[0].n).toBe(1);
  });

  it("painel traz números reais, incluindo quem está online", async () => {
    const admin = await comoAdmin();
    await novo();
    const r = await admin.agent.get("/api/admin/painel");
    expect(r.body.plataforma.online_agora).toBeGreaterThanOrEqual(2);
    expect(r.body.plataforma.experiencias_comunidade).toBe(0);
  });

  it("feedback: usuário registra, admin responde, usuário vê a resposta", async () => {
    const u = await novo();
    const admin = await comoAdmin();
    const f = await api(u, "post", "/api/feedback", { kind: "COMPLAINT", subject: "Cobrança", message: "Fui cobrado duas vezes no PIX." });
    expect(f.status).toBe(201);
    expect((await api(u, "post", "/api/feedback", { kind: "RATING", subject: "Nota", message: "Gostei bastante do site." })).status).toBe(422);
    const lista = await admin.agent.get("/api/admin/feedback");
    expect(lista.body.resumo.reclamacoes_abertas).toBe(1);
    const resp = await api(admin, "post", `/api/admin/feedback/${f.body.id}`, { status: "RESOLVED", resposta: "Estorno feito, obrigado por avisar." });
    expect(resp.status).toBe(200);
    const pagina = await u.agent.get("/feedback");
    expect(pagina.text).toContain("Estorno feito, obrigado por avisar.");
  });
});

describe("assistente virtual", () => {
  const chat = (p, mensagem) => api(p, "post", "/api/assistente/mensagem", { mensagem });

  it("sem chave configurada responde indisponível (503)", async () => {
    const u = await novo();
    const r = await chat(u, "Como crio uma experiência?");
    expect(r.status).toBe(503);
    expect(r.body.codigo).toBe("UNAVAILABLE");
  });

  it("exige CSRF", async () => {
    const r = await request(app).post("/api/assistente/mensagem").send({ mensagem: "oi" });
    expect(r.status).toBe(403);
  });

  it("guarda o histórico no servidor, usa a ferramenta do catálogo e filtra a saída", async () => {
    const dono = await novo();
    await criar(dono);
    const chamadas = [];
    chatbotService._definirCliente({
      beta: { messages: { create: async (params) => {
        chamadas.push(JSON.parse(JSON.stringify(params)));
        const n = chamadas.length;
        if (n === 1) {
          return { stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 },
            content: [{ type: "tool_use", id: "t1", name: "buscar_experiencias", input: { termo: "Santos" } }] };
        }
        return { stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 },
          content: [{ type: "text", text: `Resposta ${n}. Contato: fulano@exemplo.com sk-ant-abcdefghijk123` }] };
      } } },
    });
    const u = await novo();
    const r1 = await chat(u, "Tem algo em Santos?");
    expect(r1.status).toBe(200);
    expect(r1.body.resposta).not.toContain("fulano@exemplo.com");
    expect(r1.body.resposta).not.toContain("sk-ant-");
    // O resultado da ferramenta foi para o modelo com dados públicos reais.
    const resultado = chamadas[1].messages.at(-1).content[0];
    expect(resultado.type).toBe("tool_result");
    expect(resultado.content).toContain("Fim de semana em Santos");
    expect(resultado.content).not.toContain(dono.user.email);
    // Prompt de sistema fixo, com cache e base de conhecimento.
    expect(chamadas[0].system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(chamadas[0].system[0].text).toContain("Base de conhecimento do AquaTrip");

    await chat(u, "E outras pessoas podem participar?");
    const ultima = chamadas.at(-1).messages;
    // Contexto da conversa veio da SESSÃO, não do navegador.
    expect(ultima.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(ultima[0].content).toBe("Tem algo em Santos?");
    const uso = await db.query("SELECT COUNT(*) AS n FROM chat_usage WHERE outcome = 'ok'");
    expect(uso.rows[0].n).toBe(2);
  });

  it("respeita a cota diária", async () => {
    process.env.CHATBOT_DAILY_LIMIT_USER = "1";
    try {
      chatbotService._definirCliente({ beta: { messages: { create: async () => ({
        stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: "ok" }] }) } } });
      const u = await novo();
      expect((await chat(u, "primeira")).status).toBe(200);
      const r = await chat(u, "segunda");
      expect(r.status).toBe(429);
      expect(r.body.codigo).toBe("DAILY_LIMIT");
    } finally {
      delete process.env.CHATBOT_DAILY_LIMIT_USER;
    }
  });
});
