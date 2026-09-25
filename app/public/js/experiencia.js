/* ==============================================================
   AquaTrip · Página da experiência
   Botões + e - da quantidade, limite pelo horário escolhido e
   total ao vivo. Sem JS, o campo numérico funciona sozinho.
   ============================================================== */
(function () {
  "use strict";
  var form = document.getElementById("bookForm");
  if (!form) return;
  var qtd = document.getElementById("quantity");
  var total = document.getElementById("bookTotal");
  var preco = Number(form.dataset.price) || 0;
  var brl = function (c) { return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); };

  function limite() {
    var r = form.querySelector('input[name="slotId"]:checked');
    return Math.min(20, r ? Number(r.dataset.left) || 20 : 20);
  }
  function atualizar() {
    var max = limite();
    qtd.max = max;
    var n = Math.max(1, Math.min(max, parseInt(qtd.value, 10) || 1));
    if (String(n) !== qtd.value) qtd.value = n;
    total.textContent = brl(preco * n);
  }
  form.addEventListener("click", function (e) {
    var b = e.target.closest("[data-q]");
    if (!b) return;
    qtd.value = (parseInt(qtd.value, 10) || 1) + Number(b.dataset.q);
    atualizar();
  });
  form.addEventListener("change", atualizar);
  qtd.addEventListener("input", function () { if (qtd.value !== "") atualizar(); });
  atualizar();
})();
