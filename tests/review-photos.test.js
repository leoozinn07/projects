/* ==============================================================
   Testes — fotos em avaliações e moderação
   ============================================================== */
const fs = require("fs");
const sharp = require("sharp");
const request = require("supertest");
const { app, db, resetDatabase, createUser, createServiceWithSlot, loginAs } = require("./helpers");
const bookingService = require("../app/services/bookingService");
const mailService = require("../app/services/mailService");
const dataRightsService = require("../app/services/dataRightsService");

const PASTA = process.env.UPLOAD_DIR;

beforeEach(async () => {
  await resetDatabase();
  fs.rmSync(PASTA, { recursive: true, force: true });
  fs.rmSync(mailService.MAIL_DIR, { recursive: true, force: true });
});

const arquivosNoDisco = () => (fs.existsSync(PASTA) ? fs.readdirSync(PASTA) : []);

async function fotoComGps(cor = "#2a7fa0") {
  return sharp({ create: { width: 900, height: 600, channels: 3, background: cor } })
    .jpeg()
    .withExif({ IFD0: { Copyright: "SEGREDO-METADADO" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "23/1 33/1 0/1" } })
    .toBuffer();
}

/** Cliente com reserva realizada e avaliação publicada. */
async function autorComAvaliacao(email = "autor@aquatrip.local") {
  const user = await createUser({ email, name: "Lia Beatriz Souza" });
  const { slot, service } = await createServiceWithSlot({ slug: "exp-" + email.split("@")[0], title: "Experiência Teste" });
  const b = await bookingService.createBooking({ userId: user.id, slotId: slot.id, quantity: 1 });
  await bookingService.startPayment({ bookingId: b.id, user: { id: user.id, role: "USER", email: user.email, name: user.name }, method: "CREDIT_CARD", cardLastFour: "4242" });
  await db.query("UPDATE service_slots SET starts_at = NOW() - INTERVAL 1 DAY WHERE id = $1", [slot.id]);
  const { agent, csrf } = await loginAs(user);
  const r = await agent.post("/api/avaliacoes").set("X-CSRF-Token", csrf).send({ bookingId: b.id, nota: 5, texto: "Ótimo passeio" });
  return { user, service, agent, csrf, reviewId: r.body.avaliacao.id };
}

const enviarFoto = (agent, csrf, reviewId, buffer) =>
  agent.post(`/api/avaliacoes/${reviewId}/fotos`).set("X-CSRF-Token", csrf).attach("imagem", buffer, "foto.jpg");

async function comoAdmin() {
  const admin = await createUser({ email: "moderador@aquatrip.local", role: "ADMIN" });
  return { admin, ...(await loginAs(admin)) };
}

const moderar = (agent, csrf, id, corpo) =>
  agent.post(`/api/admin/moderacao/fotos/${id}`).set("X-CSRF-Token", csrf).send(corpo);

describe("Envio", () => {
  it("foto entra PENDENTE e sem metadados", async () => {
    const { agent, csrf, reviewId } = await autorComAvaliacao();
    const res = await enviarFoto(agent, csrf, reviewId, await fotoComGps());
    expect(res.status).toBe(201);
    expect(res.body.foto.status).toBe("PENDING");

    const [arq] = arquivosNoDisco();
    const buf = fs.readFileSync(`${PASTA}/${arq}`);
    expect((await sharp(buf).metadata()).exif).toBeUndefined();
    expect(buf.includes("SEGREDO-METADADO")).toBe(false);
  });

  it("só o autor envia foto na própria avaliação", async () => {
    const { reviewId } = await autorComAvaliacao();
    const intruso = await createUser({ email: "intruso@aquatrip.local" });
    const { agent, csrf } = await loginAs(intruso);
    expect((await enviarFoto(agent, csrf, reviewId, await fotoComGps())).status).toBe(404);
    expect((await request(app).post(`/api/avaliacoes/${reviewId}/fotos`).attach("imagem", await fotoComGps(), "f.jpg")).status).toBe(401);
    expect(arquivosNoDisco()).toHaveLength(0);
  });

  it("limite de 3 fotos — inclusive com envios simultâneos", async () => {
    const { agent, csrf, reviewId } = await autorComAvaliacao();
    const foto = await fotoComGps();
    const resultados = await Promise.all([1, 2, 3, 4, 5].map(() => enviarFoto(agent, csrf, reviewId, foto)));
    const aceitas = resultados.filter((r) => r.status === 201).length;
    expect(aceitas).toBe(3);
    expect(resultados.filter((r) => r.status === 409)).toHaveLength(2);
    // Envio recusado não deixa arquivo órfão no disco.
    expect(arquivosNoDisco()).toHaveLength(3);
  });

  it("arquivo malicioso é recusado pelo mesmo pipeline das capas", async () => {
    const { agent, csrf, reviewId } = await autorComAvaliacao();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await agent.post(`/api/avaliacoes/${reviewId}/fotos`).set("X-CSRF-Token", csrf).attach("imagem", svg, "a.svg");
    expect(res.status).toBe(415);
  });
});

