/* ==============================================================
   AquaTrip — Criar / editar experiência da comunidade
   ==============================================================
   Antes: validação "simulada" que não gravava nada. Agora:
   POST/PUT em /api/comunidade/experiencias, erros do servidor
   mostrados no campo certo, fotos enviadas uma a uma depois de a
   experiência existir, prévia ao vivo e gestão (pausar, pessoas).
   Todo texto vindo do servidor passa por escHTML / textContent.
   ============================================================== */
(function () {
  "use strict";
  const form = document.getElementById("cxForm");
  if (!form) return;
  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const t = (k, v, p) => (window.AQ ? window.AQ.t(k, v, p) : p);
  const $ = (id) => document.getElementById(id);
  const esc = window.escHTML || ((s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const icones = () => window.lucide && window.lucide.createIcons();

  const editandoId = form.dataset.id || null;
  const maxFotos = Number(form.dataset.maxFotos) || 6;
  let fotosNovas = []; // File[] ainda não enviados

  /* ---------- Mapeia campo do servidor -> elemento ---------- */
  const CAMPOS = {
    title: "cxTitle", titulo: "cxTitle", description: "cxDesc", location: "cxLoc", category: "cxCat",
    categoria: "cxCat", date: "cxDate", data: "cxDate", time: "cxTime", capacity: "cxCap", vagas: "cxCap",
    preco: "cxPreco", tripInfo: "cxInfo",
  };
  function mostrarErro(campo, msg) {
    const id = CAMPOS[campo];
    if (id === "cxCat") {
      $("cxCatErr").textContent = msg;
      return document.querySelector('input[name="category"]');
    }
    const el = id && $(id);
    if (el && window.AQForm) window.AQForm.erroCampo(el, msg);
    return el;
  }

  /* ---------- Validação local (espelha o servidor) ---------- */
  function validar() {
    window.AQForm && window.AQForm.limparErros(form);
    const erros = [];
    const v = (id) => $(id).value.trim();
    if (v("cxTitle").length < 6) erros.push(["title", t("cx_err_titulo", null, "O título precisa ter pelo menos 6 caracteres.")]);
    if (v("cxDesc").length < 30) erros.push(["description", t("cx_err_desc", null, "Descreva a experiência com pelo menos 30 caracteres.")]);
    if (!form.querySelector('input[name="category"]:checked')) erros.push(["category", t("cx_err_cat", null, "Escolha o tipo de experiência.")]);
    if (v("cxLoc").length < 3) erros.push(["location", t("cx_err_destino", null, "Informe o destino.")]);
    if (!v("cxDate")) erros.push(["date", t("cx_err_data", null, "Escolha a data.")]);
    if (!v("cxTime")) erros.push(["time", t("cx_err_hora", null, "Escolha o horário.")]);
    const cap = Number(v("cxCap"));
    if (!Number.isInteger(cap) || cap < 1 || cap > 100) erros.push(["capacity", t("cx_err_vagas", null, "Informe de 1 a 100 vagas.")]);
    if (v("cxPreco") && !$("cxPreco").checkValidity()) erros.push(["preco", t("cx_err_preco", null, "Use só números, ex.: 150,00.")]);
    erros.forEach(([c, m]) => mostrarErro(c, m));
    return erros;
  }

  function dados() {
    return {
      title: $("cxTitle").value.trim(),
      description: $("cxDesc").value.trim(),
      category: form.querySelector('input[name="category"]:checked')?.value,
      location: $("cxLoc").value.trim(),
      date: $("cxDate").value,
      time: $("cxTime").value,
      capacity: Number($("cxCap").value),
      preco: $("cxPreco").value.trim(),
      tripInfo: $("cxInfo").value.trim(),
    };
  }

  async function api(metodo, url, corpo) {
    const res = await fetch(url, {
      method: metodo,
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": CSRF },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (res.status === 401) { location.href = "/login?redirect=" + encodeURIComponent(location.pathname + location.search); throw new Error("login"); }
    const j = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.error || t("erro_tentar", null, "Não foi possível concluir.")); e.campo = j.campo; e.status = res.status; throw e; }
    return j;
  }

  async function enviarFoto(id, arquivo) {
    const fd = new FormData();
    fd.append("imagem", arquivo);
    const res = await fetch(`/api/comunidade/experiencias/${encodeURIComponent(id)}/fotos`, {
      method: "POST", headers: { Accept: "application/json", "X-CSRF-Token": CSRF }, body: fd,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "falha");
    return j;
  }

  /* ---------- Envio ---------- */
  const status = $("cxStatus");
  function aviso(msg, tipo) {
    status.textContent = msg || "";
    status.className = "form-status" + (tipo ? " is-" + tipo : "");
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    aviso("");
    const erros = validar();
    if (erros.length) {
      aviso(t("cx_corrija", null, "Revise os campos destacados."), "error");
      const primeiro = form.querySelector(".is-invalid") || form.querySelector('input[name="category"]');
      primeiro && primeiro.focus();
      return;
    }
    const botao = $("cxSubmit");
    window.AQForm.ocupado(botao, true);
    try {
      const corpo = dados();
      const r = editandoId
        ? await api("PUT", `/api/comunidade/experiencias/${encodeURIComponent(editandoId)}`, corpo)
        : await api("POST", "/api/comunidade/experiencias", corpo);
      const id = r.id || editandoId;
      const slug = r.slug || form.dataset.slug;

      const falhas = [];
      for (const [i, f] of fotosNovas.entries()) {
        aviso(t("cx_enviando_foto", { n: i + 1, total: fotosNovas.length }, `Enviando foto ${i + 1} de ${fotosNovas.length}...`));
        try { await enviarFoto(id, f); } catch (e) { falhas.push(`${f.name}: ${e.message}`); }
      }
      fotosNovas = [];
      aviso("");

      if (editandoId) {
        aviso(falhas.length ? falhas.join(" · ") : t("cx_salvo", null, "Alterações salvas."), falhas.length ? "error" : "success");
        if (!falhas.length) setTimeout(() => location.reload(), 700);
        return;
      }
      $("cxDoneVer").href = "/reservar/" + encodeURIComponent(slug);
      if (falhas.length) $("cxDoneText").textContent = t("cx_fotos_falharam", null, "Algumas fotos não foram enviadas: ") + falhas.join(" · ");
      const dlg = $("cxDone");
      dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", "");
    } catch (e) {
      if (e.message === "login") return;
      const el = e.campo && mostrarErro(e.campo.split(".")[0], e.message);
      aviso(e.message, "error");
      if (el && el.focus) el.focus();
    } finally {
      window.AQForm.ocupado(botao, false);
    }
  });

  /* ---------- Fotos: prévia local antes de enviar ---------- */
  const inputFotos = $("cxFotos");
  const lista = $("cxThumbs");
  function totalFotos() { return lista.querySelectorAll(".cx-thumb").length; }

  inputFotos.addEventListener("change", () => {
    const arquivos = [...inputFotos.files];
    inputFotos.value = "";
    for (const f of arquivos) {
      if (totalFotos() >= maxFotos) { aviso(t("cx_limite_fotos", { n: maxFotos }, `Máximo de ${maxFotos} fotos.`), "error"); break; }
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { aviso(t("cx_formato", { nome: f.name }, `${f.name}: use JPG, PNG ou WebP.`), "error"); continue; }
      if (f.size > 5 * 1024 * 1024) { aviso(t("cx_grande", { nome: f.name }, `${f.name}: maior que 5 MB.`), "error"); continue; }
      fotosNovas.push(f);
      const li = document.createElement("li");
      li.className = "cx-thumb";
      li.innerHTML = `<img alt=""><span class="cx-badge cx-badge-nova">${esc(t("cx_nova", null, "Nova"))}</span>` +
        `<button type="button" class="icon-btn cx-thumb-del" aria-label="${esc(t("cx_remover", null, "Remover foto"))}"><i data-lucide="x"></i></button>`;
      // data: e não blob: — a CSP do site (img-src) não libera blob:.
      const leitor = new FileReader();
      leitor.onload = () => { li.querySelector("img").src = leitor.result; atualizarPrevia(); };
      leitor.readAsDataURL(f);
      li.querySelector("button").addEventListener("click", () => {
        fotosNovas = fotosNovas.filter((x) => x !== f);
        li.remove();
        atualizarPrevia();
      });
      lista.appendChild(li);
    }
    icones();
    atualizarPrevia();
  });

  // Fotos já salvas (edição): remover de verdade.
  lista.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-remover]");
    if (!b || !editandoId) return;
    if (!confirm(t("cx_confirma_remover", null, "Remover esta foto?"))) return;
    try {
      await api("DELETE", `/api/comunidade/experiencias/${encodeURIComponent(editandoId)}/fotos/${encodeURIComponent(b.dataset.remover)}`);
      b.closest("li").remove();
      atualizarPrevia();
    } catch (e) { aviso(e.message, "error"); }
  });

  /* ---------- Prévia ao vivo ---------- */
  const CAPAS = { praia: "/img/praia.webp", mergulho: "/img/mergulhador.webp", caiaque: "/img/praia.webp", pesca: "/img/mata.webp", expedicao: "/img/baleia.webp", aquario: "/img/santos.webp" };
  function atualizarPrevia() {
    const d = dados();
    $("pvTitle").textContent = d.title || t("cx_pv_titulo", null, "Título da experiência");
    $("pvLoc").textContent = d.location || t("cx_pv_destino", null, "Destino");
    const preco = Number(String(d.preco || "0").replace(/\./g, "").replace(",", "."));
    $("pvPreco").textContent = preco > 0 ? (window.AQ ? window.AQ.brl(preco) : `R$ ${preco}`) : t("cx_gratuita", null, "Gratuita");
    $("pvVagas").textContent = d.capacity ? t("cx_pv_vagas", { n: d.capacity }, `${d.capacity} vagas`) : "--";
    $("pvData").textContent = d.date ? new Date(d.date + "T12:00:00").toLocaleDateString(window.AQ ? window.AQ.intl : "pt-BR", { day: "2-digit", month: "short" }) + (d.time ? " · " + d.time : "") : "--";
    const primeira = lista.querySelector(".cx-thumb img[src]");
    $("pvImg").src = primeira ? primeira.src : (CAPAS[d.category] || "/img/praia.webp");
  }
  form.addEventListener("input", atualizarPrevia);
  form.addEventListener("change", atualizarPrevia);
  atualizarPrevia();

  // Data mínima: amanhã (o servidor exige pelo menos 1 hora à frente).
  const hoje = new Date();
  $("cxDate").min = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  /* ---------- Gestão (edição) ---------- */
  const toggle = $("cxToggle");
  if (toggle) {
    toggle.addEventListener("click", async () => {
      const publicar = toggle.dataset.publicada !== "1";
      window.AQForm.ocupado(toggle, true);
      try {
        await api("POST", `/api/comunidade/experiencias/${encodeURIComponent(editandoId)}/publicada`, { publicada: publicar });
        toggle.dataset.publicada = publicar ? "1" : "0";
        toggle.textContent = publicar ? t("cx_pausar", null, "Pausar (tirar da vitrine)") : t("cx_republicar", null, "Publicar de novo");
        aviso(publicar ? t("cx_publicada", null, "Experiência publicada.") : t("cx_pausada", null, "Experiência pausada. Quem já confirmou continua com a vaga."), "success");
      } catch (e) { aviso(e.message, "error"); }
      finally { window.AQForm.ocupado(toggle, false); }
    });
  }

  const pessoas = $("cxPeople");
  if (pessoas) {
    api("GET", `/api/comunidade/experiencias/${encodeURIComponent(pessoas.dataset.id)}/pessoas`).then((r) => {
      const item = (p, extra) => `<li><a href="/usuarios/${encodeURIComponent(p.id)}">${esc(p.nome)}</a>${extra ? ` <span class="field-help">${esc(extra)}</span>` : ""}</li>`;
      pessoas.innerHTML =
        `<h3>${esc(t("cx_participantes", { n: r.participantes.length }, `Participantes (${r.participantes.length})`))}</h3>` +
        (r.participantes.length ? `<ul>${r.participantes.map((p) => item(p, t("cx_vagas_n", { n: p.vagas }, `${p.vagas} vaga(s)`))).join("")}</ul>` : `<p class="field-help">${esc(t("cx_ninguem", null, "Ninguém confirmou ainda."))}</p>`) +
        `<h3>${esc(t("cx_interessados", { n: r.interessados.length }, `Interessados (${r.interessados.length})`))}</h3>` +
        (r.interessados.length ? `<ul>${r.interessados.map((p) => item(p)).join("")}</ul>` : `<p class="field-help">${esc(t("cx_ninguem_interesse", null, "Ninguém marcou interesse ainda."))}</p>`);
    }).catch(() => { pessoas.innerHTML = `<p class="field-help">${esc(t("erro_tentar", null, "Não foi possível carregar."))}</p>`; });
  }
})();
