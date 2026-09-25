/* ==============================================================
   AquaTrip · Tema claro/escuro
   ==============================================================
   Carregado de forma BLOQUEANTE no <head> (sem defer): a CSP
   proíbe script inline, e um arquivo pequeno e síncrono aplica o
   data-theme antes da primeira pintura, sem piscar.

   Três escolhas: "system" (sem atributo, segue o aparelho),
   "light" e "dark". Controles:
   - [data-theme-toggle]  botão que alterna claro/escuro
   - [data-theme-set]     botões de escolha (menu e Configurações)
   ============================================================== */
(function () {
  "use strict";

  var CHAVE = "aquatrip_theme";

  function salvo() {
    try { return localStorage.getItem(CHAVE); } catch (e) { return null; }
  }
  function guardar(v) {
    try {
      if (v === "light" || v === "dark") localStorage.setItem(CHAVE, v);
      else localStorage.removeItem(CHAVE);
    } catch (e) {}
  }
  function aplicar(tema) {
    if (tema === "dark" || tema === "light") document.documentElement.setAttribute("data-theme", tema);
    else document.documentElement.removeAttribute("data-theme");
  }

  // 1) Antes da pintura
  aplicar(salvo());

  // 2) Depois do DOM: liga os controles
  document.addEventListener("DOMContentLoaded", function () {
    var t = (window.AQ && window.AQ.t) || function (k, v, p) { return p; };
    var alternadores = document.querySelectorAll("[data-theme-toggle]");
    var escolhas = document.querySelectorAll("[data-theme-set]");

    function temaAtual() {
      var explicito = document.documentElement.getAttribute("data-theme");
      if (explicito) return explicito;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    function sincronizar() {
      var atual = temaAtual();
      var escolha = salvo() || "system";
      alternadores.forEach(function (b) {
        b.setAttribute("aria-pressed", String(atual === "dark"));
        b.setAttribute("aria-label", atual === "dark"
          ? t("tema_para_claro", null, "Mudar para tema claro")
          : t("tema_para_escuro", null, "Mudar para tema escuro"));
        var sol = b.querySelector("[data-icon-light]");
        var lua = b.querySelector("[data-icon-dark]");
        if (sol) sol.hidden = atual === "dark";
        if (lua) lua.hidden = atual !== "dark";
      });
      escolhas.forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-set") === escolha));
      });
    }

    alternadores.forEach(function (b) {
      b.addEventListener("click", function () {
        var novo = temaAtual() === "dark" ? "light" : "dark";
        aplicar(novo); guardar(novo); sincronizar();
      });
    });
    escolhas.forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-theme-set");
        aplicar(v === "system" ? null : v); guardar(v); sincronizar();
      });
    });

    sincronizar();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
      if (!salvo()) sincronizar();
    });
  });
})();