describe("Foto pendente não vaza", () => {
  it("não aparece na página pública nem é servida a visitantes", async () => {
    const { agent, csrf, reviewId, service } = await autorComAvaliacao();
    const url = (await enviarFoto(agent, csrf, reviewId, await fotoComGps())).body.foto.url;

    expect((await request(app).get(`/reservar/${service.slug}`)).text).not.toContain(url);
    expect((await request(app).get(url)).status).toBe(404); // nem pela URL direta
    const outro = await createUser({ email: "curioso@aquatrip.local" });
    const { agent: ag2 } = await loginAs(outro);
    expect((await ag2.get(url)).status).toBe(404);
  });

  it("autor e moderador veem — e nunca em cache compartilhado", async () => {
    const { agent, csrf, reviewId } = await autorComAvaliacao();
    const url = (await enviarFoto(agent, csrf, reviewId, await fotoComGps())).body.foto.url;

    const doAutor = await agent.get(url);
    expect(doAutor.status).toBe(200);
    expect(doAutor.headers["cache-control"]).toBe("private, no-store");

    const { agent: adm } = await comoAdmin();
    expect((await adm.get(url)).status).toBe(200);
  });
});

describe("Moderação", () => {
  it("aprovada aparece na página pública com cache longo", async () => {
    const { agent, csrf, reviewId, service } = await autorComAvaliacao();
    const foto = (await enviarFoto(agent, csrf, reviewId, await fotoComGps())).body.foto;
    const { agent: adm, csrf: cadm } = await comoAdmin();

    const fila = await adm.get("/api/admin/moderacao/fotos");
    expect(fila.body.fotos.map((f) => f.id)).toContain(foto.id);

    expect((await moderar(adm, cadm, foto.id, { aprovar: true })).status).toBe(200);
    expect((await request(app).get(`/reservar/${service.slug}`)).text).toContain(foto.url);
    const publica = await request(app).get(foto.url);
    expect(publica.status).toBe(200);
    expect(publica.headers["cache-control"]).toContain("immutable");
  });

  it("recusa exige motivo da lista, apaga o arquivo e avisa o autor", async () => {
    const { agent, csrf, reviewId } = await autorComAvaliacao();
    const foto = (await enviarFoto(agent, csrf, reviewId, await fotoComGps())).body.foto;
    const { agent: adm, csrf: cadm } = await comoAdmin();

    expect((await moderar(adm, cadm, foto.id, { aprovar: false, motivo: "nao gostei" })).body.codigo).toBe("INVALID_REASON");
    expect((await moderar(adm, cadm, foto.id, { aprovar: false })).body.codigo).toBe("INVALID_REASON");

    const ok = await moderar(adm, cadm, foto.id, { aprovar: false, motivo: "PESSOAS_IDENTIFICAVEIS" });
    expect(ok.body.foto.status).toBe("REJECTED");
    expect(arquivosNoDisco()).toHaveLength(0);

    const [email] = fs.readdirSync(mailService.MAIL_DIR).filter((f) => f.includes("foto_recusada"))
      .map((f) => fs.readFileSync(`${mailService.MAIL_DIR}/${f}`, "utf8"));
    expect(email).toContain("autor@aquatrip.local");
    expect(email).toContain("rosto de outras pessoas");

    // O autor vê o motivo no painel, e a vaga volta a ficar livre.
    const painel = await agent.get(`/api/avaliacoes/${reviewId}/fotos`);
    expect(painel.body.fotos[0]).toMatchObject({ status: "REJECTED", url: null });
    expect(painel.body.fotos[0].motivo).toMatch(/rosto/);
  });

  it("vaga de foto recusada pode ser reusada", async () => {
    const { agent, csrf, reviewId } = await autorComAvaliacao();
    const foto = await fotoComGps();
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await enviarFoto(agent, csrf, reviewId, foto)).body.foto.id);
    expect((await enviarFoto(agent, csrf, reviewId, foto)).status).toBe(409);

    const { agent: adm, csrf: cadm } = await comoAdmin();
    await moderar(adm, cadm, ids[0], { aprovar: false, motivo: "QUALIDADE" });
    expect((await enviarFoto(agent, csrf, reviewId, foto)).status).toBe(201);
  });

  it("a mesma foto não é moderada duas vezes", async () => {
    const { agent, csrf, reviewId } = await autorComAvaliacao();
    const foto = (await enviarFoto(agent, csrf, reviewId, await fotoComGps())).body.foto;
    const { agent: adm, csrf: cadm } = await comoAdmin();
    await moderar(adm, cadm, foto.id, { aprovar: true });
    expect((await moderar(adm, cadm, foto.id, { aprovar: false, motivo: "QUALIDADE" })).status).toBe(409);
  });

  it("só admin modera, e a decisão fica na auditoria", async () => {
    const { agent, csrf, reviewId } = await autorComAvaliacao();
    const foto = (await enviarFoto(agent, csrf, reviewId, await fotoComGps())).body.foto;
    expect((await moderar(agent, csrf, foto.id, { aprovar: true })).status).toBe(403);

    const { agent: adm, csrf: cadm } = await comoAdmin();
    await moderar(adm, cadm, foto.id, { aprovar: false, motivo: "FORA_DO_TEMA" });
    const { rows } = await db.query("SELECT metadata FROM audit_log WHERE action = 'PHOTO_REJECTED'");
    expect(rows[0].metadata.motivo).toBe("FORA_DO_TEMA");
  });

  it("fotos pendentes entram no contador do atendimento", async () => {
    const { agent, csrf, reviewId } = await autorComAvaliacao();
    await enviarFoto(agent, csrf, reviewId, await fotoComGps());
    const { agent: adm } = await comoAdmin();
    expect((await adm.get("/api/admin/atendimento")).body.contadores.fotos_pendentes).toBe(1);
  });

  it("capa enviada pelo admin continua publicada na hora", async () => {
    const { agent: adm, csrf: cadm } = await comoAdmin();
    const { service } = await createServiceWithSlot({ slug: "capa-direta" });
    const r = await adm.post(`/api/admin/experiencias/${service.id}/capa`).set("X-CSRF-Token", cadm)
      .field("alt", "Descrição da capa").attach("imagem", await fotoComGps(), "c.jpg");
    expect((await request(app).get(r.body.capa.url)).status).toBe(200);
  });
});

