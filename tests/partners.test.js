/* ==============================================================
   Testes — marketplace, fase 1: parceiros
   ============================================================== */
const fs = require("fs");
const crypto = require("crypto");
const request = require("supertest");
const { app, db, resetDatabase, truncateTables, createUser, createServiceWithSlot, loginAs } = require("./helpers");
const documentos = require("../app/lib/documentos");
const bookingService = require("../app/services/bookingService");
const dataRightsService = require("../app/services/dataRightsService");
const mailService = require("../app/services/mailService");

beforeEach(async () => {
  await resetDatabase();
  await truncateTables("partners");
  fs.rmSync(mailService.MAIL_DIR, { recursive: true, force: true });
});

const CPF_OK = "529.982.247-25";
const CNPJ_ALFA = "12.ABC.345/01DE-35";

const dados = (extra = {}) => ({
  documento: CPF_OK, nomeLegal: "Zé da Silva", nomeExibicao: "Passeios do Zé",
  telefone: "(12) 99999-0000", cidade: "Ilhabela", uf: "SP", descricao: "Passeios de barco", aceite: true, ...extra,
});

async function candidato(email = "ze@aquatrip.local", extra) {
  const user = await createUser({ email, name: "Zé da Silva" });
  const { agent, csrf } = await loginAs(user);
  const res = await agent.post("/api/parceiro/candidatura").set("X-CSRF-Token", csrf).send(dados(extra));
  return { user, agent, csrf, res };
}

async function comoAdmin() {
  const admin = await createUser({ email: "chefe@aquatrip.local", role: "ADMIN" });
  return loginAs(admin);
}

const decidir = (agent, csrf, id, corpo) =>
  agent.post(`/api/admin/parceiros/${id}/decisao`).set("X-CSRF-Token", csrf).send(corpo);

async function parceiroAprovado() {
  const c = await candidato();
  const { agent, csrf } = await comoAdmin();
  await decidir(agent, csrf, c.res.body.parceiro.id, { acao: "aprovar" });
  return { ...c, adminAgent: agent, adminCsrf: csrf, partnerId: c.res.body.parceiro.id };
}

describe("Documentos", () => {
  it("valida CNPJ alfanumérico (em produção desde 31/07/2026)", () => {
    expect(documentos.validarCNPJ("00.000.000/E08G-12")).toBe(true); // 1º emitido pela Receita
    expect(documentos.validarCNPJ(CNPJ_ALFA)).toBe(true);
    expect(documentos.validarCNPJ("12.abc.345/01de-35")).toBe(true);
    expect(documentos.validarCNPJ("00.000.000/E08G-13")).toBe(false);
    expect(documentos.validarCNPJ("12.ABC.345/01DE-3A")).toBe(false);
  });
  it("valida CNPJ numérico e CPF", () => {
    expect(documentos.validarCNPJ("11.222.333/0001-81")).toBe(true);
    expect(documentos.validarCPF(CPF_OK)).toBe(true);
    expect(documentos.validarCPF("111.111.111-11")).toBe(false);
    expect(documentos.validarCPF("529.982.247-24")).toBe(false);
  });
  it("mascara CPF e mostra CNPJ inteiro", () => {
    expect(documentos.mascarar("52998224725")).toBe("***.982.247-**");
    expect(documentos.mascarar("12ABC34501DE35")).toBe(CNPJ_ALFA);
  });
  it("o banco recusa documento fora do formato", async () => {
    const u = await createUser({ email: "x@aquatrip.local" });
    await expect(db.query(
      `INSERT INTO partners (id, user_id, person_type, document, legal_name, display_name, phone, city, state)
       VALUES ($1, $2, 'PF', '529.982.247-25', 'x','x','x','x','SP')`, [crypto.randomUUID(), u.id]
    )).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  });
});

