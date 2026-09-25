/* ==============================================================
   AquaTrip — Área do parceiro: experiências
   Listar, criar, editar, enviar para revisão, pausar, horários
   (programação simples) e foto de capa.
   ============================================================== */
(function () {
  "use strict";
  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const esc = window.escHTML;
  const $ = (id) => document.getElementById(id);
  const brl = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const SIT = {
    DRAFT: ["px-st-rascunho", "Rascunho"], PENDING: ["px-st-revisao", "Em revisão"],
    APPROVED: ["px-st-aprovada", "Aprovada"], REJECTED: ["px-st-recusada", "Precisa de ajustes"],
  };
  let lista = [];
  let editando = null;

  async function api(metodo, url, corpo, bruto) {
    const opts = { method: metodo, headers: { Accept: "application/json", "X-CSRF-Token": CSRF } };
    if (bruto) opts.body = bruto;
    else if (corpo) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(corpo); }
    const r = await fetch(url, opts);
    if (r.status === 204) return {};
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || "Falha na operação."); e.campo = d.campo; throw e; }
    return d;
  }

  function card(x) {
    const [cls, rot] = SIT[x.review_status] || ["", x.review_status];
    const podeEnviar = x.review_status === "DRAFT" || x.review_status === "REJECTED";
    return `<li class="px-card">
      <div class="px-card-topo">
        <strong>${esc(x.title)}</strong>
        <span class="px-st ${cls}">${esc(rot)}</span>
      </div>
      <p class="px-meta">${esc(x.location || "")} · ${esc(brl(x.price_cents))} · ${esc(x.horarios_futuros)} horário(s) futuro(s)
        ${x.active ? "" : " · <strong>pausada</strong>"}</p>
      ${x.motivo ? `<p class="px-motivo">Motivo: ${esc(x.motivo)}</p>` : ""}
      ${x.pending_cover_key ? '<p class="px-meta">Nova foto de capa em revisão.</p>' : ""}
      <div class="px-card-acoes">
        ${x.review_status !== "PENDING" ? `<button type="button" class="btn-ghost" data-editar="${esc(x.id)}">Editar</button>` : ""}
        ${podeEnviar ? `<button type="button" class="btn-primary" data-enviar="${esc(x.id)}">Enviar para revisão</button>` : ""}
        <button type="button" class="btn-ghost" data-horarios="${esc(x.id)}">Horários</button>
        <label class="btn-ghost px-arquivo">${x.cover_key ? "Trocar foto" : "Enviar foto"}
          <input type="file" accept="image/jpeg,image/png,image/webp" data-capa="${esc(x.id)}" hidden></label>
        ${x.review_status === "APPROVED" ? `<button type="button" class="btn-ghost" data-ativa="${esc(x.id)}" data-valor="${x.active ? "0" : "1"}">${x.active ? "Pausar vendas" : "Retomar vendas"}</button>` : ""}
      </div>
      <div class="px-horarios" id="h-${esc(x.id)}" hidden></div>
    </li>`;
  }

  async function carregar() {
    try {
      lista = (await api("GET", "/api/parceiro/experiencias")).experiencias;
      $("px-lista").innerHTML = lista.length ? lista.map(card).join("")
        : "<li>Nenhuma experiência ainda. Comece por <strong>Nova experiência</strong>.</li>";
    } catch (e) { $("px-lista").innerHTML = `<li>${esc(e.message)}</li>`; }
  }

  function abrir(x) {
    editando = x || null;
    $("px-dialogo-titulo").textContent = x ? "Editar experiência" : "Nova experiência";
    $("px-aviso-revisao").hidden = !(x && x.review_status === "APPROVED");
    $("px-titulo-in").value = x ? x.title : "";
    $("px-local").value = x ? x.location || "" : "";
    $("px-preco").value = x ? (x.price_cents / 100).toFixed(2) : "";
    $("px-categoria").value = x ? x.category : "mergulho";
    $("px-descricao").value = x ? x.description || "" : "";
    $("px-erro").hidden = true;
    $("px-dialogo").showModal();
  }

  $("px-nova")?.addEventListener("click", () => abrir(null));
  $("px-cancelar")?.addEventListener("click", () => $("px-dialogo").close());
  $("px-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const corpo = {
      titulo: $("px-titulo-in").value, local: $("px-local").value, categoria: $("px-categoria").value,
      preco: Number($("px-preco").value), descricao: $("px-descricao").value,
    };
    $("px-salvar").disabled = true;
    try {
      const r = editando
        ? await api("PUT", `/api/parceiro/experiencias/${encodeURIComponent(editando.id)}`, corpo)
        : await api("POST", "/api/parceiro/experiencias", corpo);
      $("px-dialogo").close();
      if (r.experiencia && r.experiencia.voltouParaRevisao) {
        window.alert("Alterações salvas. A experiência saiu da vitrine e voltou para revisão.");
      }
      carregar();
    } catch (e) {
      $("px-erro").textContent = e.message;
      $("px-erro").hidden = false;
    } finally { $("px-salvar").disabled = false; }
  });

  async function horarios(id) {
    const box = $("h-" + id);
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.textContent = "Carregando...";
    const { horarios: hs } = await api("GET", `/api/parceiro/experiencias/${encodeURIComponent(id)}/horarios`);
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    box.innerHTML = `
      <p class="px-meta">${hs.length ? hs.length + " horário(s) futuro(s). Primeiros:" : "Nenhum horário futuro."}</p>
      <ul class="px-h-lista">${hs.slice(0, 8).map((h) => `<li>${esc(h.data_local.split("-").reverse().join("/"))} ${esc(h.hora_local)} · ${esc(h.ocupados)}/${esc(h.capacity)}</li>`).join("")}</ul>
      <form class="px-h-form" data-prog="${esc(id)}">
        <label>De <input type="date" name="ini" value="${hoje}" min="${hoje}" required></label>
        <label>Até <input type="date" name="fim" required></label>
        <label>Horários <input name="horas" value="09:00, 14:00" required></label>
        <label>Vagas <input type="number" name="cap" value="10" min="1" max="500" required></label>
        <fieldset><legend>Dias</legend>${["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map((d, i) =>
          `<label><input type="checkbox" name="dia" value="${i}"${i === 0 || i === 6 ? " checked" : ""}> ${d}</label>`).join("")}</fieldset>
        <button type="submit" class="btn-primary">Criar horários</button>
        <p class="px-meta" role="status"></p>
      </form>`;
  }

  document.addEventListener("submit", async (ev) => {
    const f = ev.target.closest("[data-prog]");
    if (!f) return;
    ev.preventDefault();
    const msg = f.querySelector('[role="status"]');
    try {
      // form.elements (padrão) em vez de form.fim (atalho legado, fora
      // da interface padrão — a verificação em DOM pegou isso).
      const el = f.elements;
      const r = await api("POST", `/api/parceiro/experiencias/${encodeURIComponent(f.dataset.prog)}/horarios`, {
        dataInicio: el.ini.value, dataFim: el.fim.value, capacidade: Number(el.cap.value),
        diasSemana: [...f.querySelectorAll('[name="dia"]:checked')].map((c) => Number(c.value)),
        horarios: el.horas.value.split(",").map((h) => h.trim()).filter(Boolean),
      });
      msg.textContent = `${r.criados} horário(s) criado(s).`;
      carregar();
    } catch (e) { msg.textContent = e.message; }
  });

  document.addEventListener("click", async (ev) => {
    const ed = ev.target.closest("[data-editar]");
    const en = ev.target.closest("[data-enviar]");
    const at = ev.target.closest("[data-ativa]");
    const ho = ev.target.closest("[data-horarios]");
    try {
      if (ed) abrir(lista.find((x) => x.id === ed.dataset.editar));
      if (ho) await horarios(ho.dataset.horarios);
      if (en) { en.disabled = true; await api("POST", `/api/parceiro/experiencias/${encodeURIComponent(en.dataset.enviar)}/enviar`); carregar(); }
      if (at) { await api("POST", `/api/parceiro/experiencias/${encodeURIComponent(at.dataset.ativa)}/ativa`, { ativa: at.dataset.valor === "1" }); carregar(); }
    } catch (e) { window.alert(e.message); if (en) en.disabled = false; }
  });

  document.addEventListener("change", async (ev) => {
    const input = ev.target.closest("[data-capa]");
    if (!input || !input.files[0]) return;
    const alt = window.prompt("Descreva a foto em poucas palavras (lido por leitores de tela):", "");
    if (!alt) { input.value = ""; return; }
    const form = new FormData();
    form.append("alt", alt);
    form.append("imagem", input.files[0]);
    try {
      const r = await api("POST", `/api/parceiro/experiencias/${encodeURIComponent(input.dataset.capa)}/capa`, null, form);
      window.alert(r.mensagem);
      carregar();
    } catch (e) { window.alert(e.message); } finally { input.value = ""; }
  });

  carregar();
})();

/* Desconectar o Mercado Pago (tira as experiências da vitrine). */
(function () {
  const b = document.getElementById("mp-desconectar");
  if (!b) return;
  b.addEventListener("click", async () => {
    if (!window.confirm("Desconectar o Mercado Pago? Suas experiências saem da vitrine até você conectar de novo. Reservas já pagas não são afetadas.")) return;
    b.disabled = true;
    const r = await fetch("/api/parceiro/mercadopago/desconectar", {
      method: "POST",
      headers: { Accept: "application/json", "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content || "" },
    }).catch(() => null);
    if (r && r.ok) window.location.reload();
    else { window.alert("Não foi possível desconectar."); b.disabled = false; }
  });
})();
