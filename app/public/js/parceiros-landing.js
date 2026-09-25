/* AquaTrip · calculadora da landing de parceiros: quanto fica com o parceiro. */
(function () {
  "use strict";
  var box = document.querySelector(".calc");
  var input = document.getElementById("calcIn");
  if (!box || !input) return;
  var pct = Number(box.dataset.comissao) || 0;
  var brl = function (v, c) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: c ? 2 : 0, maximumFractionDigits: c ? 2 : 0 });
  };
  function atualizar() {
    var v = Number(input.value), taxa = v * pct / 100;
    document.getElementById("calcPrice").textContent = brl(v);
    document.getElementById("calcYou").textContent = brl(v - taxa, true);
    document.getElementById("calcFee").textContent = brl(taxa, true);
  }
  input.addEventListener("input", atualizar);
  atualizar();
})();
