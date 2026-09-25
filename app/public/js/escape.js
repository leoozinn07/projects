/* ==============================================================
   AquaTrip — Escape de HTML no cliente
   ==============================================================
   Todo dado vindo do servidor que entra em innerHTML passa por aqui.
   Títulos e locais de experiência são cadastrados por admin: se um
   dia alguém digitar <img src=x onerror=...>, isso vira texto, não
   código. A CSP já bloquearia a execução — mas segurança não pode
   depender de uma camada só.
   ============================================================== */
(function () {
  "use strict";
  var MAPA = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
  window.escHTML = function (valor) {
    if (valor === null || valor === undefined) return "";
    return String(valor).replace(/[&<>"'`]/g, function (c) { return MAPA[c]; });
  };
})();
