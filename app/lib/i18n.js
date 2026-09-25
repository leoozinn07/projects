/* ==============================================================
   AquaTrip · Idiomas (pt, en, es)
   ==============================================================
   Dicionários em app/locales/*.json, carregados uma vez no boot.
   Regras:
   - Português é a língua de referência: toda chave existe em pt.
     Faltou em en/es, cai no pt (nunca mostra a chave crua).
   - Chaves terminadas em "_html" carregam marcação confiável do
     próprio dicionário e são impressas com <%- %>. As demais usam
     <%= %> (escapadas).
   - `tm(mensagem)` traduz mensagens que chegam prontas do servidor
     (erros de validação, avisos) procurando o texto em pt no mapa
     "msg" de cada idioma. Sem tradução, devolve o original.
   - Conteúdo digitado por parceiros (títulos, descrições) não passa
     por aqui: continua no idioma em que foi escrito.
   ============================================================== */
const path = require("path");
const fs = require("fs");
const { criarFormatadores } = require("./datas");

const IDIOMAS = ["pt", "en", "es"];
const PADRAO = "pt";
const HTML_LANG = { pt: "pt-BR", en: "en", es: "es" };
const INTL = { pt: "pt-BR", en: "en-US", es: "es-ES" };
const NOMES = { pt: "Português", en: "English", es: "Español" };
const COOKIE = "aquatrip_lang";

function mesclar(destino, origem, arquivo) {
  for (const [k, v] of Object.entries(origem)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (destino[k] !== undefined && (typeof destino[k] !== "object")) throw new Error(`[i18n] ${arquivo}: "${k}" conflita`);
      destino[k] = mesclar(destino[k] || {}, v, arquivo);
    } else {
      if (destino[k] !== undefined) throw new Error(`[i18n] ${arquivo}: chave "${k}" repetida`);
      destino[k] = v;
    }
  }
  return destino;
}

/**
 * app/locales/<idioma>.json (base: cabeçalho, rodapé, mensagens) +
 * app/locales/<idioma>/*.json (uma área do site por arquivo). Chave
 * repetida entre arquivos derruba o boot: melhor que uma sobrescrever
 * a outra em silêncio.
 */
function carregar(idioma) {
  const raiz = path.join(__dirname, "..", "locales");
  const dic = JSON.parse(fs.readFileSync(path.join(raiz, idioma + ".json"), "utf8"));
  const pasta = path.join(raiz, idioma);
  if (fs.existsSync(pasta)) {
    for (const nome of fs.readdirSync(pasta).filter((n) => n.endsWith(".json")).sort()) {
      const arquivo = path.join(pasta, nome);
      mesclar(dic, JSON.parse(fs.readFileSync(arquivo, "utf8")), `${idioma}/${nome}`);
    }
  }
  return dic;
}

const DIC = Object.fromEntries(IDIOMAS.map((l) => [l, carregar(l)]));

function buscar(dic, chave) {
  return chave.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), dic);
}

function interpolar(texto, vars) {
  if (!vars || typeof texto !== "string") return texto;
  return texto.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------------------------------------------
   tm(): além do mapa "msg" (correspondência exata), suporta "msg_padroes"
   — mensagens com parte dinâmica, ex.: "Não há vagas suficientes nesse
   horário (restam {n})." Cada padrão vira uma regex (compilada uma vez
   e cacheada): "{n}" casa com dígitos ou qualquer texto (non-greedy);
   o resto do texto é escapado para não ser interpretado como regex.
   ------------------------------------------------------------------ */
const CACHE_PADROES = new Map(); // idioma -> [{ regex, chaves, modelo }]

function compilarPadroes(idioma, padroes) {
  if (CACHE_PADROES.has(idioma)) return CACHE_PADROES.get(idioma);
  const compilados = Object.entries(padroes || {}).map(([padraoPt, modelo]) => {
    const chaves = [];
    const partes = padraoPt.split(/\{(\w+)\}/g);
    let fonte = "^";
    partes.forEach((parte, i) => {
      if (i % 2 === 1) {
        chaves.push(parte);
        fonte += "(\\d+|.+?)";
      } else {
        fonte += escapeRegExp(parte);
      }
    });
    fonte += "$";
    return { regex: new RegExp(fonte), chaves, modelo };
  });
  CACHE_PADROES.set(idioma, compilados);
  return compilados;
}

function aplicarPadrao(mensagem, idioma, padroes) {
  const compilados = compilarPadroes(idioma, padroes);
  for (const { regex, chaves, modelo } of compilados) {
    const m = mensagem.match(regex);
    if (!m) continue;
    let resultado = modelo;
    chaves.forEach((chave, i) => {
      resultado = resultado.split(`{${chave}}`).join(m[i + 1]);
    });
    return resultado;
  }
  return null;
}

