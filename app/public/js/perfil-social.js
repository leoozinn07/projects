/* ==============================================================
   AquaTrip — Perfil social: foto, bio e listas de seguidores
   ============================================================== */
(function () {
  "use strict";
  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const t = (k, v, p) => (window.AQ ? window.AQ.t(k, v, p) : p);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const status = (el, msg, tipo) => { if (!el) return; el.textContent = msg || ""; el.className = "form-status" + (tipo ? " is-" + tipo : ""); };

  /* Foto de perfil */
  const input = $("pfAvatarInput");
  if (input) {
    input.addEventListener("change", async () => {
      const f = input.files[0];
      input.value = "";
      if (!f) return;
      const st = $("pfAvatarStatus");
      if (f.size > 5 * 1024 * 1024) return status(st, t("pf_foto_grande", null, "A foto passa de 5 MB."), "error");
      status(st, t("pf_enviando", null, "Enviando foto..."));
      const fd = new FormData();
      fd.append("imagem", f);
      try {
        const res = await fetch("/api/perfil/avatar", { method: "POST", headers: { Accept: "application/json", "X-CSRF-Token": CSRF }, body: fd });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || t("erro_tentar", null, "Não foi possível enviar."));
        const atual = $("pfAvatar");
        const img = document.createElement("img");
        img.className = "pf-avatar";
        img.id = "pfAvatar";
        img.src = j.url;
        img.alt = "";
        atual.replaceWith(img);
        status(st, t("pf_foto_pendente", null, "Foto enviada. Ela aparece para outras pessoas depois da moderação."), "success");
      } catch (e) {
        status(st, e.message, "error");
      }
    });
  }

  /* Bio */
  const bioForm = $("pfBioForm");
  if (bioForm) {
    bioForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const botao = $("pfBioSalvar");
      window.AQForm.ocupado(botao, true);
      try {
        const res = await fetch("/api/perfil/bio", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": CSRF },
          body: JSON.stringify({ bio: $("pfBio").value }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || t("erro_tentar", null, "Não foi possível salvar."));
        status($("pfBioStatus"), t("salvo", null, "Salvo."), "success");
      } catch (err) {
        window.AQForm.erroCampo($("pfBio"), err.message);
      } finally {
        window.AQForm.ocupado(botao, false);
      }
    });
  }

  /* Listas de seguidores / seguindo */
  const dlg = $("pfLista");
  if (dlg) {
    $("pfListaFechar").addEventListener("click", () => dlg.close());
    document.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-lista]");
      if (!b) return;
      const tipo = b.dataset.lista;
      $("pfListaTitulo").textContent = tipo === "seguidores" ? t("pf_seguidores", null, "Seguidores") : t("pf_seguindo", null, "Seguindo");
      const ul = $("pfListaItens");
      ul.innerHTML = `<li class="field-help">${esc(t("pf_carregando", null, "Carregando..."))}</li>`;
      dlg.showModal();
      try {
        const res = await fetch(`/api/usuarios/${encodeURIComponent(b.dataset.user)}/${tipo}`, { headers: { Accept: "application/json" } });
        const j = await res.json();
        ul.innerHTML = (j.usuarios || []).length
          ? j.usuarios.map((u) => `<li><a href="/usuarios/${encodeURIComponent(u.id)}">${u.avatar ? `<img src="${esc(u.avatar)}" alt="" width="32" height="32">` : `<span class="sx-avatar">${esc(u.nome.charAt(0).toUpperCase())}</span>`}<span>${esc(u.nome)}</span></a></li>`).join("")
          : `<li class="field-help">${esc(t("pf_ninguem", null, "Ninguém por aqui ainda."))}</li>`;
      } catch {
        ul.innerHTML = `<li class="field-help">${esc(t("erro_tentar", null, "Não foi possível carregar."))}</li>`;
      }
    });
  }
})();
