/* ==============================================================
   AquaTrip · Filtros do catálogo, ao vivo
   Mesmas regras de app/lib/filtroCatalogo.js: texto (todas as
   palavras, sem acento), só com vagas, preço máximo e ordenação.
   A URL acompanha cada mudança (replaceState), então o link
   copiado abre a mesma lista filtrada.
   ============================================================== */
(function () {
  "use strict";
  const form = document.getElementById("catalogFilters");
  const grid = document.getElementById("cards-grid");
  if (!form || !grid) return; // estado vazio: nada para filtrar

  const cards = Array.from(grid.querySelectorAll(".card-item"));
  const campoQ = document.getElementById("catQ");
  const ordem = document.getElementById("catOrdem");
  const preco = document.getElementById("price-range");
  const saida = document.querySelector(".price-output");
  const soVagas = document.getElementById("only-available");
  const semResultado = document.getElementById("no-results");
  const contadores = document.querySelectorAll("[data-results-count]");
  const badge = document.getElementById("filterCountBadge");
  const chips = document.querySelectorAll(".chips a[data-base]");
  const max = preco ? Number(preco.max) : Infinity;
  const intl = (window.AQ && window.AQ.intl) || "pt-BR";

  document.documentElement.classList.add("js-filtros");

  const normalizar = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  function estado() {
    return {
      q: campoQ ? campoQ.value.trim() : "",
      vagas: Boolean(soVagas && soVagas.checked),
      max: preco && Number(preco.value) < max ? Number(preco.value) : null,
      ordem: ordem ? ordem.value : "proximas",
    };
  }

  function queryString(f, semMax) {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.vagas) p.set("vagas", "1");
    if (f.max !== null && !semMax) p.set("max", String(f.max));
    if (f.ordem !== "proximas") p.set("ordem", f.ordem);
    const s = p.toString();
    return s ? "?" + s : "";
  }

  function ordenar(o) {
    const proxima = (c) => (c.dataset.next ? Number(c.dataset.next) : Infinity);
    const titulo = (c) => c.dataset.title || "";
    const ordenados = cards.slice().sort((a, b) => {
      if (o === "preco") return Number(a.dataset.price) - Number(b.dataset.price);
      if (o === "preco_desc") return Number(b.dataset.price) - Number(a.dataset.price);
      if (o === "nome") return titulo(a).localeCompare(titulo(b), intl);
      return proxima(a) - proxima(b) || titulo(a).localeCompare(titulo(b), intl);
    });
    ordenados.forEach((c) => grid.appendChild(c));
  }

  function aplicar() {
    const f = estado();
    const palavras = normalizar(f.q).split(/\s+/).filter(Boolean);
    let visiveis = 0;

    cards.forEach((c) => {
      const ok = (!f.vagas || c.dataset.available === "1")
        && (f.max === null || Number(c.dataset.price) <= f.max)
        && palavras.every((p) => (c.dataset.search || "").includes(p));
      c.hidden = !ok;
      if (ok) visiveis++;
    });
    ordenar(f.ordem);

    contadores.forEach((el) => { el.textContent = visiveis; });
    if (semResultado) semResultado.hidden = visiveis !== 0;
    if (saida && preco) {
      saida.textContent = (window.AQ ? AQ.t("ate", { v: Number(preco.value).toLocaleString(intl) }, "Até R$ {v}") : "Até R$ " + Number(preco.value).toLocaleString(intl));
    }
    const ativos = (f.max !== null ? 1 : 0) + (f.vagas ? 1 : 0);
    if (badge) { badge.textContent = ativos; badge.hidden = ativos === 0; }

    // URL e links de categoria carregam a busca junto
    history.replaceState(null, "", location.pathname + queryString(f));
    chips.forEach((a) => { a.href = a.dataset.base + queryString(f, true); });
  }

  function limpar() {
    if (preco) preco.value = preco.max;
    if (soVagas) soVagas.checked = false;
    if (campoQ) campoQ.value = "";
    if (ordem) ordem.value = "proximas";
    aplicar();
  }

  let espera;
  campoQ && campoQ.addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(aplicar, 120); });
  [ordem, preco, soVagas].forEach((el) => el && el.addEventListener(el === preco ? "input" : "change", aplicar));
  // Com JS, enviar o formulário (Enter, "Ver N") só aplica, sem recarregar
  form.addEventListener("submit", (e) => { e.preventDefault(); aplicar(); });
  document.getElementById("clear-filters-btn")?.addEventListener("click", limpar);
  document.querySelector("[data-clear-filters]")?.addEventListener("click", limpar);
})();
