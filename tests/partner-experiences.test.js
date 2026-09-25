/* ==============================================================
   Testes — marketplace, fase 2: experiências do parceiro
   ============================================================== */
const fs = require("fs");
const crypto = require("crypto");
const sharp = require("sharp");
const request = require("supertest");
const { app, db, resetDatabase, truncateTables, createUser, createServiceWithSlot, loginAs } = require("./helpers");
const bookingService = require("../app/services/bookingService");
const mailService = require("../app/services/mailService");

const PASTA = process.env.UPLOAD_DIR;
beforeEach(async () => {
  await resetDatabase();
  await truncateTables("partners");
  fs.rmSync(PASTA, { recursive: true, force: true });
  fs.rmSync(mailService.MAIL_DIR, { recursive: true, force: true });
});

const DESC = "Saída de barco às 9h, com equipamento de mergulho e instrutor. Duração de 3 horas, lanche incluso.";
let seq = 0;
async function comoAdmin() {
  const a = await createUser({ email: `adm${++seq}@aquatrip.local`, role: "ADMIN" });
  return loginAs(a);
}
async function parceiro({ aprovar = true, mp = false, email } = {}) {
  const docs = ["52998224725", "12ABC34501DE35", "11222333000181"];
  const user = await createUser({ email: email || `parc${++seq}@aquatrip.local`, name: "Zé da Silva" });
  const partnerId = crypto.randomUUID();
  await db.query(
    `INSERT INTO partners (id, user_id, person_type, document, legal_name, display_name, phone, city, state, status, mp_connected_at)
     VALUES ($1, $2, 'PF', $3, 'Zé', $4, '12999990000', 'Ilhabela', 'SP', $5, $6)`,
    [partnerId, user.id, docs[seq % 3] === "52998224725" && seq > 3 ? "01234567890" : docs[seq % 3],
     `Passeios ${seq}`, aprovar ? "APPROVED" : "PENDING", mp ? new Date() : null]
  );
  const s = await loginAs(user);
  return { user, partnerId, ...s };
}
const criar = (p, extra = {}) => p.agent.post("/api/parceiro/experiencias").set("X-CSRF-Token", p.csrf)
  .send({ titulo: "Mergulho no Saco do Sombrio", local: "Ilhabela, SP", categoria: "mergulho", preco: 250, descricao: DESC, ...extra });
const enviar = (p, id) => p.agent.post(`/api/parceiro/experiencias/${id}/enviar`).set("X-CSRF-Token", p.csrf);
const revisar = (adm, id, corpo) => adm.agent.post(`/api/admin/revisao/experiencias/${id}`).set("X-CSRF-Token", adm.csrf).send(corpo);

async function publicada(opts = { mp: true }) {
  const p = await parceiro(opts);
  const id = (await criar(p)).body.experiencia.id;
  await enviar(p, id);
  const adm = await comoAdmin();
  await revisar(adm, id, { aprovar: true });
  await db.query(`INSERT INTO service_slots (id, service_id, starts_at, capacity) VALUES ($1, $2, NOW() + INTERVAL 5 DAY, 8)`, [crypto.randomUUID(), id]);
  const { rows } = await db.query("SELECT slug FROM services WHERE id = $1", [id]);
  return { p, adm, id, slug: rows[0].slug };
}
const naVitrine = async (titulo = "Mergulho no Saco do Sombrio") => (await request(app).get("/mergulho")).text.includes(titulo);

describe("Quem cadastra", () => {
  it("só parceiro aprovado cria experiência", async () => {
    const comum = await createUser({ email: "comum@aquatrip.local" });
    const c = await loginAs(comum);
    expect((await criar(c)).body.codigo).toBe("NOT_PARTNER");
    const pendente = await parceiro({ aprovar: false });
    expect((await criar(pendente)).body.codigo).toBe("PARTNER_NOT_ACTIVE");
  });

  it("nasce como rascunho, fora da vitrine", async () => {
    const p = await parceiro({ mp: true });
    const r = await criar(p);
    expect(r.status).toBe(201);
    expect(r.body.experiencia.review_status).toBe("DRAFT");
    expect(await naVitrine()).toBe(false);
  });
});

