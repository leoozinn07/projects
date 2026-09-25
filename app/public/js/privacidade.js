/* ==============================================================
   AquaTrip — Central de Privacidade
   Salva e revoga consentimento sem recarregar a página: revogar
   precisa ser tão simples quanto autorizar (LGPD, art. 8º, §5º).
   ============================================================== */
(function () {
  "use strict";

  const t = (k, v, padrao) => (window.AQ ? AQ.t(k, v, padrao) : padrao);
  const analytics = document.getElementById("pcAnalytics");
  const marketing = document.getElementById("pcMarketing");
  const salvar = document.getElementById("pcSalvar");
  const revogar = document.getElementById("pcRevogar");
  const feedback = document.getElementById("pcFeedback");

  if (!salvar || !revogar) return;

  function avisar(texto, erro) {
    feedback.textContent = texto;
    feedback.classList.toggle("is-error", Boolean(erro));
  }

  async function enviar(payload, botao, textoOk) {
    const original = botao.textContent;
    botao.disabled = true;
    botao.textContent = t("privacidade_salvando", null, "Salvando...");
    try {
      const res = await fetch("/api/consentimento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("falha");
      const dados = await res.json();
      if (analytics) analytics.checked = dados.analytics;
      if (marketing) marketing.checked = dados.marketing;
      avisar(textoOk, false);
    } catch (e) {
      avisar(t("privacidade_erro_salvar", null, "Não foi possível salvar agora. Tente novamente."), true);
    } finally {
      botao.disabled = false;
      botao.textContent = original;
    }
  }

  salvar.addEventListener("click", function () {
    enviar(
      {
        analytics: Boolean(analytics && analytics.checked),
        marketing: Boolean(marketing && marketing.checked),
        action: "custom",
      },
      salvar,
      t("privacidade_salvas", null, "Preferências salvas e registradas.")
    );
  });

  revogar.addEventListener("click", function () {
    enviar(
      { analytics: false, marketing: false, action: "withdrawn" },
      revogar,
      t("privacidade_revogadas", null, "Autorizações opcionais revogadas.")
    );
  });
})();
