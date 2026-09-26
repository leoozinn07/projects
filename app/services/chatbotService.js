/* ==============================================================
   AquaTrip — Assistente "Ajuda" (central de perguntas frequentes)
   ==============================================================
   SEM IA e sem custo: nenhuma chave de API, nenhum serviço externo.
   A pessoa digita a dúvida e o servidor:
     1. procura a resposta pronta mais parecida em lib/assistente/faq.js
        (palavras-chave com peso: palavras raras valem mais);
     2. se a pergunta fala de experiências, destinos ou categorias,
        busca no catálogo PÚBLICO (o mesmo de /reservar);
     3. sem nada parecido, diz que não encontrou e sugere assuntos.
   Limitação assumida: não "conversa" — não entende continuação
   ("e para crianças?") nem frases muito diferentes da base.

   Segurança e privacidade:
   - As respostas são textos fixos: não há como fazer o assistente
     revelar dados, instruções ou qualquer coisa fora da base.
   - O histórico fica na SESSÃO do servidor (some ao sair) e números
     de cartão/CPF digitados por engano são mascarados antes de guardar.
   - Nada da conversa vai para o banco de dados.
   ============================================================== */
const db = require("../lib/db");
const { visivel, semExemplo } = require("../lib/visibilidade");
const { CATEGORIAS } = require("../lib/categorias");
const { FAQ, POPULARES } = require("../lib/assistente/faq");

const MAX_MENSAGEM = 800;
const MAX_HISTORICO = 12; // mensagens (6 trocas) guardadas na sessão
const IDIOMAS = ["pt", "en", "es"];

class ChatError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* ---------- Textos do próprio assistente ---------- */

const TEXTOS = {
  pt: {
    nao_entendi: "Não encontrei uma resposta pronta para isso. Eu respondo dúvidas sobre o AquaTrip: reservas, pagamento, criar experiência, comunidade, perfil e privacidade. Tente com outras palavras, escolha um dos assuntos abaixo ou fale com a equipe em /feedback.",
    achei_exp: "Encontrei estas experiências:",
    sem_exp: "Não encontrei experiências com isso agora. Veja todas em /reservar ou as viagens da comunidade em /comunidade.",
    dado_sensivel: "Por segurança, não envie número de cartão, CPF, senha ou códigos por aqui. Esta central não precisa desses dados e não tem acesso à sua conta.",
    vazia: "Escreva sua pergunta.",
    longa: `Mensagem longa demais (máximo ${MAX_MENSAGEM} caracteres).`,
    gratuita: "gratuita",
    sem_data: "sem data com vaga no momento",
  },
  en: {
    nao_entendi: "I couldn't find a ready answer for that. I answer questions about AquaTrip: bookings, payment, creating an experience, the community, profile and privacy. Try other words, pick a topic below or contact the team at /feedback.",
    achei_exp: "I found these experiences:",
    sem_exp: "I couldn't find experiences for that right now. See them all at /reservar or community trips at /comunidade.",
    dado_sensivel: "For your safety, don't send card numbers, CPF, passwords or codes here. This help center doesn't need that data and has no access to your account.",
    vazia: "Type your question.",
    longa: `Message too long (maximum ${MAX_MENSAGEM} characters).`,
    gratuita: "free",
    sem_data: "no date with spots right now",
  },
  es: {
    nao_entendi: "No encontré una respuesta lista para eso. Respondo dudas sobre AquaTrip: reservas, pago, crear una experiencia, comunidad, perfil y privacidad. Prueba con otras palabras, elige un tema abajo o habla con el equipo en /feedback.",
    achei_exp: "Encontré estas experiencias:",
    sem_exp: "No encontré experiencias con eso ahora. Mira todas en /reservar o los viajes de la comunidad en /comunidade.",
    dado_sensivel: "Por seguridad, no envíes número de tarjeta, CPF, contraseñas ni códigos por aquí. Este centro de ayuda no necesita esos datos y no tiene acceso a tu cuenta.",
    vazia: "Escribe tu pregunta.",
    longa: `Mensaje demasiado largo (máximo ${MAX_MENSAGEM} caracteres).`,
    gratuita: "gratuita",
    sem_data: "sin fecha con cupos por ahora",
  },
};

/* ---------- Texto -> palavras comparáveis ---------- */

