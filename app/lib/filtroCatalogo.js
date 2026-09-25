/* ==============================================================
   AquaTrip · Filtros do catálogo (/reservar e categorias)
   ==============================================================
   Os filtros moram na URL (?q=&vagas=1&max=&ordem=): o link pode
   ser compartilhado, o botão voltar funciona e tudo vale sem JS.
   O servidor desenha TODAS as experiências e marca com `hidden`
   as que não passam; o catalogo.js refaz o mesmo cálculo ao vivo,
   então limpar um filtro não precisa de nova requisição.
   ============================================================== */
const { rotulo } = require("./categorias");

const ORDENS = ["proximas", "preco", "preco_desc", "nome"];

function normalizar(t) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Lê e limpa os parâmetros; qualquer valor estranho vira "sem filtro". */
function ler(query = {}) {
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
  const max = Number.parseInt(query.max, 10);
  const ordem = ORDENS.includes(query.ordem) ? query.ordem : "proximas";
  return {
    q,
    vagas: query.vagas === "1",
    max: Number.isFinite(max) && max > 0 ? max : null,
    ordem,
  };
}

/** Texto em que a busca procura: título, lugar, descrição, categoria e organizador. */
function textoDeBusca(e) {
  return normalizar([e.title, e.location, e.description, rotulo(e.category), e.category, e.operador].filter(Boolean).join(" "));
}

function passa(e, f) {
  if (f.vagas && !e.proxima_data) return false;
  if (f.max !== null && Math.round(e.price_cents / 100) > f.max) return false;
  if (f.q) {
    const alvo = textoDeBusca(e);
    // Todas as palavras precisam aparecer (em qualquer ordem)
    if (!normalizar(f.q).split(/\s+/).every((p) => alvo.includes(p))) return false;
  }
  return true;
}

function ordenar(lista, ordem) {
  const proxima = (e) => (e.proxima_data ? new Date(e.proxima_data).getTime() : Infinity);
  const copia = lista.slice();
  if (ordem === "preco") copia.sort((a, b) => a.price_cents - b.price_cents);
  else if (ordem === "preco_desc") copia.sort((a, b) => b.price_cents - a.price_cents);
  else if (ordem === "nome") copia.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
  else copia.sort((a, b) => proxima(a) - proxima(b) || a.title.localeCompare(b.title, "pt-BR"));
  return copia;
}

/** Devolve a lista ordenada, cada item com `visivel` e `busca`, e quantos passam. */
function aplicar(lista, f) {
  const itens = ordenar(lista, f.ordem).map((e) => ({ ...e, visivel: passa(e, f), busca: textoDeBusca(e) }));
  return { itens, visiveis: itens.filter((e) => e.visivel).length };
}

/** Query string só com o que difere do padrão (para links de categoria). */
function queryString(f, sem = []) {
  const p = new URLSearchParams();
  if (f.q && !sem.includes("q")) p.set("q", f.q);
  if (f.vagas && !sem.includes("vagas")) p.set("vagas", "1");
  if (f.max && !sem.includes("max")) p.set("max", String(f.max));
  if (f.ordem !== "proximas" && !sem.includes("ordem")) p.set("ordem", f.ordem);
  const s = p.toString();
  return s ? "?" + s : "";
}

module.exports = { ORDENS, ler, aplicar, queryString, normalizar, textoDeBusca, passa };
