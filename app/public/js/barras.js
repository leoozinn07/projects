/* Aplica a largura das barras a partir de data-pct (sem style inline no HTML). */
document.querySelectorAll("[data-pct]").forEach(function (b) {
  var p = Math.max(0, Math.min(100, Number(b.dataset.pct) || 0));
  b.style.width = p + "%";
});