describe("Revisão", () => {
  it("envio exige descrição; vai para a fila do admin", async () => {
    const p = await parceiro({ mp: true });
    const id = (await criar(p, { descricao: "curta" })).body.experiencia.id;
    expect((await enviar(p, id)).body.codigo).toBe("DESCRIPTION_REQUIRED");
    await p.agent.put(`/api/parceiro/experiencias/${id}`).set("X-CSRF-Token", p.csrf).send({ descricao: DESC });
    expect((await enviar(p, id)).body.experiencia.review_status).toBe("PENDING");
    const adm = await comoAdmin();
    expect((await adm.agent.get("/api/admin/revisao/experiencias")).body.experiencias.map((x) => x.id)).toContain(id);
    expect(await naVitrine()).toBe(false);
  });

  it("recusa exige motivo da lista; parceiro corrige e reenvia", async () => {
    const p = await parceiro({ mp: true });
    const id = (await criar(p)).body.experiencia.id;
    await enviar(p, id);
    const adm = await comoAdmin();
    expect((await revisar(adm, id, { aprovar: false, motivo: "feio" })).body.codigo).toBe("INVALID_REASON");
    expect((await revisar(adm, id, { aprovar: false, motivo: "DADOS_DE_CONTATO" })).body.experiencia.review_status).toBe("REJECTED");
    const minhas = (await p.agent.get("/api/parceiro/experiencias")).body.experiencias;
    expect(minhas[0].motivo).toMatch(/telefone, site/);
    expect((await enviar(p, id)).body.experiencia.review_status).toBe("PENDING");
    const mails = fs.readdirSync(mailService.MAIL_DIR).filter((f) => f.includes("experiencia_recusada"));
    expect(mails).toHaveLength(1);
  });

  it("aprovada aparece com 'Operado por' o parceiro", async () => {
    const { slug } = await publicada();
    expect(await naVitrine()).toBe(true);
    const html = (await request(app).get(`/reservar/${slug}`)).text;
    expect(html).toMatch(/Operado por <strong>Passeios \d+<\/strong>/);
  });
});

describe("O dinheiro só vai para o parceiro (sem Mercado Pago, não vende)", () => {
  it("aprovada mas sem Mercado Pago conectado: fora da vitrine e horário não reservável", async () => {
    const { id, slug } = await publicada({ mp: false });
    expect(await naVitrine()).toBe(false);
    expect((await request(app).get(`/reservar/${slug}`)).status).toBe(404);
    const { rows } = await db.query("SELECT id FROM service_slots WHERE service_id = $1", [id]);
    const cliente = await createUser({ email: "cliente@aquatrip.local" });
    await expect(bookingService.createBooking({ userId: cliente.id, slotId: rows[0].id, quantity: 1 })).rejects.toBeTruthy();
    expect((await db.query("SELECT 1 FROM bookings")).rows).toHaveLength(0);
  });

  it("o e-mail de aprovação avisa que falta conectar o Mercado Pago", async () => {
    await publicada({ mp: false });
    const [m] = fs.readdirSync(mailService.MAIL_DIR).filter((f) => f.includes("experiencia_aprovada"))
      .map((f) => fs.readFileSync(`${mailService.MAIL_DIR}/${f}`, "utf8"));
    expect(m).toMatch(/conectar sua conta do Mercado Pago/);
  });
});

