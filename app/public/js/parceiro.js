/* AquaTrip — candidatura de parceiro */
(function () {
  "use strict";
  const form = document.getElementById("form-parceiro");
  if (!form) return;
  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const erro = document.getElementById("erro");

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    const v = (id) => document.getElementById(id).value;
    const corpo = {
      documento: v("documento"), nomeLegal: v("nomeLegal"), nomeExibicao: v("nomeExibicao"),
      telefone: v("telefone"), cidade: v("cidade"), uf: v("uf"), descricao: v("descricao"),
      aceite: document.getElementById("aceite").checked,
    };
    const botao = form.querySelector('[type="submit"]');
    botao.disabled = true;
    try {
      const r = await fetch("/api/parceiro/candidatura", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": CSRF },
        body: JSON.stringify(corpo),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        erro.textContent = d.error || "Não foi possível enviar.";
        erro.hidden = false;
        const campo = d.campo && document.getElementById(d.campo);
        if (campo) { campo.setAttribute("aria-invalid", "true"); campo.focus(); }
        return;
      }
      window.location.reload(); // mostra a tela "em análise"
    } catch (e) {
      erro.textContent = "Sem conexão. Tente de novo.";
      erro.hidden = false;
    } finally {
      botao.disabled = false;
    }
  });
})();
