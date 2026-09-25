/* ==============================================================
   AquaTrip · Home
   A vitrine usa os mesmos dados do catálogo: o que aparece no
   carrossel e no mapa é o que dá para reservar de verdade.
   ============================================================== */
const catalogRepository = require("../repositories/catalogRepository");
const { POR_CATEGORIA } = require("./catalogController");
const { COMISSAO_PADRAO } = require("../services/partnerService");

/* Ordem das categorias na home (slides horizontais). */
const ORDEM = ["mergulho", "praia", "aquario", "caiaque", "pesca", "expedicao"];

/* Aqua Score: perfil editorial da equipe AquaTrip para as
   experiências que ela mesma opera. Sem score, o cartão mostra
   quem organiza. Não é nota de cliente. */
const AQUA_SCORE = {
  "mergulho-noronha": [92, 96, 58],
  "caiaque-ilhabela": [64, 81, 89],
  "aquario-santos": [32, 70, 84],
  "pesca-rio-negro": [88, 93, 61],
};

/* Coordenadas reais das cidades onde há experiência. O mapa só
   marca o que está nesta lista; o que não estiver aparece na
   lista ao lado, sem pino. Posições já projetadas no SVG do Brasil
   (Mercator, viewBox 700x640), geradas a partir do Natural Earth. */
const LUGARES = {
  "Manaus, AM":              { sub: "Rio Negro",        coord: "3°07′S 60°01′W",  xy: [238, 142] },
  "Fernando de Noronha, PE": { sub: "Arquipélago",      coord: "3°51′S 32°25′W",  xy: [641, 153] },
  "Ubatuba, SP":             { sub: "Litoral norte",    coord: "23°26′S 45°05′W", xy: [456, 448] },
  "Ilhabela, SP":            { sub: "Litoral norte",    coord: "23°47′S 45°22′W", xy: [452, 454] },
  "Santos, SP":              { sub: "Baixada Santista", coord: "23°58′S 46°20′W", xy: [438, 457] },
};

function capa(e) {
  if (e.cover_key) return { src: "/media/" + e.cover_key, alt: e.cover_alt || "" };
  const c = POR_CATEGORIA[e.category];
  return { src: c ? c.imagem : "/img/noronha-hero.webp", alt: "", ilustrativa: true };
}

async function index(req, res, next) {
  try {
    const [todas, contagem] = await Promise.all([
      catalogRepository.listAll(),
      catalogRepository.countByCategory(),
    ]);

    const destaques = todas.slice(0, 8).map((e) => ({
      ...e,
      capa: capa(e),
      score: AQUA_SCORE[e.slug] || null,
    }));

    const porLugar = new Map();
    todas.forEach((e) => {
      const nome = (e.location || "").trim();
      if (!nome) return;
      porLugar.set(nome, (porLugar.get(nome) || 0) + 1);
    });
    const lugares = [...porLugar.entries()].map(([nome, n]) => ({ nome, n, ...(LUGARES[nome] || {}) }));

    const categorias = ORDEM.map((k) => ({ chave: k, n: contagem[k] || 0, ...POR_CATEGORIA[k] }));

    res.render("pages/index", { destaques, lugares, categorias, total: todas.length, comissao: COMISSAO_PADRAO });
  } catch (err) {
    next(err);
  }
}

module.exports = { index, AQUA_SCORE, capa };