describe("Edição de experiência publicada", () => {
  it("preço muda na hora e continua no ar", async () => {
    const { p, id, slug } = await publicada();
    const r = await p.agent.put(`/api/parceiro/experiencias/${id}`).set("X-CSRF-Token", p.csrf).send({ preco: 199.9 });
    expect(r.body.experiencia).toMatchObject({ review_status: "APPROVED", price_cents: 19990, voltouParaRevisao: false });
    expect((await request(app).get(`/reservar/${slug}`)).text).toContain("199,90");
  });

  it("mudar o texto volta para revisão e tira da vitrine", async () => {
    const { p, id } = await publicada();
    const r = await p.agent.put(`/api/parceiro/experiencias/${id}`).set("X-CSRF-Token", p.csrf)
      .send({ descricao: DESC + " Ligue 12 99999-0000 para desconto." });
    expect(r.body.experiencia).toMatchObject({ review_status: "PENDING", voltouParaRevisao: true });
    expect(await naVitrine()).toBe(false);
  });

  it("não edita durante a revisão", async () => {
    const p = await parceiro({ mp: true });
    const id = (await criar(p)).body.experiencia.id;
    await enviar(p, id);
    expect((await p.agent.put(`/api/parceiro/experiencias/${id}`).set("X-CSRF-Token", p.csrf).send({ preco: 10 })).body.codigo).toBe("UNDER_REVIEW");
  });

  it("pausar tira da vitrine sem passar por revisão", async () => {
    const { p, id } = await publicada();
    await p.agent.post(`/api/parceiro/experiencias/${id}/ativa`).set("X-CSRF-Token", p.csrf).send({ ativa: false });
    expect(await naVitrine()).toBe(false);
    await p.agent.post(`/api/parceiro/experiencias/${id}/ativa`).set("X-CSRF-Token", p.csrf).send({ ativa: true });
    expect(await naVitrine()).toBe(true);
  });
});

describe("Posse: um parceiro não mexe no que é do outro", () => {
  it("editar, enviar, pausar, horários e capacidade de outro parceiro dão 404", async () => {
    const { id } = await publicada();
    const outro = await parceiro({ mp: true });
    const { rows } = await db.query("SELECT id FROM service_slots WHERE service_id = $1", [id]);
    const tentativas = [
      outro.agent.put(`/api/parceiro/experiencias/${id}`).set("X-CSRF-Token", outro.csrf).send({ preco: 1 }),
      outro.agent.post(`/api/parceiro/experiencias/${id}/enviar`).set("X-CSRF-Token", outro.csrf),
      outro.agent.post(`/api/parceiro/experiencias/${id}/ativa`).set("X-CSRF-Token", outro.csrf).send({ ativa: false }),
      outro.agent.get(`/api/parceiro/experiencias/${id}/horarios`),
      outro.agent.put(`/api/parceiro/horarios/${rows[0].id}`).set("X-CSRF-Token", outro.csrf).send({ capacidade: 1 }),
      outro.agent.delete(`/api/parceiro/horarios/${rows[0].id}`).set("X-CSRF-Token", outro.csrf),
    ];
    for (const r of await Promise.all(tentativas)) expect(r.status).toBe(404);
    const { rows: s } = await db.query("SELECT price_cents, active FROM services WHERE id = $1", [id]);
    expect(s[0]).toEqual({ price_cents: 25000, active: true });
  });

  it("o parceiro não vê nem edita experiências da equipe AquaTrip", async () => {
    const { service } = await createServiceWithSlot();
    const p = await parceiro({ mp: true });
    expect((await p.agent.put(`/api/parceiro/experiencias/${service.id}`).set("X-CSRF-Token", p.csrf).send({ preco: 1 })).status).toBe(404);
    expect((await p.agent.get("/api/parceiro/experiencias")).body.experiencias).toHaveLength(0);
  });
});

