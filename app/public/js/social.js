/* ==============================================================
   AquaTrip — Interações sociais (qualquer página)
   ==============================================================
   Botões marcados por atributo:
     [data-curtir=id]     curtir/descurtir experiência
     [data-interesse=id]  tenho interesse
     [data-seguir=id]     seguir/deixar de seguir pessoa
     [data-login]         visitante: leva ao login e volta
   Atualização otimista: a tela muda na hora e volta atrás se o
   servidor recusar. O número exibido é sempre o que o servidor devolve.
   ============================================================== */
(function () {
  "use strict";
  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const t = (k, v, p) => (window.AQ ? window.AQ.t(k, v, p) : p);
  const $ = (id) => document.getElementById(id);
  const aviso = (m) => (window.aquatripToast ? window.aquatripToast(m) : null);

  async function api(metodo, url, corpo) {
    const res = await fetch(url, {
      method: metodo,
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": CSRF },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (res.status === 401) { irParaLogin(); throw new Error("login"); }
    const j = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || t("erro_tentar", null, "Não foi possível concluir."));
    return j;
  }
  function irParaLogin() {
    location.href = "/login?redirect=" + encodeURIComponent(location.pathname + location.search + location.hash);
  }

  function alternar(botao, ligado, contagem) {
    botao.classList.toggle("is-on", ligado);
    botao.setAttribute("aria-pressed", String(ligado));
    const n = botao.querySelector("[data-contagem]");
    if (n && contagem != null) n.textContent = contagem;
  }

  document.addEventListener("click", async (e) => {
    const alvo = e.target.closest("[data-curtir], [data-interesse], [data-seguir]");
    if (!alvo) return;
    e.preventDefault();
    if (alvo.hasAttribute("data-login")) return irParaLogin();
    if (alvo.dataset.ocupado) return;
    alvo.dataset.ocupado = "1";
    const ligado = alvo.getAttribute("aria-pressed") !== "true";
    const n = alvo.querySelector("[data-contagem]");
    const antes = n ? Number(n.textContent) : null;
    try {
      if (alvo.dataset.curtir) {
        alternar(alvo, ligado, antes != null ? antes + (ligado ? 1 : -1) : null);
        const r = await api("POST", `/api/experiencias/${encodeURIComponent(alvo.dataset.curtir)}/curtir`, { curtir: ligado });
        alternar(alvo, r.curtiu, r.curtidas);
      } else if (alvo.dataset.interesse) {
        alternar(alvo, ligado, antes != null ? antes + (ligado ? 1 : -1) : null);
        const r = await api("POST", `/api/experiencias/${encodeURIComponent(alvo.dataset.interesse)}/interesse`, { quer: ligado });
        alternar(alvo, r.interesse, r.interessados);
        if (r.interesse) aviso(t("sx_interesse_ok", null, "Interesse registrado. Quem organiza vai ver."));
      } else if (alvo.dataset.seguir) {
        const r = await api("POST", `/api/usuarios/${encodeURIComponent(alvo.dataset.seguir)}/seguir`, { seguir: ligado });
        alvo.setAttribute("aria-pressed", String(r.segue));
        alvo.classList.toggle("btn-primary", !r.segue);
        alvo.classList.toggle("btn-ghost", r.segue);
        alvo.textContent = r.segue ? t("sx_seguindo", null, "Seguindo") : t("sx_seguir", null, "Seguir");
        document.querySelectorAll("[data-seguidores]").forEach((el) => {
          el.textContent = r.seguidores === 1 ? t("sx_seguidor_um", null, "1 seguidor") : t("sx_seguidores_n", { n: r.seguidores }, `${r.seguidores} seguidores`);
        });
        document.querySelectorAll("[data-seguidores-num]").forEach((el) => { el.textContent = r.seguidores; });
      }
    } catch (err) {
      if (err.message !== "login") {
        alternar(alvo, !ligado, antes);
        aviso(err.message);
      }
    } finally {
      delete alvo.dataset.ocupado;
    }
  });

  /* ---------- Comentários ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lista = $("sxLista");
  const form = $("sxComentar");
  function contarComentarios(delta) {
    const n = $("sxNComentarios");
    if (n) n.textContent = Math.max(0, Number(n.textContent) + delta);
    const vazio = $("sxVazio");
    if (vazio && lista) vazio.hidden = lista.children.length > 0;
  }
  function itemComentario(c) {
    const li = document.createElement("li");
    li.className = "sx-comment is-new";
    li.dataset.id = c.id;
    const perfil = "/usuarios/" + encodeURIComponent(c.autor.id);
    const avatar = c.autor.avatar
      ? `<img src="${esc(c.autor.avatar)}" alt="" width="36" height="36">`
      : `<span class="sx-avatar">${esc(c.autor.nome.charAt(0).toUpperCase())}</span>`;
    const quando = new Date(c.criado_em).toLocaleString(window.AQ ? window.AQ.intl : "pt-BR", { dateStyle: "short", timeStyle: "short" });
    li.innerHTML =
      `<a class="sx-c-avatar" href="${perfil}" aria-hidden="true" tabindex="-1">${avatar}</a>` +
      `<div><p class="sx-c-head"><a href="${perfil}"><strong>${esc(c.autor.nome)}</strong></a> <time>${esc(quando)}</time></p>` +
      `<p class="sx-pre">${esc(c.texto)}</p>` +
      (c.pode_apagar ? `<button type="button" class="sx-c-del" data-apagar="${esc(c.id)}">${esc(t("sx_apagar", null, "Apagar"))}</button>` : "") +
      `</div>`;
    return li;
  }
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const campo = $("sxTexto");
      const texto = campo.value.trim();
      window.AQForm.limparErros(form);
      if (texto.length < 2) return window.AQForm.erroCampo(campo, t("sx_coment_curto", null, "Escreva pelo menos 2 caracteres."));
      const botao = $("sxEnviar");
      window.AQForm.ocupado(botao, true);
      try {
        const r = await api("POST", `/api/experiencias/${encodeURIComponent(form.dataset.servico)}/comentarios`, { texto });
        lista.prepend(itemComentario(r.comentario));
        campo.value = "";
        campo.dispatchEvent(new Event("input"));
        contarComentarios(1);
      } catch (err) {
        if (err.message !== "login") window.AQForm.erroCampo(campo, err.message);
      } finally {
        window.AQForm.ocupado(botao, false);
      }
    });
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-apagar]");
    if (!b) return;
    if (!confirm(t("sx_confirma_apagar", null, "Apagar este comentário?"))) return;
    try {
      await api("DELETE", `/api/comentarios/${encodeURIComponent(b.dataset.apagar)}`);
      b.closest("li").remove();
      contarComentarios(-1);
    } catch (err) { if (err.message !== "login") aviso(err.message); }
  });

  /* ---------- Denúncia ---------- */
  const abrirDen = $("sxDenunciar");
  const dlg = $("sxDenuncia");
  if (abrirDen) {
    abrirDen.addEventListener("click", () => {
      if (abrirDen.hasAttribute("data-login")) return irParaLogin();
      if (dlg) dlg.showModal();
    });
  }
  if (dlg) {
    $("sxDenCancelar").addEventListener("click", () => dlg.close());
    $("sxDenForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const botao = $("sxDenEnviar");
      window.AQForm.ocupado(botao, true);
      try {
        await api("POST", `/api/experiencias/${encodeURIComponent(e.target.dataset.servico)}/denunciar`, {
          motivo: $("sxMotivo").value, detalhes: $("sxDetalhes").value.trim() || undefined,
        });
        dlg.close();
        abrirDen.disabled = true;
        abrirDen.querySelector("span").textContent = t("sx_denunciado", null, "Denúncia enviada");
        aviso(t("sx_denuncia_ok", null, "Denúncia enviada. A moderação vai analisar."));
      } catch (err) {
        const st = $("sxDenStatus");
        st.textContent = err.message;
        st.className = "form-status is-error";
      } finally {
        window.AQForm.ocupado(botao, false);
      }
    });
  }
})();