const PARADAS = new Set((
  // pt
  "a o as os um uma uns umas de do da dos das d em no na nos nas num numa por pelo pela pelos pelas para pra pro " +
  "com sem e ou que como qual quais quando onde porque eu voce vc voces meu minha meus minhas seu sua seus suas " +
  "isso esse essa este esta aquele aquela ele ela eles elas tem ter tenho ha ser sou estou estao posso pode podem " +
  "consigo quero queria gostaria saber me te se lhe quem ver vejo veja ao aos la ja so tambem mais muito ai aqui ali algum alguma " +
  "faco fazer faz fiz vou vai preciso ajuda favor oque q eh nao sim ok " +
  // en
  "the an to of in on at for and or is are am be do does did how what which when where why can could would i my me you your " +
  "it its this that with from about please want need know get " +
  // es
  "el los las un una unos unas del al en con y es son mi mis tu tus su sus puedo quiero hay cual donde cuando lo le yo usted"
).split(/\s+/));

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function palavras(texto) {
  return normalizar(texto).split(" ").filter((p) => p && !PARADAS.has(p));
}

/* Raiz da palavra: tira terminações comuns (plural, verbo, "-ção"...) para
   "reserva", "reservar", "reservas" e "reservo" virarem a mesma coisa sem
   confundir palavras diferentes que só começam igual ("conta"/"contato",
   "real"/"realizei"). A raiz precisa ter pelo menos 4 letras. */
const SUFIXOS = ["amentos", "amento", "imento", "acoes", "acao", "icoes", "icao", "idores", "idor", "arios", "ario",
  "ando", "endo", "indo", "ados", "adas", "ado", "ada", "oes", "ao", "ar", "er", "ir", "as", "es", "os", "s", "a", "o", "e"];
function raiz(p) {
  if (p.length < 5) return p;
  for (const s of SUFIXOS) if (p.endsWith(s) && p.length - s.length >= 4) return p.slice(0, -s.length);
  return p;
}

/** 1 = mesma palavra; 0,85 = mesma raiz; 0 = diferentes. */
function casa(a, b) {
  if (a === b) return 1;
  const ra = raiz(a);
  return ra.length >= 4 && ra === raiz(b) ? 0.85 : 0;
}

/* ---------- Índice das respostas prontas ---------- */

const INDICE = FAQ.map((item) => ({
  item,
  chaves: item.chaves.map((c) => palavras(c)).filter((c) => c.length),
  perguntas: IDIOMAS.map((l) => normalizar(item.pergunta[l])),
}));

// Peso de cada palavra: quanto mais itens a usam, menos ela diz sobre o assunto.
const FREQ = new Map();
for (const { chaves } of INDICE) {
  for (const p of new Set(chaves.flat())) FREQ.set(p, (FREQ.get(p) || 0) + 1);
}
const peso = (p) => Math.log(1 + INDICE.length / (FREQ.get(p) || 1));

function pontuar(consulta, entrada) {
  let total = 0;
  const usadas = new Set();
  for (const q of consulta) {
    let melhor = 0;
    for (const chave of entrada.chaves) {
      for (const p of chave) melhor = Math.max(melhor, casa(q, p) * peso(p));
    }
    if (melhor) { total += melhor; usadas.add(q); }
  }
  // Expressão inteira presente ("esqueci senha", "cartao de credito") vale mais.
  for (const chave of entrada.chaves) {
    if (chave.length > 1 && chave.every((p) => consulta.some((q) => casa(q, p)))) total += 0.6 * chave.length;
  }
  return { total, usadas };
}

const SOCIAIS = new Set(["saudacao", "obrigado"]);
const LIMIAR = 1.2;
const FORTE = 2.5;

/** Resposta pronta mais parecida (ou null) e as alternativas próximas. */
function melhorResposta(texto) {
  const norm = normalizar(texto);
  const exata = INDICE.find((e) => e.perguntas.includes(norm));
  if (exata) return { entrada: exata, usadas: new Set(palavras(texto)), alternativas: [] };

  const consulta = palavras(texto);
  if (!consulta.length) return null;
  const notas = INDICE.map((e) => ({ e, ...pontuar(consulta, e) }))
    // Uma palavra comum sozinha ("conta" em "me conta uma piada") não basta:
    // ou a maior parte da pergunta bate, ou a palavra é bem específica.
    .filter((n) => n.total >= LIMIAR && (n.usadas.size / consulta.length > 0.5 || n.total >= FORTE))
    .sort((a, b) => b.total - a.total);
  if (!notas.length) return null;
  // "Oi, como reservo?" responde a reserva, não o cumprimento.
  const assunto = notas.find((n) => !SOCIAIS.has(n.e.item.id));
  const escolhida = assunto || notas[0];
  const alternativas = notas
    .filter((n) => n !== escolhida && !SOCIAIS.has(n.e.item.id) && n.total >= escolhida.total * 0.75)
    .slice(0, 2)
    .map((n) => n.e.item.id);
  return { entrada: escolhida.e, usadas: escolhida.usadas, alternativas };
}