describe("Horários do parceiro", () => {
  it("programa horários e não reduz abaixo do ocupado", async () => {
    const { p, id } = await publicada();
    const ano = new Date().getUTCFullYear() + 1;
    const r = await p.agent.post(`/api/parceiro/experiencias/${id}/horarios`).set("X-CSRF-Token", p.csrf)
      .send({ dataInicio: `${ano}-03-01`, dataFim: `${ano}-03-31`, diasSemana: [6], horarios: ["09:00"], capacidade: 6 });
    expect(r.body.criados).toBeGreaterThanOrEqual(4);

    const { rows } = await db.query("SELECT id FROM service_slots WHERE service_id = $1 ORDER BY starts_at LIMIT 1", [id]);
    const cliente = await createUser({ email: "c@aquatrip.local" });
    await bookingService.createBooking({ userId: cliente.id, slotId: rows[0].id, quantity: 3 });
    const baixo = await p.agent.put(`/api/parceiro/horarios/${rows[0].id}`).set("X-CSRF-Token", p.csrf).send({ capacidade: 2 });
    expect(baixo.body.codigo).toBe("BELOW_OCCUPIED");
  });
});

describe("Capa do parceiro", () => {
  const foto = (cor) => sharp({ create: { width: 900, height: 600, channels: 3, background: cor } }).jpeg().toBuffer();
  const enviarCapa = async (p, id, cor) => p.agent.post(`/api/parceiro/experiencias/${id}/capa`)
    .set("X-CSRF-Token", p.csrf).field("alt", "Barco no mar azul").attach("imagem", await foto(cor), "c.jpg");

  it("foto nova fica pendente e a capa atual continua no ar até a aprovação", async () => {
    const { p, adm, id, slug } = await publicada();
    await enviarCapa(p, id, "#113355");
    const idPrimeira = (await db.query("SELECT pending_cover_media_id AS m FROM services WHERE id = $1", [id])).rows[0].m;
    await adm.agent.post(`/api/admin/moderacao/fotos/${idPrimeira}`).set("X-CSRF-Token", adm.csrf).send({ aprovar: true });
    const capa1 = (await db.query("SELECT storage_key FROM media WHERE id = $1", [idPrimeira])).rows[0].storage_key;
    expect((await request(app).get(`/reservar/${slug}`)).text).toContain(capa1);

    await enviarCapa(p, id, "#aa3300");
    // Pendente: a página pública continua com a capa aprovada.
    expect((await request(app).get(`/reservar/${slug}`)).text).toContain(capa1);
    const fila = (await adm.agent.get("/api/admin/moderacao/fotos")).body.fotos;
    expect(fila[0].origem).toBe("capa de parceiro");

    await adm.agent.post(`/api/admin/moderacao/fotos/${fila[0].id}`).set("X-CSRF-Token", adm.csrf).send({ aprovar: true });
    const html = (await request(app).get(`/reservar/${slug}`)).text;
    expect(html).toContain(fila[0].storage_key);
    expect(html).not.toContain(capa1);
    expect(fs.existsSync(`${PASTA}/${capa1}`)).toBe(false); // antiga apagada do disco
  });

  it("capa recusada sai da espera e a atual continua", async () => {
    const { p, adm, id } = await publicada();
    await enviarCapa(p, id, "#113355");
    const pend = (await db.query("SELECT pending_cover_media_id AS m FROM services WHERE id = $1", [id])).rows[0].m;
    await adm.agent.post(`/api/admin/moderacao/fotos/${pend}`).set("X-CSRF-Token", adm.csrf).send({ aprovar: false, motivo: "DIREITOS" });
    const { rows } = await db.query("SELECT pending_cover_media_id, cover_media_id FROM services WHERE id = $1", [id]);
    expect(rows[0]).toEqual({ pending_cover_media_id: null, cover_media_id: null });
    const mails = fs.readdirSync(mailService.MAIL_DIR).filter((f) => f.includes("capa_recusada"));
    expect(mails).toHaveLength(1);
  });
});

describe("Experiências da equipe", () => {
  it("continuam aprovadas e visíveis como antes", async () => {
    await createServiceWithSlot({ slug: "da-equipe", title: "Experiência da Equipe" });
    expect(await naVitrine("Experiência da Equipe")).toBe(true);
    expect((await request(app).get("/reservar/da-equipe")).text).toContain("Operado por <strong>AquaTrip</strong>");
  });
});
