/* ==============================================================
   AquaTrip — Estados comuns de formulário
   ==============================================================
   Carregado em todas as páginas (partials/header e admin). Não troca
   a validação de cada tela; só acrescenta o que todo formulário deve
   ter:
   - mostrar/ocultar senha em todo campo de senha;
   - contador de caracteres em campos com [data-counter] + maxlength;
   - erro visível depois que a pessoa sai do campo (não enquanto digita);
   - envio tradicional: botão com spinner e sem duplo envio.
   Formulários enviados por fetch chamam AQForm.ocupado() por conta própria.
   ============================================================== */
(function () {
  "use strict";
  const t = (k, v, padrao) => (window.AQ && window.AQ.t ? window.AQ.t(k, v, padrao) : padrao);

  const OLHO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const OLHO_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

  function senhaVisivel(input) {
    if (input.dataset.fkSenha || input.closest(".input-wrap")) return;
    input.dataset.fkSenha = "1";
    const wrap = document.createElement("span");
    wrap.className = "input-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "input-toggle";
    b.setAttribute("aria-pressed", "false");
    b.setAttribute("aria-label", t("form_mostrar_senha", null, "Mostrar senha"));
    b.innerHTML = OLHO;
    b.addEventListener("click", () => {
      const mostrar = input.type === "password";
      input.type = mostrar ? "text" : "password";
      b.setAttribute("aria-pressed", String(mostrar));
      b.setAttribute("aria-label", mostrar ? t("form_ocultar_senha", null, "Ocultar senha") : t("form_mostrar_senha", null, "Mostrar senha"));
      b.innerHTML = mostrar ? OLHO_OFF : OLHO;
    });
    wrap.appendChild(b);
  }

  function contador(campo) {
    if (campo.dataset.fkContador) return;
    const max = Number(campo.getAttribute("maxlength"));
    if (!max) return;
    campo.dataset.fkContador = "1";
    const el = document.createElement("span");
    el.className = "field-counter";
    el.setAttribute("aria-live", "polite");
    const atualizar = () => {
      const n = campo.value.length;
      el.textContent = `${n}/${max}`;
      el.classList.toggle("is-near", n >= max * 0.9 && n < max);
      el.classList.toggle("is-over", n >= max);
    };
    campo.addEventListener("input", atualizar);
    campo.insertAdjacentElement("afterend", el);
    atualizar();
  }

  function preparar(raiz) {
    (raiz || document).querySelectorAll('input[type="password"]:not([data-no-toggle])').forEach(senhaVisivel);
    (raiz || document).querySelectorAll("[data-counter][maxlength]").forEach(contador);
  }

  /* Erro só depois de sair do campo; some assim que fica válido. */
  document.addEventListener("focusout", (e) => {
    const c = e.target;
    if (!(c instanceof HTMLInputElement || c instanceof HTMLTextAreaElement || c instanceof HTMLSelectElement)) return;
    if (c.type === "checkbox" || c.type === "radio" || c.closest("[data-fk-off]")) return;
    if (!c.value) return;
    const ok = c.checkValidity();
    c.classList.toggle("is-invalid", !ok);
    if (!ok) c.setAttribute("aria-invalid", "true");
  });
  document.addEventListener("input", (e) => {
    const c = e.target;
    if (!c.classList || !c.classList.contains("is-invalid") || c.closest("[data-fk-off]")) return;
    if (c.checkValidity()) {
      c.classList.remove("is-invalid");
      c.removeAttribute("aria-invalid");
      c.classList.add("is-valid");
    }
  });

  /* Envio tradicional (sem fetch): spinner e trava de duplo clique. */
  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (e.defaultPrevented || form.dataset.fkBusy === "off") return;
    const botao = e.submitter || form.querySelector('button[type="submit"], button:not([type])');
    if (!botao) return;
    ocupado(botao, true);
    // Se a navegação não acontecer (ex.: download), libera depois de um tempo.
    setTimeout(() => ocupado(botao, false), 8000);
  });

  function ocupado(botao, sim) {
    if (!botao) return;
    if (sim) {
      botao.setAttribute("aria-busy", "true");
      botao.dataset.fkDisabled = botao.disabled ? "1" : "";
    } else {
      botao.removeAttribute("aria-busy");
    }
  }

  /** Marca erro num campo (usado pelas telas que enviam por fetch). */
  function erroCampo(campo, mensagem) {
    if (!campo) return;
    campo.classList.add("is-invalid");
    campo.setAttribute("aria-invalid", "true");
    const id = campo.getAttribute("aria-describedby");
    const alvo = id && id.split(" ").map((x) => document.getElementById(x)).find((el) => el && el.classList.contains("field-error"));
    if (alvo) alvo.textContent = mensagem || "";
  }

  function limparErros(form) {
    form.querySelectorAll(".is-invalid").forEach((c) => { c.classList.remove("is-invalid"); c.removeAttribute("aria-invalid"); });
    form.querySelectorAll(".field-error").forEach((el) => { el.textContent = ""; });
  }

  window.AQForm = { ocupado, erroCampo, limparErros, preparar };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => preparar());
  else preparar();
})();