describe("Páginas", () => {
  it("apresentação é pública e indexável; área do parceiro exige login e não é indexada", async () => {
    const landing = await request(app).get("/parceiros");
    expect(landing.status).toBe(200);
    expect(landing.headers["x-robots-tag"]).toBeUndefined();
    const area = await request(app).get("/parceiro");
    expect(area.status).toBe(302);
    expect(area.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect((await request(app).get("/sitemap.xml")).text).toContain("/parceiros");
  });
});

describe("Candidatura", () => {
  it("cria cadastro pendente com CPF", async () => {
    const { res } = await candidato();
    expect(res.status).toBe(201);
    expect(res.body.parceiro.status).toBe("PENDING");
    const { rows } = await db.query("SELECT person_type, document FROM partners");
    expect(rows[0]).toEqual({ person_type: "PF", document: "52998224725" });
  });

  it("aceita CNPJ alfanumérico, em minúsculas e com máscara", async () => {
    const { res } = await candidato("empresa@aquatrip.local", { documento: "12.abc.345/01de-35" });
    expect(res.status).toBe(201);
    const { rows } = await db.query("SELECT person_type, document FROM partners");
    expect(rows[0]).toEqual({ person_type: "PJ", document: "12ABC34501DE35" });
  });

  it("recusa documento inválido e dados incompletos", async () => {
    expect((await candidato("a@x.local", { documento: "123.456.789-00" })).res.body.campo).toBe("documento");
    expect((await candidato("b@x.local", { uf: "XX" })).res.status).toBe(422);
    expect((await candidato("c@x.local", { aceite: false })).res.body.campo).toBe("aceite");
  });

  it("documento já usado: mensagem genérica, sem revelar quem é parceiro", async () => {
    await candidato("primeiro@aquatrip.local");
    const { res } = await candidato("segundo@aquatrip.local");
    expect(res.status).toBe(409);
    expect(res.body.error).not.toMatch(/já cadastrad|existe|CPF/i);
  });

  it("uma candidatura por conta; exige CSRF", async () => {
    const { agent, csrf } = await candidato();
    expect((await agent.post("/api/parceiro/candidatura").set("X-CSRF-Token", csrf)
      .send(dados({ documento: CNPJ_ALFA }))).body.codigo).toBe("ALREADY_PARTNER");
    const u = await createUser({ email: "semtoken@aquatrip.local" });
    const { agent: ag } = await loginAs(u);
    expect((await ag.post("/api/parceiro/candidatura").send(dados())).status).toBe(403);
  });

  it("o documento nunca vai para a auditoria", async () => {
    await candidato();
    const { rows } = await db.query("SELECT CAST(metadata AS CHAR) AS m FROM audit_log WHERE action = 'PARTNER_APPLIED'");
    expect(rows[0].m).not.toContain("52998224725");
  });

  it("a área do parceiro mostra a situação com CPF mascarado", async () => {
    const { agent } = await candidato();
    const html = (await agent.get("/parceiro")).text;
    expect(html).toContain("Cadastro em análise");
    expect(html).toContain("***.982.247-**");
    expect(html).not.toContain("529.982.247-25");
  });
});

describe("Decisões do admin", () => {
  it("só admin lista e decide; admin vê o documento completo", async () => {
    const { user, agent, csrf, res } = await candidato();
    expect((await agent.get("/api/admin/parceiros")).status).toBe(403);
    expect((await decidir(agent, csrf, res.body.parceiro.id, { acao: "aprovar" })).status).toBe(403);
    const adm = await comoAdmin();
    const lista = await adm.agent.get("/api/admin/parceiros");
    expect(lista.body.parceiros[0].documento_formatado).toBe(CPF_OK);
    expect(user).toBeTruthy();
  });

  it("aprova com comissão ajustada e avisa por e-mail", async () => {
    const { res } = await candidato();
    const { agent, csrf } = await comoAdmin();
    const r = await decidir(agent, csrf, res.body.parceiro.id, { acao: "aprovar", comissao: 12 });
    expect(r.body.parceiro).toMatchObject({ status: "APPROVED" });
    expect(Number(r.body.parceiro.commission_pct)).toBe(12);
    const mails = fs.readdirSync(mailService.MAIL_DIR).filter((f) => f.includes("parceiro_aprovar"));
    expect(mails).toHaveLength(1);
  });

  it("recusa e suspensão exigem motivo da lista; transição inválida é 409", async () => {
    const { res } = await candidato();
    const id = res.body.parceiro.id;
    const { agent, csrf } = await comoAdmin();
    expect((await decidir(agent, csrf, id, { acao: "recusar", motivo: "nao gostei" })).body.codigo).toBe("INVALID_REASON");
    expect((await decidir(agent, csrf, id, { acao: "suspender", motivo: "RECLAMACOES" })).status).toBe(409); // pendente não suspende
    expect((await decidir(agent, csrf, id, { acao: "recusar", motivo: "FORA_DO_ESCOPO" })).body.parceiro.status).toBe("REJECTED");
    expect((await decidir(agent, csrf, id, { acao: "aprovar" })).status).toBe(409); // recusado não aprova direto
    expect((await decidir(agent, csrf, id, { acao: "aprovar", comissao: 80 })).body.codigo).toBe("INVALID_COMMISSION");
  });
});

describe("Suspensão tira da vitrine — de verdade", () => {
  it("some do catálogo, da vitrine, do sitemap e da página; e o horário deixa de ser reservável", async () => {
    const { partnerId, adminAgent, adminCsrf } = await parceiroAprovado();
    const { service, slot } = await createServiceWithSlot({ slug: "passeio-do-ze", title: "Passeio do Zé" });
    await db.query("UPDATE services SET partner_id = $1 WHERE id = $2", [partnerId, service.id]);
    // Fase 2: experiência de parceiro só vende com o Mercado Pago conectado.
    await db.query("UPDATE partners SET mp_connected_at = now() WHERE id = $1", [partnerId]);
    expect((await request(app).get("/mergulho")).text).toContain("Passeio do Zé");

    await decidir(adminAgent, adminCsrf, partnerId, { acao: "suspender", motivo: "RECLAMACOES" });

    expect((await request(app).get("/mergulho")).text).not.toContain("Passeio do Zé");
    expect((await request(app).get("/reservar")).text).not.toContain("Passeio do Zé");
    expect((await request(app).get("/sitemap.xml")).text).not.toContain("passeio-do-ze");
    expect((await request(app).get("/reservar/passeio-do-ze")).status).toBe(404);
    const cliente = await createUser({ email: "cliente@aquatrip.local" });
    await expect(bookingService.createBooking({ userId: cliente.id, slotId: slot.id, quantity: 1 }))
      .rejects.toBeTruthy();

    await decidir(adminAgent, adminCsrf, partnerId, { acao: "reativar" });
    expect((await request(app).get("/mergulho")).text).toContain("Passeio do Zé");
  });

  it("bug anterior corrigido: experiência DESATIVADA não é reservável pelo id do horário", async () => {
    const { service, slot } = await createServiceWithSlot();
    await db.query("UPDATE services SET active = false WHERE id = $1", [service.id]);
    const cliente = await createUser({ email: "direto@aquatrip.local" });
    await expect(bookingService.createBooking({ userId: cliente.id, slotId: slot.id, quantity: 1 }))
      .rejects.toBeTruthy();
    expect((await db.query("SELECT 1 FROM bookings")).rows).toHaveLength(0);
  });
});

describe("LGPD", () => {
  it("exportação inclui o cadastro de parceiro, sem credenciais", async () => {
    const { user } = await candidato();
    await db.query("UPDATE partners SET mp_access_token_enc = 'SEGREDO-TOKEN' WHERE user_id = $1", [user.id]);
    const d = await dataRightsService.exportUserData(user.id);
    expect(d.cadastro_de_parceiro.display_name).toBe("Passeios do Zé");
    expect(JSON.stringify(d)).not.toContain("SEGREDO-TOKEN");
  });

  it("parceiro ativo não é anonimizado sem encerrar a parceria", async () => {
    const { user, adminAgent, adminCsrf } = await parceiroAprovado();
    const p = await dataRightsService.createRequest({ userId: user.id, kind: "DELETION", req: null });
    const r = await adminAgent.post(`/api/admin/solicitacoes/${p.id}`).set("X-CSRF-Token", adminCsrf)
      .send({ status: "DONE", resposta: "x", anonimizar: true });
    expect(r.body.codigo).toBe("ACTIVE_PARTNER");
  });

  it("candidatura pendente é apagada na anonimização", async () => {
    const { user } = await candidato();
    const p = await dataRightsService.createRequest({ userId: user.id, kind: "DELETION", req: null });
    const { agent, csrf } = await comoAdmin();
    const r = await agent.post(`/api/admin/solicitacoes/${p.id}`).set("X-CSRF-Token", csrf)
      .send({ status: "DONE", resposta: "Feito.", anonimizar: true });
    expect(r.status).toBe(200);
    expect((await db.query("SELECT 1 FROM partners")).rows).toHaveLength(0);
  });
});
