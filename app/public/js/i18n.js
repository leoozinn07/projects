/* ==============================================================
   AquaTrip · Textos do navegador
   O servidor imprime o dicionário do idioma atual num
   <script type="application/json" id="i18n-data"> (não executa,
   então a CSP continua sem 'unsafe-inline'). Aqui só lemos e
   expomos AQ.t(chave, vars), AQ.lang e AQ.intl.
   ============================================================== */
(function () {
  "use strict";
  var dados = { lang: "pt", intl: "pt-BR", dic: {} };
  try {
    var el = document.getElementById("i18n-data");
    if (el) dados = JSON.parse(el.textContent);
  } catch (e) { /* segue com português */ }

  function t(chave, vars, padrao) {
    var v = dados.dic[chave];
    if (v === undefined) v = padrao !== undefined ? padrao : chave;
    if (vars) v = String(v).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? vars[k] : m; });
    return v;
  }
  function brl(reais, centavos) {
    return Number(reais).toLocaleString(dados.intl, {
      style: "currency", currency: "BRL",
      minimumFractionDigits: centavos ? 2 : 0, maximumFractionDigits: centavos ? 2 : 0
    });
  }
  window.AQ = { t: t, lang: dados.lang, intl: dados.intl, brl: brl };
})();
