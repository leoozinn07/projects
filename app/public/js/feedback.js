/* ==============================================================
   AquaTrip — Reclamações, sugestões e avaliação do AquaTrip
   ============================================================== */
(function () {
  "use strict";
  const form = document.getElementById("fbForm");
  if (!form) return;
  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const t = (k, v, p) => (window.AQ ? window.AQ.t(k, v, p) : p);
  const $ = (id) => document.getElementById(id);
  const tipo = () => form.querySelector('input[name="kind"]:checked').value;

  function atualizarNota() {
    const avaliar = tipo() === "RATING";
    $("fbNota").hidden = !avaliar;
  }
  form.addEventListener("change", (e) => { if (e.target.name === "kind") atualizarNota(); });
  atualizarNota();

  const CAMPOS = { subject: "fbAssunto", message: "fbMsg" };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    window.AQForm.limparErros(form);
    const st = $("fbStatus");
    st.textContent = "";
    const nota = form.querySelector('input[name="rating"]:checked');
    const corpo = {
      kind: tipo(),
      rating: nota ? Number(nota.value) : null,
      subject: $("fbAssunto").value.trim(),
      message: $("fbMsg").value.trim(),
    };
    let ok = true;
    if (corpo.kind === "RATING" && !corpo.rating) { $("fbNotaErr").textContent = t("fb_nota", null, "Escolha uma nota de 1 a 5."); ok = false; }
    if (corpo.subject.length < 4) { window.AQForm.erroCampo($("fbAssunto"), t("fb_assunto", null, "O assunto precisa ter pelo menos 4 caracteres.")); ok = false; }
    if (corpo.message.length < 10) { window.AQForm.erroCampo($("fbMsg"), t("fb_mensagem", null, "Conte com um pouco mais de detalhe (mínimo 10 caracteres).")); ok = false; }
    if (!ok) return;

    const botao = $("fbEnviar");
    window.AQForm.ocupado(botao, true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": CSRF },
        body: JSON.stringify(corpo),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const campo = j.campo && CAMPOS[j.campo];
        if (campo) window.AQForm.erroCampo($(campo), j.error);
        else if (j.campo === "rating") $("fbNotaErr").textContent = j.error;
        else { st.textContent = j.error || t("erro_tentar", null, "Não foi possível enviar."); st.className = "form-status is-error"; }
        return;
      }
      location.href = "/feedback?enviado=1";
    } catch {
      st.textContent = t("contato_erro_conexao", null, "Erro de conexão. Tente novamente.");
      st.className = "form-status is-error";
    } finally {
      window.AQForm.ocupado(botao, false);
    }
  });
})();
