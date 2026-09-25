/* ==============================================================
   AquaTrip · Portão da abertura
   Carregado de forma BLOQUEANTE no <head> da home (a CSP proíbe
   script inline). Decide antes da primeira pintura se a abertura
   com o logo aparece: só na primeira visita da sessão e nunca com
   "reduzir movimento". Assim a foto da home não pisca antes dela.
   ============================================================== */
(function () {
  "use strict";
  try {
    var reduz = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var viu = sessionStorage.getItem("aquatrip_intro") === "1";
    if (!reduz && !viu) document.documentElement.classList.add("intro-on");
  } catch (e) { /* sem sessionStorage: segue sem abertura */ }
})();
