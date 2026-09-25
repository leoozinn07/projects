/* ==============================================================
   AquaTrip — Fotos da avaliação (Minhas reservas)
   Mostra o status de cada foto (em revisão / publicada / recusada
   com o motivo) e permite enviar outra enquanto houver vaga.
   ============================================================== */
(function () {
  "use strict";
  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const esc = window.escHTML;
  const ROTULO = { PENDING: "Em revisão", APPROVED: "Publicada", REJECTED: "Não publicada" };

  async function abrir(botao) {
    const id = botao.dataset.fotos;
    let painel = document.getElementById("fotos-" + id);
    if (painel) { painel.remove(); botao.setAttribute("aria-expanded", "false"); return; }
    painel = document.createElement("div");
    painel.className = "fotos-painel";
    painel.id = "fotos-" + id;
    painel.textContent = "Carregando...";
    botao.closest(".booking-actions").after(painel);
    botao.setAttribute("aria-expanded", "true");
    await render(painel, id);
  }

  async function render(painel, id) {
    const r = await fetch(`/api/avaliacoes/${encodeURIComponent(id)}/fotos`, { headers: { Accept: "application/json" } });
    const { fotos = [] } = await r.json().catch(() => ({}));
    const ativas = fotos.filter((f) => f.status !== "REJECTED").length;
    painel.innerHTML =
      (fotos.length
        ? "<ul>" + fotos.map((f) => `<li>
            ${f.url ? `<img src="${esc(f.url)}" alt="">` : ""}
            <strong class="foto-st-${esc(f.status)}">${esc(ROTULO[f.status] || f.status)}</strong>
            ${f.motivo ? `<span>${esc(f.motivo)}</span>` : ""}
          </li>`).join("") + "</ul>"
        : "<p>Nenhuma foto nesta avaliação.</p>") +
      (ativas < 3
        ? `<label>Enviar foto (${3 - ativas} vaga${3 - ativas === 1 ? "" : "s"})
             <input type="file" accept="image/jpeg,image/png,image/webp" data-enviar="${esc(id)}">
           </label>
           <p class="booking-sub">Passa por revisão antes de aparecer. Sem rosto de outras pessoas, documentos ou placas.</p>`
        : "<p>Limite de 3 fotos atingido.</p>") +
      '<p class="fotos-msg" role="status" aria-live="polite"></p>';
  }

  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-fotos]");
    if (b) abrir(b);
  });

  document.addEventListener("change", async (ev) => {
    const input = ev.target.closest("[data-enviar]");
    if (!input || !input.files[0]) return;
    const painel = input.closest(".fotos-painel");
    const msg = painel.querySelector(".fotos-msg");
    const form = new FormData();
    form.append("imagem", input.files[0]);
    input.disabled = true;
    msg.textContent = "Enviando...";
    const r = await fetch(`/api/avaliacoes/${encodeURIComponent(input.dataset.enviar)}/fotos`, {
      method: "POST", headers: { "X-CSRF-Token": CSRF, Accept: "application/json" }, body: form,
    }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (r && r.ok) { await render(painel, input.dataset.enviar); painel.querySelector(".fotos-msg").textContent = d.mensagem; }
    else { msg.textContent = d.error || "Não foi possível enviar."; input.disabled = false; }
  });
})();
