/* ==============================================================
   AquaTrip — Catálogo
   Um controller e um template para as seis categorias. Antes eram
   seis arquivos HTML quase idênticos, cada um com seus dados
   inventados — corrigir um detalhe exigia editar seis lugares.
   ============================================================== */
const catalogRepository = require("../repositories/catalogRepository");
const { CATEGORIAS } = require("../lib/categorias");
const filtro = require("../lib/filtroCatalogo");

/* Rota pública -> chave da categoria no banco. As URLs antigas
   (/praias, /aquarios, /expedicoes) ficam como estão: já foram
   compartilhadas e indexadas. */
const PAGINAS = {
  praias: {
    categoria: "praia",
    titulo: "Praias",
    chamada: "Enseadas, piscinas naturais e dias de sol, com quem conhece o lugar.",
    imagem: "/img/praia.webp",
  },
  mergulho: {
    categoria: "mergulho",
    titulo: "Mergulho",
    chamada: "Do batismo às saídas guiadas, com equipamento e instrutor.",
    imagem: "/img/cardume_peixes.avif",
  },
  caiaque: {
    categoria: "caiaque",
    titulo: "Caiaque",
    chamada: "Remadas por rios, manguezais e mar aberto.",
    imagem: "/img/praia.webp",
  },
  pesca: {
    categoria: "pesca",
    titulo: "Pesca esportiva",
    chamada: "Saídas com guia, barco e o equipamento certo para cada espécie.",
    imagem: "/img/mata.webp",
  },
  aquarios: {
    categoria: "aquario",
    titulo: "Aquários",
    chamada: "Visitas a aquários e centros de vida marinha.",
    imagem: "/img/santos.webp",
  },
  expedicoes: {
    categoria: "expedicao",
    titulo: "Expedições",
    chamada: "Roteiros de vários dias para quem quer ir mais longe.",
    imagem: "/img/baleia.webp",
  },
};

/** Rota de cada categoria, para a navegação entre catálogos. */
const ROTA_DA_CATEGORIA = Object.fromEntries(
  Object.entries(PAGINAS).map(([rota, p]) => [p.categoria, "/" + rota])
);

/** As seis categorias, na ordem das rotas, com quantas experiências cada uma tem. */
function navegacao(contagem) {
  return Object.entries(PAGINAS).map(([r, p]) => ({ rota: "/" + r, titulo: p.titulo, n: contagem[p.categoria] || 0 }));
}

/** /reservar: o mesmo catálogo, com todas as categorias. */
async function todas(req, res, next) {
  try {
    const [experiencias, contagem] = await Promise.all([
      catalogRepository.listAll(),
      catalogRepository.countByCategory(),
    ]);
    const precos = experiencias.map((e) => e.price_cents);
    const filtros = filtro.ler(req.query);
    const { itens, visiveis } = filtro.aplicar(experiencias, filtros);
    res.render("pages/catalogo", {
      rota: null,
      cfg: null,
      experiencias: itens,
      visiveis,
      filtros,
      qs: filtro.queryString(filtros, ["max"]),
      outras: [],
      categoriasNav: navegacao(contagem),
      precoMax: precos.length ? Math.ceil(Math.max(...precos) / 100) : 0,
      rotuloCategoria: null,
      error: typeof req.query.error === "string" ? req.query.error.slice(0, 200) : null,
    });
  } catch (err) {
    next(err);
  }
}

/** Índice da busca do cabeçalho: só o que é público e visível. */
async function indiceBusca(req, res, next) {
  try {
    const todas = await catalogRepository.listAll();
    res.set("Cache-Control", "public, max-age=60");
    res.json(todas.map((e) => ({
      titulo: e.title,
      local: e.location || "",
      categoria: CATEGORIAS[e.category] || "",
      href: "/reservar/" + encodeURIComponent(e.slug),
      preco: Math.round(e.price_cents / 100),
    })));
  } catch (err) {
    next(err);
  }
}

function pagina(rota) {
  const cfg = PAGINAS[rota];
  return async function (req, res, next) {
    try {
      const [experiencias, contagem] = await Promise.all([
        catalogRepository.listByCategory(cfg.categoria),
        catalogRepository.countByCategory(),
      ]);

      const outras = Object.entries(PAGINAS)
        .filter(([r]) => r !== rota)
        .map(([r, p]) => ({ rota: "/" + r, titulo: p.titulo, n: contagem[p.categoria] || 0 }));

      const precos = experiencias.map((e) => e.price_cents);
      const filtros = filtro.ler(req.query);
      const { itens, visiveis } = filtro.aplicar(experiencias, filtros);
      res.render("pages/catalogo", {
        rota,
        cfg,
        experiencias: itens,
        visiveis,
        filtros,
        qs: filtro.queryString(filtros, ["max"]),
        outras,
        categoriasNav: navegacao(contagem),
        precoMax: precos.length ? Math.ceil(Math.max(...precos) / 100) : 0,
        rotuloCategoria: CATEGORIAS[cfg.categoria],
      });
    } catch (err) {
      next(err);
    }
  };
}

/** Categoria do banco -> { rota, titulo, chamada, imagem } (home, busca, cartões). */
const POR_CATEGORIA = Object.fromEntries(
  Object.entries(PAGINAS).map(([rota, p]) => [p.categoria, { rota: "/" + rota, ...p }])
);

module.exports = { PAGINAS, ROTA_DA_CATEGORIA, POR_CATEGORIA, pagina, todas, indiceBusca };