/* ---------- Catálogo público ---------- */

const PALAVRAS_CATEGORIA = {
  praia: ["praia", "praias", "beach", "beaches", "playa", "playas"],
  mergulho: ["mergulho", "mergulhar", "snorkel", "flutuacao", "batismo", "diving", "dive", "buceo", "bucear"],
  caiaque: ["caiaque", "caiaques", "remada", "kayak", "kayaking"],
  pesca: ["pesca", "pescar", "pescaria", "fishing", "tucunare"],
  expedicao: ["expedicao", "expedicoes", "trilha", "baleias", "expedition", "expedicion"],
  aquario: ["aquario", "aquarios", "aquarium", "acuario"],
};
const CATEGORIA_POR_PALAVRA = new Map();
for (const [cat, lista] of Object.entries(PALAVRAS_CATEGORIA)) {
  for (const p of lista) for (const w of palavras(p)) CATEGORIA_POR_PALAVRA.set(w, cat);
}
const INTENCAO = new Set(palavras(
  "experiencia experiencias passeio passeios viagem viagens destino destinos vaga vagas preco precos valor custa quanto " +
  "opcoes algo ir conhecer lugar lugares disponivel disponiveis data datas proxima proximas " +
  "experience experiences tour tours trip trips destination price cost available paseo paseos viaje viajes precio cupos"
));

async function buscarExperiencias({ termo, categoria } = {}) {
  const cond = [visivel("sv"), semExemplo("sv")];
  const params = [];
  const t = typeof termo === "string" ? termo.trim().slice(0, 60) : "";
  if (t) {
    cond.push("(sv.title LIKE ? OR sv.location LIKE ?)");
    params.push(`%${t}%`, `%${t}%`);
  }
  if (categoria && CATEGORIAS[categoria]) { cond.push("sv.category = ?"); params.push(categoria); }
  const { rows } = await db.query(
    `SELECT sv.slug, sv.title, sv.location, sv.category, sv.price_cents,
            (SELECT MIN(s.starts_at) FROM service_slots s WHERE s.service_id = sv.id AND s.starts_at > NOW()
               AND s.capacity > (SELECT COALESCE(SUM(b.quantity), 0) FROM bookings b WHERE b.slot_id = s.id
                 AND (b.status = 'CONFIRMED' OR (b.status = 'PENDING' AND b.expires_at > NOW())))) AS proxima_data
     FROM services sv WHERE ${cond.join(" AND ")}
     ORDER BY proxima_data IS NULL, proxima_data
     LIMIT 5`,
    params
  );
  return rows;
}

const INTL = { pt: "pt-BR", en: "en-US", es: "es-AR" };

function cartao(r, lang) {
  const tx = TEXTOS[lang];
  const fuso = process.env.OPERATION_TIMEZONE || "America/Sao_Paulo";
  return {
    titulo: r.title,
    local: r.location,
    preco: Number(r.price_cents) === 0 ? tx.gratuita
      : (Number(r.price_cents) / 100).toLocaleString(INTL[lang], { style: "currency", currency: "BRL" }),
    data: r.proxima_data
      ? new Date(r.proxima_data).toLocaleString(INTL[lang], { timeZone: fuso, dateStyle: "short", timeStyle: "short" })
      : tx.sem_data,
    link: `/reservar/${r.slug}`,
  };
}

/**
 * Procura experiências quando a pergunta fala delas. Devolve null se a
 * pergunta não é sobre o catálogo, ou a lista (talvez vazia).
 */
