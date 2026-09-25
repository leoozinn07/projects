/* ==============================================================
   AquaTrip — Editar conta
   Três formulários independentes (nome, e-mail, senha), cada um
   com sua chamada. Antes: um "salvar" simulado com setTimeout e
   uma lista fixa de usernames "em uso" — nada era gravado.
   ============================================================== */
(function () {
  "use strict";
  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const $ = (id) => document.getElementById(id);
  const t = (k, v, padrao) => (window.AQ ? AQ.t(k, v, padrao) : padrao);

  function toast(msg, tipo) {
    const t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.className = "toast show " + (tipo || "success");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = "toast"; }, 4500);
  }

  function limparErros(form) {
    form.querySelectorAll(".field-error").forEach((e) => { e.textContent = ""; });
    form.querySelectorAll("[aria-invalid]").forEach((e) => e.removeAttribute("aria-invalid"));
  }

  function erroNoCampo(campo, msg) {
    const el = $("err_" + campo);
    const input = $(campo);
    if (el) el.textContent = msg;
    if (input) { input.setAttribute("aria-invalid", "true"); input.focus(); }
    return Boolean(el);
  }

  async function enviar(form, url, corpo, aoSucesso) {
    limparErros(form);
    const botao = form.querySelector('[type="submit"]');
    const texto = botao.textContent;
    botao.disabled = true;
    botao.textContent = t("perfil_salvando", null, "Salvando...");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": CSRF },
        body: JSON.stringify(corpo),
      });
      if (res.status === 401) { window.location.href = "/login?redirect=/perfil"; return; }
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (!(dados.campo && erroNoCampo(dados.campo, dados.error))) toast(dados.error || t("perfil_erro_salvar", null, "Não foi possível salvar."), "error");
        return;
      }
      aoSucesso(dados);
    } catch (e) {
      toast(t("perfil_sem_conexao", null, "Sem conexão. Tente novamente."), "error");
    } finally {
      botao.disabled = false;
      botao.textContent = texto;
    }
  }

  $("formNome")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    enviar(ev.target, "/api/conta/nome", { nome: $("nome").value }, (d) => {
      $("previewName").textContent = d.nome;
      $("avatarInitial").textContent = d.nome.trim().charAt(0).toUpperCase();
      toast(t("perfil_nome_atualizado", null, "Nome atualizado."));
    });
  });

  $("formEmail")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    enviar(ev.target, "/api/conta/email",
      { novoEmail: $("novoEmail").value, senhaEmail: $("senhaEmail").value },
      (d) => { ev.target.reset(); toast(d.mensagem); });
  });

  $("formSenha")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if ($("novaSenha").value !== $("confirmaSenha").value) {
      limparErros(ev.target);
      erroNoCampo("confirmaSenha", t("perfil_senhas_nao_coincidem", null, "As senhas não coincidem."));
      return;
    }
    enviar(ev.target, "/api/conta/senha", {
      senhaAtual: $("senhaAtual").value,
      novaSenha: $("novaSenha").value,
      confirmaSenha: $("confirmaSenha").value,
    }, (d) => {
      ev.target.reset();
      toast(d.mensagem);
      // A sessão foi regenerada: o token CSRF antigo morreu junto.
      setTimeout(() => window.location.reload(), 1800);
    });
  });
})();
