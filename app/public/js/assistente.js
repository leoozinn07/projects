/* ==============================================================
   AquaTrip — Central de ajuda (janela flutuante, sem IA)
   ==============================================================
   O navegador só manda o texto da pergunta; o servidor devolve a
   resposta pronta mais parecida, experiências do catálogo quando a
   pergunta fala delas e sugestões de assuntos. O histórico vive na
   sessão do servidor (recarregar a página não perde a conversa).
   Tudo entra como textContent: nunca como HTML.
   ============================================================== */
(function () {
  "use strict";
  const raiz = document.getElementById("aqBot");
  if (!raiz) return;
  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content
    || document.querySelector('input[name="_csrf"]')?.value || "";
  const t = (k, v, p) => (window.AQ ? window.AQ.t(k, v, p) : p);
  const $ = (id) => document.getElementById(id);

  const fab = $("aqBotFab");
  const painel = $("aqBotPanel");
  const log = $("aqBotLog");
  const formulario = $("aqBotForm");
  const campo = $("aqBotInput");
  const enviar = $("aqBotSend");
  const sugs = $("aqBotSugs");
  let carregado = false;
  let ocupado = false;

  function abrir() {
    painel.hidden = false;
    raiz.classList.add("is-open");
    fab.setAttribute("aria-expanded", "true");
    fab.setAttribute("aria-label", t("bot_fechar", null, "Fechar assistente"));
    if (!carregado) carregarHistorico();
    // No celular o teclado virtual cobre metade da tela: foco só no desktop.
    if (window.matchMedia("(pointer: fine)").matches) setTimeout(() => campo.focus(), 60);
  }
  function fechar() {
    painel.hidden = true;
    raiz.classList.remove("is-open");
    fab.setAttribute("aria-expanded", "false");
    fab.setAttribute("aria-label", t("bot_abrir", null, "Abrir assistente AquaTrip"));
    fab.focus();
  }
  fab.addEventListener("click", () => (painel.hidden ? abrir() : fechar()));
  $("aqBotClose").addEventListener("click", fechar);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !painel.hidden) fechar(); });

  function rolar() { log.scrollTop = log.scrollHeight; }

  function bolha(papel, texto, extra) {
    const li = document.createElement("li");
    li.className = `aq-msg aq-msg-${papel}` + (extra ? " " + extra : "");
    // Quebras de linha e listas com "-" viram parágrafos; nada de HTML.
    String(texto).split(/\n{1,}/).filter(Boolean).forEach((linha) => {
      const p = document.createElement("p");
      const item = linha.match(/^\s*[-•]\s+(.*)$/);
      if (item) { p.className = "aq-li"; p.textContent = item[1]; } else { p.textContent = linha; }
      // Caminhos internos (/pagina) viram links clicáveis, sem innerHTML.
      linkificar(p);
      li.appendChild(p);
    });
    log.appendChild(li);
    rolar();
    return li;
  }

  function linkificar(p) {
    const texto = p.textContent;
    // Só caminhos internos: "//dominio" (relativo ao protocolo) levaria para fora.
    const re = /(^|\s)(\/(?!\/)[a-z0-9_\-/?=%.]*[a-z0-9_\-])/gi;
    if (!re.test(texto)) return;
    re.lastIndex = 0;
    p.textContent = "";
    let ultimo = 0;
    let m;
    while ((m = re.exec(texto))) {
      const inicio = m.index + m[1].length;
      p.append(texto.slice(ultimo, inicio));
      const a = document.createElement("a");
      a.href = m[2];
      a.textContent = m[2];
      p.append(a);
      ultimo = inicio + m[2].length;
    }
    p.append(texto.slice(ultimo));
  }

  /** Experiências encontradas no catálogo, como links. */
  function listaExperiencias(li, lista) {
    if (!Array.isArray(lista) || !lista.length) return;
    const ul = document.createElement("ul");
    ul.className = "aq-exp";
    lista.forEach((e) => {
      const item = document.createElement("li");
      const a = document.createElement("a");
      // Só links internos do próprio catálogo.
      a.href = /^\/reservar\/[a-z0-9-]+$/.test(e.link) ? e.link : "/reservar";
      const titulo = document.createElement("strong");
      titulo.textContent = e.titulo;
      const meta = document.createElement("span");
      meta.textContent = [e.local, e.preco, e.data].filter(Boolean).join(" · ");
      a.append(titulo, meta);
      item.appendChild(a);
      ul.appendChild(item);
    });
    li.appendChild(ul);
    rolar();
  }

  /** Botões com assuntos relacionados: clicar pergunta. */
  function sugestoes(lista) {
    if (!Array.isArray(lista) || !lista.length) return;
    const li = document.createElement("li");
    li.className = "aq-msg-sugs";
    lista.forEach((texto) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "aq-sug";
      b.textContent = texto;
      li.appendChild(b);
    });
    log.appendChild(li);
    rolar();
  }

  function digitando() {
    const li = document.createElement("li");
    li.className = "aq-msg aq-msg-bot aq-typing";
    li.setAttribute("aria-label", t("bot_digitando", null, "O assistente está escrevendo"));
    li.innerHTML = "<span></span><span></span><span></span>";
    log.appendChild(li);
    rolar();
    return li;
  }

  async function carregarHistorico() {
    carregado = true;
    try {
      const r = await fetch("/api/assistente", { headers: { Accept: "application/json" } });
      const j = await r.json();
      if (!j.disponivel) indisponivel();
      (j.historico || []).forEach((m) => {
        const li = bolha(m.role === "user" ? "user" : "bot", m.content);
        listaExperiencias(li, m.experiencias);
      });
      if ((j.historico || []).length) sugs.hidden = true;
    } catch {
      /* sem conexão: a pessoa ainda pode tentar enviar */
    }
  }

  function indisponivel() {
    raiz.classList.add("is-off");
    $("aqBotSub").textContent = t("bot_off", null, "Indisponível no momento. Use /feedback ou /contato.");
  }

  async function perguntar(texto) {
    if (ocupado) return;
    const msg = texto.trim();
    if (!msg) return;
    ocupado = true;
    sugs.hidden = true;
    bolha("user", msg);
    campo.value = "";
    ajustar();
    enviar.disabled = true;
    formulario.setAttribute("aria-busy", "true");
    const indicador = digitando();
    try {
      const r = await fetch("/api/assistente/mensagem", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": CSRF },
        body: JSON.stringify({ mensagem: msg }),
      });
      const j = await r.json().catch(() => ({}));
      indicador.remove();
      if (!r.ok) {
        if (j.codigo === "UNAVAILABLE") indisponivel();
        bolha("bot", j.error || t("bot_erro", null, "Não consegui responder agora. Tente de novo."), "aq-msg-erro");
        return;
      }
      const li = bolha("bot", j.resposta);
      listaExperiencias(li, j.experiencias);
      sugestoes(j.sugestoes);
    } catch {
      indicador.remove();
      bolha("bot", t("bot_sem_rede", null, "Sem conexão. Verifique a internet e tente de novo."), "aq-msg-erro");
    } finally {
      ocupado = false;
      enviar.disabled = false;
      formulario.removeAttribute("aria-busy");
      if (window.matchMedia("(pointer: fine)").matches) campo.focus();
    }
  }

  formulario.addEventListener("submit", (e) => { e.preventDefault(); perguntar(campo.value); });
  // Enter envia; Shift+Enter quebra linha.
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); perguntar(campo.value); }
  });
  function ajustar() {
    campo.style.height = "auto";
    campo.style.height = Math.min(campo.scrollHeight, 120) + "px";
  }
  campo.addEventListener("input", ajustar);
  sugs.addEventListener("click", (e) => { const b = e.target.closest(".aq-sug"); if (b) perguntar(b.textContent); });
  // Sugestões que chegam junto das respostas.
  log.addEventListener("click", (e) => { const b = e.target.closest(".aq-msg-sugs .aq-sug"); if (b) perguntar(b.textContent); });

  $("aqBotClear").addEventListener("click", async () => {
    try {
      await fetch("/api/assistente/limpar", { method: "POST", headers: { "X-CSRF-Token": CSRF } });
    } catch { /* limpa a tela mesmo assim */ }
    [...log.querySelectorAll(".aq-msg, .aq-msg-sugs")].slice(1).forEach((li) => li.remove());
    sugs.hidden = false;
  });
})();