async function procurarNoCatalogo(texto, { usadasPelaFaq, faqAchou }) {
  const consulta = palavras(texto);
  let categoria = null;
  for (const p of consulta) if (CATEGORIA_POR_PALAVRA.has(p)) categoria = CATEGORIA_POR_PALAVRA.get(p);
  const intencao = consulta.some((p) => INTENCAO.has(p));
  // Palavras que sobram viram busca por local/título ("noronha", "santos").
  const termos = consulta.filter((p) => p.length >= 3 && !INTENCAO.has(p) && !CATEGORIA_POR_PALAVRA.has(p)
    && !(usadasPelaFaq && usadasPelaFaq.has(p))).slice(0, 3);

  if (!categoria && !intencao && (faqAchou || !termos.length)) return null;

  const achadas = new Map();
  const juntar = (rows) => rows.forEach((r) => { if (!achadas.has(r.slug)) achadas.set(r.slug, r); });
  for (const termo of termos) juntar(await buscarExperiencias({ termo, categoria }));
  if (!achadas.size && categoria && !termos.length) juntar(await buscarExperiencias({ categoria }));
  if (!achadas.size && !termos.length && intencao && !faqAchou) juntar(await buscarExperiencias({}));
  // Sem nada, e a pergunta nem parecia ser sobre experiências: não é catálogo.
  if (!achadas.size && !categoria && !intencao) return null;
  return [...achadas.values()].slice(0, 5);
}

/* ---------- Conversa ---------- */

function historico(req) {
  if (!Array.isArray(req.session.chat)) req.session.chat = [];
  return req.session.chat;
}

function limparConversa(req) {
  req.session.chat = [];
}

const CARTAO_OU_CPF = /\b(?:\d[ .-]?){13,19}\b|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;
const mascarar = (t) => t.replace(/\d/g, "•");

function sugestoesDe(ids, lang, exceto) {
  return [...new Set(ids)]
    .filter((id) => id !== exceto)
    .map((id) => FAQ.find((f) => f.id === id))
    .filter(Boolean)
    .slice(0, 3)
    .map((f) => f.pergunta[lang]);
}

/**
 * Responde uma pergunta com texto pronto (e experiências do catálogo,
 * quando for o caso). Sempre disponível: não depende de nada externo.
 */
async function responder({ req, mensagem }) {
  const lang = IDIOMAS.includes(req.lang) ? req.lang : "pt";
  const tx = TEXTOS[lang];
  const texto = String(mensagem || "").replace(/\s+/g, " ").trim();
  if (!texto) throw new ChatError(tx.vazia, "EMPTY", 422);
  if (texto.length > MAX_MENSAGEM) throw new ChatError(tx.longa, "TOO_LONG", 422);

  let saida;
  const sensivel = CARTAO_OU_CPF.test(texto);
  if (sensivel) {
    saida = { resposta: tx.dado_sensivel, sugestoes: sugestoesDe(POPULARES, lang), experiencias: [] };
  } else {
    const achado = melhorResposta(texto);
    const experiencias = await procurarNoCatalogo(texto, { usadasPelaFaq: achado && achado.usadas, faqAchou: !!achado });
    const partes = [];
    let sugestoes;
    if (achado) {
      const item = achado.entrada.item;
      // Pergunta genérica de catálogo com resultados: a lista já responde.
      if (!(experiencias && experiencias.length && item.id === "catalogo")) partes.push(item.resposta[lang]);
      sugestoes = sugestoesDe([...achado.alternativas, ...(item.relacionados || [])], lang, item.id);
    }
    if (experiencias) partes.push(experiencias.length ? tx.achei_exp : tx.sem_exp);
    if (!partes.length) {
      partes.push(tx.nao_entendi);
      sugestoes = sugestoesDe(POPULARES, lang);
    }
    saida = {
      resposta: partes.join("\n\n"),
      sugestoes: sugestoes || [],
      experiencias: (experiencias || []).map((r) => cartao(r, lang)),
    };
  }

  const anteriores = historico(req);
  anteriores.push(
    { role: "user", content: sensivel ? mascarar(texto) : texto },
    { role: "assistant", content: saida.resposta, experiencias: saida.experiencias }
  );
  req.session.chat = anteriores.slice(-MAX_HISTORICO);
  return saida;
}

/** A central de ajuda não depende de serviço externo: está sempre no ar. */
function disponivel() {
  return true;
}

module.exports = {
  ChatError, MAX_MENSAGEM,
  responder, limparConversa, disponivel, historico,
  buscarExperiencias, melhorResposta, normalizar,
};