function tradutor(idioma) {
  const dic = DIC[idioma] || DIC[PADRAO];
  const base = DIC[PADRAO];
  function t(chave, vars) {
    let v = buscar(dic, chave);
    if (v === undefined) v = buscar(base, chave);
    if (v === undefined) return chave;
    return interpolar(v, vars);
  }
  function tm(mensagem) {
    if (!mensagem || idioma === PADRAO) return mensagem;
    const mapa = dic.msg || {};
    if (mapa[mensagem]) return mapa[mensagem];
    const viaPadrao = aplicarPadrao(mensagem, idioma, dic.msg_padroes);
    if (viaPadrao !== null) return viaPadrao;
    return mensagem;
  }
  return { t, tm };
}

/** Pega o idioma aceito pelo navegador, se for um dos três. */
function doNavegador(header) {
  const partes = String(header || "").toLowerCase().split(",");
  for (const p of partes) {
    const cod = p.trim().slice(0, 2);
    if (IDIOMAS.includes(cod)) return cod;
  }
  return null;
}

function lerCookie(req, nome) {
  const bruto = req.headers.cookie || "";
  for (const par of bruto.split(";")) {
    const [k, ...v] = par.trim().split("=");
    if (k === nome) return decodeURIComponent(v.join("="));
  }
  return null;
}

function valido(idioma) {
  return IDIOMAS.includes(idioma) ? idioma : null;
}

/** Ordem: escolha salva (cookie) > conta do usuário > navegador > pt. */
function resolver(req) {
  return (
    valido(lerCookie(req, COOKIE)) ||
    valido(req.session && req.session.user && req.session.user.locale) ||
    valido(doNavegador(req.headers["accept-language"])) ||
    PADRAO
  );
}

function gravarCookie(res, idioma) {
  res.cookie(COOKIE, idioma, {
    maxAge: 1000 * 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false, // o próprio front lê para formatar números
    secure: process.env.NODE_ENV === "production",
  });
}

/** Coloca t, tm, idioma e formatadores em res.locals. */
function middleware(req, res, next) {
  const idioma = resolver(req);
  const { t, tm } = tradutor(idioma);
  req.lang = idioma;
  req.t = t;
  req.tm = tm;
  res.locals.lang = idioma;
  res.locals.htmlLang = HTML_LANG[idioma];
  res.locals.intl = INTL[idioma];
  res.locals.t = t;
  res.locals.tm = tm;
  res.locals.fmt = criarFormatadores(INTL[idioma]);
  // Rótulo de categoria no idioma (a chave do banco não muda).
  const rotuloPt = require("./categorias").rotulo;
  res.locals.categoriaRotulo = (chave) => {
    const v = t("categoria." + chave);
    return v === "categoria." + chave ? rotuloPt(chave) : v;
  };
  res.locals.idiomas = IDIOMAS.map((l) => ({ codigo: l, nome: NOMES[l] }));
  // Textos que o JavaScript do navegador precisa (bloco "client").
  res.locals.i18nCliente = JSON.stringify({ lang: idioma, intl: INTL[idioma], dic: (DIC[idioma] || DIC[PADRAO]).client || {} })
    .replace(/</g, "\\u003c");
  next();
}

/** Locais de idioma em português, para views desenhadas sem o middleware. */
function padroes() {
  const { t, tm } = tradutor(PADRAO);
  return {
    t,
    tm,
    lang: PADRAO,
    htmlLang: HTML_LANG[PADRAO],
    intl: INTL[PADRAO],
    idiomas: IDIOMAS.map((l) => ({ codigo: l, nome: NOMES[l] })),
    i18nCliente: JSON.stringify({ lang: PADRAO, intl: INTL[PADRAO], dic: DIC[PADRAO].client || {} }).replace(/</g, "\\u003c"),
  };
}

/** Valores padrão para views desenhadas antes do middleware (página de erro). */
function locaisPadrao(app) {
  Object.assign(app.locals, padroes());
}

/** Completa só o que faltar (handlers de erro: o middleware pode não ter rodado). */
function completar(locais) {
  for (const [k, v] of Object.entries(padroes())) {
    if (locais[k] === undefined) locais[k] = v;
  }
  return locais;
}

// Última defesa: o cabeçalho lê daqui quando é desenhado por um app sem
// NENHUM local (ex.: um caminho novo que esqueceu os padrões).
globalThis.__aquatripI18n = padroes();

module.exports = { IDIOMAS, PADRAO, HTML_LANG, INTL, NOMES, COOKIE, tradutor, resolver, gravarCookie, middleware, locaisPadrao, padroes, completar, valido, DIC };