describe("Limpeza de arquivos", () => {
  it("excluir a avaliação apaga as fotos do disco e do banco", async () => {
    const { agent, csrf, reviewId } = await autorComAvaliacao();
    await enviarFoto(agent, csrf, reviewId, await fotoComGps());
    await enviarFoto(agent, csrf, reviewId, await fotoComGps("#aa3300"));
    expect(arquivosNoDisco()).toHaveLength(2);

    await agent.delete(`/api/avaliacoes/${reviewId}`).set("X-CSRF-Token", csrf);
    expect(arquivosNoDisco()).toHaveLength(0);
    expect((await db.query("SELECT 1 FROM media WHERE purpose = 'REVIEW'")).rows).toHaveLength(0);
  });

  it("a anonimização apaga as fotos da pessoa", async () => {
    const { user, agent, csrf, reviewId } = await autorComAvaliacao();
    await enviarFoto(agent, csrf, reviewId, await fotoComGps());
    const pedido = await dataRightsService.createRequest({ userId: user.id, kind: "DELETION", req: null });

    const { agent: adm, csrf: cadm } = await comoAdmin();
    const r = await adm.post(`/api/admin/solicitacoes/${pedido.id}`).set("X-CSRF-Token", cadm)
      .send({ status: "DONE", resposta: "Conta anonimizada.", anonimizar: true });
    expect(r.status).toBe(200);
    expect(arquivosNoDisco()).toHaveLength(0);
    expect((await db.query("SELECT 1 FROM media WHERE uploaded_by = $1", [user.id])).rows).toHaveLength(0);
  });
});
