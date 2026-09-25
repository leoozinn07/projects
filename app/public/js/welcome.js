/* ==============================================================
   AquaTrip · Boas-vindas depois do login
   A animação é toda CSS (funciona até sem JS). Aqui: tirar o
   elemento da página quando termina, travar o scroll enquanto
   dura e deixar pular com clique, Esc ou Enter.
   ============================================================== */
(function () {
  "use strict";
  var el = document.getElementById("welcome");
  if (!el) return;
  var root = document.documentElement;
  root.classList.add("welcome-on");
  try { sessionStorage.setItem("aquatrip_intro", "1"); } catch (e) {}

  function fim() {
    root.classList.remove("welcome-on");
    if (el.parentNode) el.parentNode.removeChild(el);
    document.removeEventListener("keydown", tecla);
  }
  function pular() { el.classList.add("is-skipping"); window.setTimeout(fim, 450); }
  function tecla(e) { if (e.key === "Escape" || e.key === "Enter") pular(); }

  el.addEventListener("animationend", function (e) { if (e.target === el && e.animationName === "welcome-done") fim(); });
  el.addEventListener("click", pular);
  document.addEventListener("keydown", tecla);
  // Rede de segurança: nunca prende a pessoa na tela
  window.setTimeout(fim, 6000);
})();
