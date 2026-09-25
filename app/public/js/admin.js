/* ==============================================================
   AquaTrip — Painel administrativo
   ==============================================================
   Antes: quatro arrays fixos no arquivo (usuários, pacotes,
   faturamento) e métricas escritas no HTML. Nada disso existia.
   Agora tudo vem de /api/admin/*. O antigo /gestao foi unificado aqui.

   Todo dado do servidor passa por escHTML antes de ir para
   innerHTML: título de experiência e nome de usuário são texto
   digitado por pessoas.
   ============================================================== */
(function () {
  "use strict";

  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const esc = window.escHTML;
  const $ = (id) => document.getElementById(id);

  const brl = (c) => (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const data = (d) => d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "-";
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  async function api(metodo, url, corpo) {
    const res = await fetch(url, {
      method: metodo,
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": CSRF },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (res.status === 401) { window.location.href = "/login?redirect=/admin"; throw new Error("sessão expirada"); }
    if (res.status === 204) return {};
    const dados = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(dados.error || "Não foi possível concluir a operação.");
    return dados;
  }

  function aviso(msg) {
    if (window.aquatripToast) window.aquatripToast(msg);
    else window.alert(msg);
  }

  /* ---------- Navegação entre seções ---------- */
  const TITULOS = { dashboard: "Dashboard", usuarios: "Usuários", pacotes: "Experiências", faturamento: "Faturamento", atendimento: "Atendimento", parceiros: "Parceiros", comunidade: "Moderação de experiências", reclamacoes: "Reclamações e avaliações" };
  const carregadas = new Set();

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((n) => { n.classList.remove("active"); n.removeAttribute("aria-current"); });
      document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
      item.classList.add("active");
      item.setAttribute("aria-current", "page");
      const sec = item.dataset.section;
      $("section-" + sec).classList.add("active");
      $("page-title").textContent = TITULOS[sec] || sec;
      carregarSecao(sec);
    });
  });

  // Carregamento sob demanda: só busca a seção quando ela é aberta.
  function carregarSecao(sec) {
    if (carregadas.has(sec)) return;
    carregadas.add(sec);
    ({ dashboard: carregarPainel, usuarios: carregarUsuarios, pacotes: carregarExperiencias, faturamento: carregarFaturamento, atendimento: carregarAtendimento, parceiros: carregarParceiros, comunidade: carregarComunidade, reclamacoes: carregarFeedback }[sec] || (() => {}))();
  }

  /* ---------- Badges ---------- */
  const BADGE_PAGAMENTO = {
    APPROVED: ["badge-success", "Aprovado"],
    PENDING: ["badge-warning", "Pendente"],
    REJECTED: ["badge-danger", "Recusado"],
    CANCELLED: ["badge-danger", "Cancelado"],
    EXPIRED: ["badge-info", "Expirado"],
    REFUNDED: ["badge-info", "Estornado"],
  };
  const METODO = { PIX: "PIX", CREDIT_CARD: "Cartão de crédito", DEBIT_CARD: "Cartão de débito" };
  function badge(mapa, chave) {
    const [cls, rotulo] = mapa[chave] || ["badge-info", chave];
    return `<span class="badge ${cls}">${esc(rotulo)}</span>`;
  }

  function linhaVazia(tbody, colunas, texto) {
    tbody.innerHTML = `<tr><td colspan="${colunas}" class="td-empty">${esc(texto)}</td></tr>`;
  }

  /* ============================================================
     DASHBOARD
     ============================================================ */
  function barras(alvo, meses) {
    const el = $(alvo);
    if (!el) return;
    const max = Math.max(1, ...meses.map((m) => m.receita_cents));
    el.innerHTML = meses.map((m) => {
      const [ano, mes] = m.mes.split("-");
      const pct = Math.round((m.receita_cents / max) * 100);
      return `<section class="bar-row">
          <span class="bar-label">${MESES[Number(mes) - 1]}/${ano.slice(2)}</span>
          <section class="bar-track"><section class="bar-fill" data-pct="${pct}"></section></section>
          <span class="bar-val">${esc(brl(m.receita_cents))}</span>
        </section>`;
    }).join("");
    // Largura por JS em vez de style="" no HTML gerado: mantém o
    // innerHTML livre de atributos de estilo vindos de dado.
    el.querySelectorAll(".bar-fill").forEach((b) => { b.style.width = b.dataset.pct + "%"; });
  }

  function preencher(nome, valor) {
    document.querySelectorAll(`[data-m="${nome}"]`).forEach((el) => { el.textContent = valor; });
  }

  let painel = null;

  async function carregarPainel() {
    try {
      painel = await api("GET", "/api/admin/painel");
      const m = painel.metricas;
      preencher("usuarios", m.usuarios.toLocaleString("pt-BR"));
      preencher("usuarios_30d_txt", `${m.usuarios_30d} novo${m.usuarios_30d !== 1 ? "s" : ""} em 30 dias`);
      preencher("experiencias_ativas", m.experiencias_ativas);
      preencher("receita_30d", brl(m.receita_30d_cents));
      preencher("taxa_txt", `Taxa da plataforma: ${painel.taxaPlataformaPercent}%`);
      preencher("reservas_confirmadas", m.reservas_confirmadas);
      preencher("pendentes_txt", `${m.reservas_pendentes} aguardando pagamento`);
      preencher("receita_bruta", brl(m.receita_bruta_cents));
      preencher("taxa_total_txt", `Plataforma: ${brl(m.taxa_plataforma_cents)}`);
      preencher("estornado", brl(m.estornado_cents));
      preencher("ticket_medio", m.reservas_confirmadas
        ? brl(Math.round(m.receita_bruta_cents / m.reservas_confirmadas)) : "-");

      preencher("receita_bruta_dash", brl(m.receita_bruta_cents));
      preencher("taxa_total_dash", `Plataforma: ${brl(m.taxa_plataforma_cents)} · estornado ${brl(m.estornado_cents)}`);
      const p = painel.plataforma || {};
      const n = (v) => Number(v || 0).toLocaleString("pt-BR");
      const P = (k, v) => document.querySelectorAll(`[data-p="${k}"]`).forEach((el) => { el.textContent = v; });
      P("online_agora", n(p.online_agora));
      P("ativos_24h_txt", `${n(p.ativos_24h)} ativos nas últimas 24 h`);
      P("parceiros_aprovados", n(p.parceiros_aprovados));
      P("parceiros_pendentes_txt", `${n(p.parceiros_pendentes)} aguardando análise`);
      P("experiencias_total", n(p.experiencias_total));
      P("experiencias_comunidade_txt", `${n(p.experiencias_comunidade)} da comunidade · ${n(p.experiencias_moderadas)} moderadas`);
      P("participantes", n(p.participantes));
      P("reclamacoes_abertas", n(p.reclamacoes_abertas));
      P("denuncias_txt", `${n(p.denuncias_abertas)} denúncias abertas`);
      P("avaliacoes_experiencias", n(p.avaliacoes_experiencias));
      P("avaliacoes_txt", (p.nota_media_experiencias != null ? `Nota média ${String(p.nota_media_experiencias).replace(".", ",")}` : "Sem notas ainda") +
        ` · AquaTrip: ${n(p.avaliacoes_plataforma)}${p.nota_media_plataforma != null ? " (" + String(p.nota_media_plataforma).replace(".", ",") + ")" : ""}`);
      P("curtidas", n(p.curtidas));
      P("interacoes_txt", `curtidas · ${n(p.comentarios)} comentários · ${n(p.conexoes)} conexões`);
      badgeNum("badge-denuncias", p.denuncias_abertas);
      badgeNum("badge-reclamacoes", p.reclamacoes_abertas);

      barras("chart-receita", painel.receitaMensal);
      barras("chart-receita-fat", painel.receitaMensal);

      // Inconsistências: só aparece quando existe.
      const alerta = $("integrity-alert");
      if (alerta) {
        alerta.hidden = !painel.inconsistencias.length;
        $("integrity-list").innerHTML = painel.inconsistencias.map((i) =>
          `<li><strong>${esc(i.tipo === "PAGO_SEM_CONFIRMACAO" ? "Pago sem reserva confirmada" : "Confirmada sem pagamento")}</strong>
           · ${esc(i.email)} · ${esc(brl(i.amount_cents))} · reserva ${esc(i.reserva)}</li>`).join("");
      }

      const ultimas = await api("GET", "/api/admin/transacoes");
      const tbody = $("ultimas-tbody");
      if (!ultimas.transacoes.length) return linhaVazia(tbody, 5, "Nenhuma transação ainda.");
      tbody.innerHTML = ultimas.transacoes.slice(0, 6).map((t) => `
        <tr>
          <td>${esc(t.cliente)}</td>
          <td>${esc(t.experiencia)}</td>
          <td>${esc(data(t.created_at))}</td>
          <td>${esc(brl(t.amount_cents))}</td>
          <td>${badge(BADGE_PAGAMENTO, t.status)}</td>
        </tr>`).join("");
    } catch (e) {
      aviso("Painel: " + e.message);
    }
  }

  /* ============================================================
     USUÁRIOS
     ============================================================ */
  let usuarios = [];

  function renderUsuarios(lista) {
    const tbody = $("user-tbody");
    if (!lista.length) return linhaVazia(tbody, 6, "Nenhum usuário encontrado.");
    tbody.innerHTML = lista.map((u) => {
      const suspenso = u.status === "SUSPENDED" || u.status === "BANNED";
      const status = u.role === "ADMIN"
        ? '<span class="badge badge-info">Administrador</span>'
        : u.status === "BANNED"
          ? '<span class="badge badge-danger">Banido</span>'
          : suspenso
            ? `<span class="badge badge-danger">Suspenso${u.suspended_until ? " até " + esc(data(u.suspended_until)) : ""}</span>`
            : '<span class="badge badge-success">Ativo</span>';
      const perfil = `<button type="button" class="btn btn-sm" data-perfil="${esc(u.id)}">Ver perfil</button> `;
      const acao = perfil + (u.role === "ADMIN" ? "" : suspenso
        ? `<button type="button" class="btn btn-sm" data-reativar="${esc(u.id)}">Reativar</button>`
        : `<button type="button" class="btn btn-sm btn-danger" data-suspender="${esc(u.id)}">Suspender</button> <button type="button" class="btn btn-sm btn-danger" data-banir="${esc(u.id)}">Banir</button>`);
      return `<tr>
          <td>${u.online ? '<span class="live-dot" title="Online agora"></span> ' : ""}${esc(u.name)}</td>
          <td>${esc(u.email)}</td>
          <td>${esc(data(u.created_at))}</td>
          <td>${esc(u.reservas)}</td>
          <td>${status}${u.mfa ? ' <span class="badge badge-success" title="Verificação em duas etapas ativa">2FA</span>' : ""}</td>
          <td>${acao || ""}${u.mfa ? ` <button type="button" class="btn btn-sm" data-redefinir-2fa="${esc(u.id)}">Redefinir 2FA</button>` : ""}${!acao && !u.mfa ? "-" : ""}</td>
        </tr>`;
    }).join("");
  }

  async function carregarUsuarios() {
    try {
      usuarios = (await api("GET", "/api/admin/usuarios")).usuarios;
      filtrarUsuarios();
    } catch (e) {
      linhaVazia($("user-tbody"), 6, "Não foi possível carregar: " + e.message);
    }
  }

  // Situação derivada: mesma regra do antigo painel de gestão.
  function situacao(u) {
    if (u.role === "ADMIN") return "admin";
    if (u.status === "BANNED") return "banido";
    if (u.status === "SUSPENDED") return u.suspended_until ? "suspenso" : "suspenso_sem_prazo";
    return "ativo";
  }

  // Busca + situação sobre a lista já carregada: sem requisição por tecla.
  // Busca sem acento e sem maiúscula: "sao" acha "São Paulo".
  function sem(t) { return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }

  function filtrarUsuarios() {
    const q = sem(($("user-search")?.value || "").trim());
    const st = $("user-status")?.value || "";
    renderUsuarios(usuarios.filter((u) =>
      (!q || sem(u.name).includes(q) || sem(u.email).includes(q)) &&
      (!st || (st === "online" ? !!u.online : situacao(u) === st))));
  }
  $("user-search")?.addEventListener("input", filtrarUsuarios);
  $("user-status")?.addEventListener("change", filtrarUsuarios);

  $("user-tbody")?.addEventListener("click", async (ev) => {
    const mfa = ev.target.closest("[data-redefinir-2fa]");
    if (mfa) {
      if (!window.confirm("Redefinir a verificação em duas etapas desta pessoa? Use só quando ela perdeu o celular E os códigos de recuperação, e depois de confirmar a identidade dela por outro canal.")) return;
      try {
        await api("POST", `/api/admin/usuarios/${encodeURIComponent(mfa.dataset.redefinir2fa)}/2fa/redefinir`);
        aviso("2FA redefinido. A pessoa foi avisada por e-mail e as sessões dela foram encerradas.");
        carregadas.delete("usuarios"); carregarSecao("usuarios");
      } catch (e) { aviso(e.message); }
      return;
    }
    const ver = ev.target.closest("[data-perfil]");
    if (ver) return abrirPerfil(ver.dataset.perfil);
    const ban = ev.target.closest("[data-banir]");
    if (ban) {
      const u = usuarios.find((x) => x.id === ban.dataset.banir);
      const motivo = await pedirMotivo("Banir usuário", `${u.name} · ${u.email}. Banimento é permanente até reativar; as sessões caem e as experiências dele saem do ar.`, "Banir");
      if (!motivo) return;
      try {
        await api("POST", `/api/admin/usuarios/${encodeURIComponent(u.id)}/banir`, { motivo });
        aviso("Usuário banido. Sessões encerradas e experiências retiradas do ar.");
        carregadas.delete("usuarios"); carregarSecao("usuarios");
      } catch (e) { aviso(e.message); }
      return;
    }
    const susp = ev.target.closest("[data-suspender]");
    const reat = ev.target.closest("[data-reativar]");
    if (!susp && !reat) return;

    try {
      if (susp) {
        abrirSuspensao(usuarios.find((x) => x.id === susp.dataset.suspender));
        return;
      } else {
        reat.disabled = true;
        await api("POST", `/api/admin/usuarios/${encodeURIComponent(reat.dataset.reativar)}/reativar`);
        aviso("Usuário reativado.");
      }
      carregadas.delete("usuarios");
      carregarSecao("usuarios");
    } catch (e) {
      aviso(e.message);
      if (susp) susp.disabled = false;
      if (reat) reat.disabled = false;
    }
  });

  /* ---------- Diálogo de suspensão ----------
     Antes: dois window.prompt — dava para digitar "sete", "-5" ou
     nada. Lista fechada de durações e motivo obrigatório. */
  const suspModal = $("suspend-modal");
  let alvoSuspensao = null;

  function abrirSuspensao(u) {
    if (!u) return;
    alvoSuspensao = u;
    $("suspend-quem").textContent = `${u.name} · ${u.email}`;
    $("suspend-dias").value = "7";
    $("suspend-motivo").value = "";
    $("suspend-erro").hidden = true;
    suspModal.showModal();
    $("suspend-motivo").focus();
  }
  $("suspend-cancelar")?.addEventListener("click", () => suspModal.close());
  $("suspend-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const motivo = $("suspend-motivo").value.trim();
    if (motivo.length < 5) {
      $("suspend-erro").textContent = "Descreva o motivo (fica registrado na auditoria).";
      $("suspend-erro").hidden = false;
      return;
    }
    const dias = $("suspend-dias").value;
    $("suspend-confirmar").disabled = true;
    try {
      await api("POST", `/api/admin/usuarios/${encodeURIComponent(alvoSuspensao.id)}/suspender`,
        { dias: dias ? Number(dias) : null, motivo });
      suspModal.close();
      aviso("Usuário suspenso. As sessões abertas dele foram encerradas.");
      carregadas.delete("usuarios");
      carregarSecao("usuarios");
    } catch (e) {
      $("suspend-erro").textContent = e.message;
      $("suspend-erro").hidden = false;
    } finally {
      $("suspend-confirmar").disabled = false;
    }
  });

  /* ============================================================
     EXPERIÊNCIAS
     ============================================================ */
  let experiencias = [];
  const modal = $("pkg-modal");
  const confirmModal = $("confirm-modal");
  let pendenteDesativar = null;

  function filtrarExperiencias() {
    const q = sem(($("pkg-busca")?.value || "").trim());
    const cat = $("pkg-categoria-filtro")?.value || "";
    const st = $("pkg-status-filtro")?.value || "";
    return experiencias.filter((x) =>
      (!q || sem(x.title).includes(q) || sem(x.location).includes(q)) &&
      (!cat || x.category === cat) &&
      (!st ||
        (st === "ativa" && x.active) ||
        (st === "inativa" && !x.active) ||
        (st === "sem-horario" && !x.capacidade_total) ||
        (st === "sem-foto" && !x.cover_key)));
  }

  /* Ocupação: assentos vendidos sobre assentos oferecidos (herdado do
     antigo painel de gestão). Barra + número — nunca só a cor. */
  function aplicarBarras() {
    document.querySelectorAll("#pkg-grid [data-pct]").forEach((b) => { b.style.width = b.dataset.pct + "%"; });
  }
  ["pkg-busca", "pkg-categoria-filtro", "pkg-status-filtro"].forEach((id) => {
    $(id)?.addEventListener(id === "pkg-busca" ? "input" : "change", () => { renderExperiencias(); aplicarBarras(); });
  });

  function ocupacao(x) {
    if (!x.capacidade_geral) return "";
    const pct = Math.min(100, Math.round((x.vendidos / x.capacidade_geral) * 100));
    return `<div class="pkg-ocupacao">
      <span>Ocupação ${pct}%</span>
      <span class="pkg-ocupacao-barra"><b data-pct="${pct}"></b></span>
    </div>`;
  }

  function renderExperiencias() {
    const grid = $("pkg-grid");
    if (!experiencias.length) {
      grid.innerHTML = '<li class="pkg-empty">Nenhuma experiência cadastrada.</li>';
      $("pkg-contagem").textContent = "";
      return;
    }
    const lista = filtrarExperiencias();
    $("pkg-contagem").textContent = `${lista.length} de ${experiencias.length}`;
    if (!lista.length) {
      grid.innerHTML = '<li class="pkg-empty">Nenhuma experiência com esses filtros.</li>';
      return;
    }
    grid.innerHTML = lista.map((x) => `
      <li class="pkg-card${x.active ? "" : " pkg-card--inativa"}">
        <article>
          ${x.cover_key ? `<img class="pkg-cover" src="/media/${esc(x.cover_key)}" alt="${esc(x.cover_alt || "")}" loading="lazy">` : ""}
          <header class="pkg-head">
            <h3 class="pkg-name">${esc(x.title)}</h3>
            ${x.parceiro ? `<p class="td-mono">Parceiro: ${esc(x.parceiro)}${x.review_status !== "APPROVED" ? " · " + esc({ DRAFT: "rascunho", PENDING: "em revisão", REJECTED: "recusada" }[x.review_status] || "") : ""}</p>` : ""}
            ${x.active ? '<span class="badge badge-success">Ativa</span>' : '<span class="badge badge-info">Inativa</span>'}
          </header>
          <p class="pkg-dest">${esc(x.location || "")} · ${esc(x.category || "")}</p>
          ${x.description ? `<p class="pkg-desc">${esc(x.description)}</p>` : ""}
          <dl class="pkg-stats">
            <div><dt>Preço</dt><dd>${esc(brl(x.price_cents))}</dd></div>
            ${x.capacidade_total ? "" : '<div class="pkg-warn"><dt>Atenção</dt><dd>Sem horários futuros: ninguém consegue reservar</dd></div>'}
            <div><dt>Vendidos</dt><dd>${esc(x.vendidos)}${x.capacidade_total ? " / " + esc(x.capacidade_total) + " vagas futuras" : ""}</dd></div>
            <div><dt>Receita</dt><dd>${esc(brl(x.receita_cents))}</dd></div>
          </dl>
          ${ocupacao(x)}
          <footer class="pkg-actions">
            <button type="button" class="btn btn-sm" data-editar="${esc(x.id)}">Editar</button>
            <label class="btn btn-sm btn-file">
              ${x.cover_key ? "Trocar foto" : "Enviar foto ⚠"}
              <input type="file" accept="image/jpeg,image/png,image/webp" data-capa="${esc(x.id)}" hidden>
            </label>
            <button type="button" class="btn btn-sm" data-horarios="${esc(x.id)}">Horários${x.capacidade_total ? "" : " ⚠"}</button>
            ${x.active
              ? `<button type="button" class="btn btn-sm btn-danger" data-desativar="${esc(x.id)}">Desativar</button>`
              : `<button type="button" class="btn btn-sm" data-ativar="${esc(x.id)}">Reativar</button>`}
          </footer>
        </article>
      </li>`).join("");
  }

  async function carregarExperiencias() {
    try {
      experiencias = (await api("GET", "/api/admin/experiencias")).experiencias;
      renderExperiencias();
      aplicarBarras();
    } catch (e) {
      $("pkg-grid").innerHTML = `<li class="pkg-empty">Não foi possível carregar: ${esc(e.message)}</li>`;
    }
  }

  function abrirModal(x) {
    $("pkg-erro").hidden = true;
    $("pkg-edit-id").value = x ? x.id : "";
    $("pkg-nome").value = x ? x.title : "";
    $("pkg-preco").value = x ? (x.price_cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "";
    $("pkg-destino").value = x ? (x.location || "") : "";
    $("pkg-categoria").value = x ? (x.category || "praia") : "praia";
    $("pkg-desc").value = x ? (x.description || "") : "";
    $("modal-pkg-title").textContent = x ? "Editar experiência" : "Nova experiência";
    modal.showModal();
    $("pkg-nome").focus();
  }
  const fecharModal = () => modal.close();

  $("btn-novo-pacote")?.addEventListener("click", () => abrirModal(null));
  $("btn-close-modal")?.addEventListener("click", fecharModal);
  $("btn-cancel-modal")?.addEventListener("click", fecharModal);
  modal?.addEventListener("click", (e) => { if (e.target === modal) fecharModal(); });

  $("pkg-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const id = $("pkg-edit-id").value;
    const corpo = {
      title: $("pkg-nome").value,
      preco: $("pkg-preco").value,
      location: $("pkg-destino").value,
      category: $("pkg-categoria").value,
      description: $("pkg-desc").value,
    };
    const botao = ev.submitter || $("pkg-form").querySelector('[type="submit"]');
    if (botao) botao.disabled = true;
    try {
      if (id) await api("PUT", `/api/admin/experiencias/${encodeURIComponent(id)}`, corpo);
      else await api("POST", "/api/admin/experiencias", corpo);
      fecharModal();
      aviso(id ? "Experiência atualizada." : "Experiência criada.");
      await carregarExperiencias();
    } catch (e) {
      $("pkg-erro").textContent = e.message;
      $("pkg-erro").hidden = false;
    } finally {
      if (botao) botao.disabled = false;
    }
  });

  $("pkg-grid")?.addEventListener("click", async (ev) => {
    const ed = ev.target.closest("[data-editar]");
    const des = ev.target.closest("[data-desativar]");
    const at = ev.target.closest("[data-ativar]");
    const hr = ev.target.closest("[data-horarios]");
    if (hr) return abrirHorarios(experiencias.find((x) => x.id === hr.dataset.horarios));
    if (ed) abrirModal(experiencias.find((x) => x.id === ed.dataset.editar));
    if (des) { pendenteDesativar = des.dataset.desativar; confirmModal.showModal(); }
    if (at) {
      try {
        await api("POST", `/api/admin/experiencias/${encodeURIComponent(at.dataset.ativar)}/status`, { ativa: true });
        aviso("Experiência reativada.");
        await carregarExperiencias();
      } catch (e) { aviso(e.message); }
    }
  });

  /* Envio de capa: o servidor valida tipo real, tamanho e dimensões,
     e reprocessa a imagem (remove metadados, inclusive GPS). */
  $("pkg-grid")?.addEventListener("change", async (ev) => {
    const input = ev.target.closest("[data-capa]");
    if (!input || !input.files[0]) return;
    const arquivo = input.files[0];
    if (arquivo.size > 5 * 1024 * 1024) { aviso("Arquivo grande demais (máximo 5 MB)."); input.value = ""; return; }
    const alt = window.prompt("Descreva a foto em poucas palavras (lido por leitores de tela):", "");
    if (!alt) { input.value = ""; return; }
    const form = new FormData();
    form.append("alt", alt);
    form.append("imagem", arquivo);
    try {
      const res = await fetch(`/api/admin/experiencias/${encodeURIComponent(input.dataset.capa)}/capa`, {
        method: "POST", headers: { "X-CSRF-Token": CSRF, Accept: "application/json" }, body: form,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Falha no envio.");
      aviso("Foto publicada.");
      carregarExperiencias();
    } catch (e) {
      aviso(e.message);
    } finally {
      input.value = "";
    }
  });

  $("btn-cancel-delete")?.addEventListener("click", () => { pendenteDesativar = null; confirmModal.close(); });
  confirmModal?.addEventListener("click", (e) => { if (e.target === confirmModal) confirmModal.close(); });
  $("btn-confirm-delete")?.addEventListener("click", async () => {
    if (!pendenteDesativar) return;
    try {
      await api("POST", `/api/admin/experiencias/${encodeURIComponent(pendenteDesativar)}/status`, { ativa: false });
      aviso("Experiência desativada.");
      await carregarExperiencias();
    } catch (e) {
      aviso(e.message); // ex.: "há 1 reserva ativa" — o servidor explica o motivo
    } finally {
      pendenteDesativar = null;
      confirmModal.close();
    }
  });

  /* ============================================================
     HORÁRIOS
     ============================================================ */
  const slotsModal = $("slots-modal");
  let expAtual = null;

  function hojeISO() {
    // Data de hoje no calendário de Brasília (não no fuso do navegador).
    return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  }

  async function carregarHorarios() {
    const tbody = $("slots-tbody");
    tbody.innerHTML = '<tr><td colspan="5" class="td-empty">Carregando...</td></tr>';
    try {
      const { horarios } = await api("GET", `/api/admin/experiencias/${encodeURIComponent(expAtual.id)}/horarios`);
      if (!horarios.length) {
        return linhaVazia(tbody, 5, "Nenhum horário futuro. Programe acima para liberar reservas.");
      }
      tbody.innerHTML = horarios.map((h) => {
        const [a, m, d] = h.data_local.split("-");
        const dia = new Date(Date.UTC(+a, +m - 1, +d)).toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" });
        return `<tr>
          <td>${esc(dia)} ${esc(d + "/" + m + "/" + a)}</td>
          <td>${esc(h.hora_local)}</td>
          <td>${esc(h.ocupados)} / ${esc(h.capacity)}</td>
          <td><input type="number" class="slot-cap" min="${Math.max(1, h.ocupados)}" max="500"
                     value="${esc(h.capacity)}" data-cap="${esc(h.id)}" aria-label="Vagas em ${esc(d + "/" + m)} às ${esc(h.hora_local)}"></td>
          <td>${h.ocupados === 0
            ? `<button type="button" class="btn btn-sm btn-danger" data-remover="${esc(h.id)}">Remover</button>`
            : '<span class="td-mono">com reservas</span>'}</td>
        </tr>`;
      }).join("");
    } catch (e) {
      linhaVazia(tbody, 5, "Não foi possível carregar: " + e.message);
    }
  }

  function abrirHorarios(x) {
    if (!x) return;
    expAtual = x;
    $("slots-title").textContent = "Horários: " + x.title;
    $("slots-erro").hidden = true;
    $("slots-ok").hidden = true;
    const hoje = hojeISO();
    $("sl-inicio").value = hoje;
    $("sl-inicio").min = hoje;
    const fim = new Date(Date.now() + 30 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    $("sl-fim").value = fim;
    $("sl-fim").min = hoje;
    slotsModal.showModal();
    carregarHorarios();
  }

  $("btn-close-slots")?.addEventListener("click", () => { slotsModal.close(); carregarExperiencias(); });
  slotsModal?.addEventListener("click", (e) => { if (e.target === slotsModal) { slotsModal.close(); carregarExperiencias(); } });

  $("slots-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("slots-erro").hidden = true;
    $("slots-ok").hidden = true;
    const corpo = {
      dataInicio: $("sl-inicio").value,
      dataFim: $("sl-fim").value,
      capacidade: Number($("sl-cap").value),
      diasSemana: [...document.querySelectorAll('#slots-form input[name="dia"]:checked')].map((c) => Number(c.value)),
      horarios: $("sl-horas").value.split(",").map((h) => h.trim()).filter(Boolean)
        .map((h) => /^\d{1,2}$/.test(h) ? h.padStart(2, "0") + ":00" : h.padStart(5, "0")),
    };
    const btn = ev.submitter;
    if (btn) btn.disabled = true;
    try {
      const r = await api("POST", `/api/admin/experiencias/${encodeURIComponent(expAtual.id)}/horarios`, corpo);
      $("slots-ok").textContent = r.criados
        ? `${r.criados} horário(s) criado(s)` + (r.ignorados ? ` · ${r.ignorados} já existiam ou estavam no passado` : "") + "."
        : "Nenhum horário novo: todos já existiam ou estavam no passado.";
      $("slots-ok").hidden = false;
      carregarHorarios();
    } catch (e) {
      $("slots-erro").textContent = e.message;
      $("slots-erro").hidden = false;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Capacidade: salva ao sair do campo. O servidor recusa valor
  // abaixo do já ocupado e explica o motivo.
  $("slots-tbody")?.addEventListener("change", async (ev) => {
    const campo = ev.target.closest("[data-cap]");
    if (!campo) return;
    try {
      await api("PUT", `/api/admin/horarios/${encodeURIComponent(campo.dataset.cap)}`, { capacidade: Number(campo.value) });
      aviso("Vagas atualizadas.");
    } catch (e) {
      aviso(e.message);
    }
    carregarHorarios();
  });

  $("slots-tbody")?.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-remover]");
    if (!b || !window.confirm("Remover este horário?")) return;
    b.disabled = true;
    try {
      await api("DELETE", `/api/admin/horarios/${encodeURIComponent(b.dataset.remover)}`);
      carregarHorarios();
    } catch (e) {
      aviso(e.message);
      b.disabled = false;
    }
  });

  /* ============================================================
     FATURAMENTO
     ============================================================ */
  let transacoes = [];

  async function carregarFaturamento() {
    if (!painel) carregarPainel(); // métricas e gráfico da seção vêm do painel
    const status = $("filter-status")?.value || "";
    const dias = $("filter-dias")?.value || "";
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (dias) qs.set("dias", dias);
    const tbody = $("billing-tbody");
    try {
      transacoes = (await api("GET", "/api/admin/transacoes?" + qs)).transacoes;
      renderFaturamento();
    } catch (e) {
      linhaVazia(tbody, 7, "Não foi possível carregar: " + e.message);
    }
  }

  /* Busca local + totais DO QUE ESTÁ FILTRADO (herdado da gestão).
     Antes, os cartões mostravam o período inteiro independentemente
     do filtro, o que induz a leitura errada. */
  function transacoesFiltradas() {
    const q = sem(($("filter-busca")?.value || "").trim());
    return !q ? transacoes : transacoes.filter((t) =>
      sem(t.cliente).includes(q) || sem(t.cliente_email).includes(q) || sem(t.experiencia).includes(q));
  }

  function renderFaturamento() {
    const tbody = $("billing-tbody");
    const lista = transacoesFiltradas();
    const soma = (st, campo = "amount_cents") =>
      lista.filter((t) => t.status === st).reduce((a, t) => a + Number(t[campo] || 0), 0);
    $("bill-recebido").textContent = brl(soma("APPROVED"));
    $("bill-pendente").textContent = brl(soma("PENDING"));
    $("bill-estornado").textContent = brl(soma("REFUNDED"));
    $("bill-taxa").textContent = brl(soma("APPROVED", "taxa_cents"));

    if (!lista.length) return linhaVazia(tbody, 7, "Nenhuma transação no filtro escolhido.");
    tbody.innerHTML = lista.map((t) => `
        <tr>
          <td class="td-mono">${esc(String(t.id).slice(0, 8))}</td>
          <td>${esc(t.cliente)}</td>
          <td>${esc(t.experiencia)}</td>
          <td>${esc(data(t.created_at))}</td>
          <td>${esc(METODO[t.method] || t.method)}</td>
          <td>${esc(brl(t.amount_cents))}</td>
          <td>${badge(BADGE_PAGAMENTO, t.status)}</td>
        </tr>`).join("");
  }
  $("filter-busca")?.addEventListener("input", renderFaturamento);

  ["filter-status", "filter-dias"].forEach((id) => $(id)?.addEventListener("change", carregarFaturamento));

  /* Exportação CSV gerada no navegador a partir do que está na tela.
     Campos entre aspas e aspas internas duplicadas (RFC 4180). E
     neutraliza fórmula: célula começando com = + - @ vira texto, senão
     o Excel executaria (CSV injection). */
  $("btn-exportar")?.addEventListener("click", () => {
    const exportar = transacoesFiltradas();
    if (!exportar.length) return aviso("Nada para exportar no filtro atual.");
    const celula = (v) => {
      let s = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const linhas = [["id", "cliente", "email", "experiencia", "data", "metodo", "valor", "status"]]
      .concat(exportar.map((t) => [
        t.id, t.cliente, t.cliente_email, t.experiencia,
        new Date(t.created_at).toISOString(), t.method,
        (t.amount_cents / 100).toFixed(2).replace(".", ","), t.status,
      ]));
    const csv = "\uFEFF" + linhas.map((l) => l.map(celula).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), {
      href: url, download: `aquatrip-transacoes-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });

  /* ============================================================
     ATENDIMENTO — solicitações LGPD e mensagens de contato
     ============================================================ */
  const TIPO_LGPD = {
    ACCESS: "Acesso aos dados", PORTABILITY: "Portabilidade", CORRECTION: "Correção",
    DELETION: "Eliminação", ANONYMIZATION: "Anonimização", INFO_SHARING: "Compartilhamento",
  };
  const SITUACAO = { OPEN: ["badge-warning", "Aberta"], IN_PROGRESS: ["badge-info", "Em análise"],
                     DONE: ["badge-success", "Concluída"], REJECTED: ["badge-danger", "Recusada"] };

  function prazoTexto(r) {
    if (r.status === "DONE" || r.status === "REJECTED") return "encerrada em " + data(r.resolved_at);
    if (r.dias_restantes < 0) return `ATRASADA há ${Math.abs(r.dias_restantes)} dia(s)`;
    return `${r.dias_restantes} dia(s) para o prazo`;
  }

  function renderSolicitacoes(lista) {
    const ul = $("lgpd-lista");
    if (!lista.length) { ul.innerHTML = '<li class="td-empty">Nenhuma solicitação.</li>'; return; }
    ul.innerHTML = lista.map((r) => {
      const aberta = r.status === "OPEN" || r.status === "IN_PROGRESS";
      const podeAnonimizar = ["DELETION", "ANONYMIZATION"].includes(r.kind) && !r.anonymized_at;
      const atrasada = aberta && r.dias_restantes < 0;
      return `<li class="req${atrasada ? " req--late" : ""}">
        <div class="req-head">
          <strong>${esc(TIPO_LGPD[r.kind] || r.kind)}</strong>
          ${badge(SITUACAO, r.status)}
        </div>
        <p class="req-meta">${esc(r.user_name)} · ${esc(r.user_email)} · aberta em ${esc(data(r.created_at))}
          · <span class="${atrasada ? "req-late-txt" : ""}">${esc(prazoTexto(r))}</span></p>
        ${r.details ? `<blockquote class="req-body">${esc(r.details)}</blockquote>` : ""}
        ${r.response ? `<p class="req-answer"><strong>Resposta:</strong> ${esc(r.response)}</p>` : ""}
        ${aberta ? `
        <form class="req-form" data-solicitacao="${esc(r.id)}">
          <label>Resposta ao titular
            <textarea name="resposta" maxlength="4000" placeholder="O que foi feito, ou o motivo legal da recusa."></textarea>
          </label>
          ${podeAnonimizar ? `
          <label class="check-inline">
            <input type="checkbox" name="anonimizar">
            Anonimizar a conta (remove nome, e-mail e diário; mantém pagamentos sem identificação, como exige a lei)
          </label>` : ""}
          <div class="req-actions">
            ${r.status === "OPEN" ? '<button type="submit" class="btn btn-sm" value="IN_PROGRESS">Marcar em análise</button>' : ""}
            <button type="submit" class="btn btn-sm btn-primary" value="DONE">Concluir e responder</button>
            <button type="submit" class="btn btn-sm btn-danger" value="REJECTED">Recusar com justificativa</button>
          </div>
        </form>` : ""}
      </li>`;
    }).join("");
  }

  function renderContatos(lista) {
    const ul = $("contato-lista");
    const visiveis = lista.filter((c) => c.status !== "ARCHIVED");
    if (!visiveis.length) { ul.innerHTML = '<li class="td-empty">Nenhuma mensagem.</li>'; return; }
    ul.innerHTML = visiveis.map((c) => `
      <li class="req${c.status === "NEW" ? " req--new" : ""}">
        <div class="req-head">
          <strong>${esc(c.company || c.name)}</strong>
          ${c.status === "NEW" ? '<span class="badge badge-warning">Nova</span>' : '<span class="badge badge-info">Lida</span>'}
        </div>
        <p class="req-meta">${esc(c.name)} · ${esc(c.email)}${c.region ? " · " + esc(c.region) : ""} · ${esc(data(c.created_at))}</p>
        <blockquote class="req-body">${esc(c.message)}</blockquote>
        <div class="req-actions">
          <a class="btn btn-sm btn-primary" href="mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent("AquaTrip: sua mensagem")}"
             data-marcar-lida="${esc(c.id)}">Responder por e-mail</a>
          ${c.status === "NEW" ? `<button type="button" class="btn btn-sm" data-contato="${esc(c.id)}" data-status="READ">Marcar como lida</button>` : ""}
          <button type="button" class="btn btn-sm" data-contato="${esc(c.id)}" data-status="ARCHIVED">Arquivar</button>
        </div>
      </li>`).join("");
  }

  function atualizarBadge(ct) {
    const b = $("badge-atendimento");
    if (!b) return;
    const n = ct.contatos_novos + ct.lgpd_abertas + (ct.fotos_pendentes || 0);
    b.textContent = n;
    b.hidden = n === 0;
    b.classList.toggle("nav-badge--late", ct.lgpd_atrasadas > 0);
  }

  function renderAvaliacoes(lista) {
    const ul = $("avaliacoes-lista");
    if (!ul) return;
    if (!lista.length) { ul.innerHTML = '<li class="td-empty">Nenhuma avaliação ainda.</li>'; return; }
    ul.innerHTML = lista.map((a) => `
      <li class="req${a.status === "HIDDEN" ? " req--late" : ""}">
        <div class="req-head">
          <strong>${"★".repeat(a.rating)}${"☆".repeat(5 - a.rating)} · ${esc(a.experiencia)}</strong>
          ${a.status === "HIDDEN" ? '<span class="badge badge-danger">Oculta</span>' : '<span class="badge badge-success">Pública</span>'}
        </div>
        <p class="req-meta">${esc(a.autor)} · ${esc(a.autor_email)} · ${esc(data(a.created_at))}</p>
        ${a.title || a.body ? `<blockquote class="req-body">${a.title ? "<strong>" + esc(a.title) + "</strong>\n" : ""}${esc(a.body || "")}</blockquote>` : ""}
        ${a.status === "HIDDEN" ? `<p class="req-answer"><strong>Motivo:</strong> ${esc(a.hidden_reason)}</p>` : ""}
        <div class="req-actions">
          ${a.status === "HIDDEN"
            ? `<button type="button" class="btn btn-sm" data-avaliacao="${esc(a.id)}" data-ocultar="0">Tornar pública</button>`
            : `<button type="button" class="btn btn-sm btn-danger" data-avaliacao="${esc(a.id)}" data-ocultar="1">Ocultar por violação</button>`}
        </div>
      </li>`).join("");
  }

  $("avaliacoes-lista")?.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-avaliacao]");
    if (!b) return;
    const ocultar = b.dataset.ocultar === "1";
    let motivo = null;
    if (ocultar) {
      motivo = window.prompt("Qual regra esta avaliação viola? (mínimo 10 caracteres, fica registrado)");
      if (motivo === null) return;
    }
    try {
      await api("POST", `/api/admin/avaliacoes/${encodeURIComponent(b.dataset.avaliacao)}`, { ocultar, motivo });
      carregarAtendimento();
    } catch (e) { aviso(e.message); }
  });

  let motivosRecusa = {};

  function renderFotos(lista) {
    const ul = $("fotos-fila");
    if (!ul) return;
    $("fotos-resumo").textContent = `${lista.length} na fila`;
    if (!lista.length) { ul.innerHTML = '<li class="td-empty">Nenhuma foto aguardando revisão.</li>'; return; }
    const opcoes = Object.entries(motivosRecusa)
      .map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
    ul.innerHTML = lista.map((f) => `
      <li class="mod-item">
        <a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt="Foto enviada por ${esc(f.autor || "usuário")}"></a>
        <p class="req-meta">${esc(f.experiencia || "-")}<br>${esc(f.autor || "-")} · ${esc(data(f.created_at))}</p>
        <div class="req-actions">
          <button type="button" class="btn btn-sm btn-primary" data-moderar="${esc(f.id)}" data-aprovar="1">Aprovar</button>
          <select aria-label="Motivo da recusa" data-motivo-de="${esc(f.id)}"><option value="">Recusar por...</option>${opcoes}</select>
        </div>
      </li>`).join("");
  }

  async function moderarFoto(id, aprovar, motivo) {
    try {
      await api("POST", `/api/admin/moderacao/fotos/${encodeURIComponent(id)}`, { aprovar, motivo });
      carregarAtendimento();
    } catch (e) { aviso(e.message); }
  }

  $("fotos-fila")?.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-moderar]");
    if (b) { b.disabled = true; moderarFoto(b.dataset.moderar, true, null); }
  });
  $("fotos-fila")?.addEventListener("change", (ev) => {
    const s = ev.target.closest("[data-motivo-de]");
    if (!s || !s.value) return;
    if (!window.confirm(`Recusar esta foto por "${motivosRecusa[s.value]}"? O arquivo será apagado e o autor avisado.`)) { s.value = ""; return; }
    s.disabled = true;
    moderarFoto(s.dataset.motivoDe, false, s.value);
  });

  async function carregarAtendimento() {
    api("GET", "/api/admin/avaliacoes").then((r) => renderAvaliacoes(r.avaliacoes)).catch(() => {});
    api("GET", "/api/admin/moderacao/fotos").then((r) => { motivosRecusa = r.motivos; renderFotos(r.fotos); }).catch(() => {});
    try {
      const d = await api("GET", "/api/admin/atendimento");
      renderSolicitacoes(d.solicitacoes);
      renderContatos(d.contatos);
      atualizarBadge(d.contadores);
      $("lgpd-resumo").textContent = `${d.contadores.lgpd_abertas} aberta(s)` +
        (d.contadores.lgpd_atrasadas ? ` · ${d.contadores.lgpd_atrasadas} atrasada(s)` : "");
      $("contato-resumo").textContent = `${d.contadores.contatos_novos} nova(s)`;
    } catch (e) {
      aviso("Atendimento: " + e.message);
    }
  }

  $("lgpd-lista")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target.closest("[data-solicitacao]");
    const status = ev.submitter?.value;
    if (!form || !status) return;
    const campos = form.elements; // padrão (form.x é atalho legado)
    const anonimizar = Boolean(campos.anonimizar && campos.anonimizar.checked);
    if (anonimizar && !window.confirm(
      "Anonimizar é IRREVERSÍVEL: nome, e-mail e diário do titular serão apagados e ele não poderá mais entrar. Continuar?")) return;

    ev.submitter.disabled = true;
    try {
      await api("POST", `/api/admin/solicitacoes/${encodeURIComponent(form.dataset.solicitacao)}`,
        { status, resposta: campos.resposta.value, anonimizar });
      aviso(status === "IN_PROGRESS" ? "Marcada como em análise." : "Solicitação encerrada e titular avisado por e-mail.");
      carregarAtendimento();
    } catch (e) {
      aviso(e.message);
      ev.submitter.disabled = false;
    }
  });

  $("contato-lista")?.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-contato]");
    const resp = ev.target.closest("[data-marcar-lida]");
    const id = btn ? btn.dataset.contato : resp ? resp.dataset.marcarLida : null;
    if (!id) return;
    const status = btn ? btn.dataset.status : "READ";
    try {
      await api("POST", `/api/admin/contatos/${encodeURIComponent(id)}/status`, { status });
      if (btn) carregarAtendimento();
    } catch (e) { aviso(e.message); }
  });

  /* ============================================================
     PARCEIROS (marketplace, fase 1)
     ============================================================ */
  const SIT_PARC = { PENDING: ["badge-warning", "Aguardando análise"], APPROVED: ["badge-success", "Aprovado"],
                     SUSPENDED: ["badge-danger", "Suspenso"], REJECTED: ["badge-info", "Recusado"] };
  let parcMotivos = { recusa: {}, suspensao: {} };

  function opcoes(obj) {
    return Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
  }

  function renderParceiros(lista) {
    const ul = $("parc-lista");
    const pend = lista.filter((p) => p.status === "PENDING").length;
    const b = $("badge-parceiros");
    if (b && !$("parc-status").value) { b.textContent = pend; b.hidden = pend === 0; }
    if (!lista.length) { ul.innerHTML = '<li class="td-empty">Nenhum parceiro nesta situação.</li>'; return; }
    ul.innerHTML = lista.map((p) => `
      <li class="req${p.status === "PENDING" ? " req--new" : ""}">
        <div class="req-head">
          <strong>${esc(p.display_name)}</strong>
          ${badge(SIT_PARC, p.status)}
        </div>
        <p class="req-meta">
          ${esc(p.legal_name)} · ${esc(p.person_type === "PJ" ? "CNPJ" : "CPF")} ${esc(p.documento_formatado)}<br>
          ${esc(p.city)}/${esc(p.state)} · ${esc(p.phone)} · conta: ${esc(p.email)} · desde ${esc(data(p.created_at))}
          ${p.status !== "PENDING" ? ` · comissão ${esc(Number(p.commission_pct))}% · ${esc(p.experiencias)} experiência(s)` : ""}
        </p>
        ${p.description ? `<blockquote class="req-body">${esc(p.description)}</blockquote>` : ""}
        <div class="req-actions">
          ${p.status === "PENDING" ? `
            <label class="parc-comissao">Comissão
              <input type="number" min="0" max="50" step="0.5" value="${esc(Number(p.commission_pct))}" data-comissao="${esc(p.id)}"> %
            </label>
            <button type="button" class="btn btn-sm btn-primary" data-parc="${esc(p.id)}" data-acao="aprovar">Aprovar</button>
            <select aria-label="Recusar por" data-parc-motivo="${esc(p.id)}" data-acao="recusar">
              <option value="">Recusar por...</option>${opcoes(parcMotivos.recusa)}</select>` : ""}
          ${p.status === "APPROVED" ? `
            <select aria-label="Suspender por" data-parc-motivo="${esc(p.id)}" data-acao="suspender">
              <option value="">Suspender por...</option>${opcoes(parcMotivos.suspensao)}</select>` : ""}
          ${p.status === "SUSPENDED" ? `<button type="button" class="btn btn-sm" data-parc="${esc(p.id)}" data-acao="reativar">Reativar</button>` : ""}
        </div>
      </li>`).join("");
  }

  let revMotivos = {};
  async function carregarRevisao() {
    try {
      const d = await api("GET", "/api/admin/revisao/experiencias");
      revMotivos = d.motivos;
      $("rev-resumo").textContent = `${d.experiencias.length} na fila`;
      $("rev-lista").innerHTML = d.experiencias.length ? d.experiencias.map((x) => `
        <li class="req req--new">
          <div class="req-head"><strong>${esc(x.title)}</strong><span class="td-mono">${esc(x.parceiro)}</span></div>
          <p class="req-meta">${esc(x.location || "")} · ${esc(x.category)} · ${esc(brl(x.price_cents))} · enviada em ${esc(data(x.submitted_at))}</p>
          <blockquote class="req-body">${esc(x.description || "(sem descrição)")}</blockquote>
          <div class="req-actions">
            <button type="button" class="btn btn-sm btn-primary" data-rev="${esc(x.id)}">Aprovar</button>
            <select aria-label="Recusar por" data-rev-motivo="${esc(x.id)}"><option value="">Recusar por...</option>${opcoes(revMotivos)}</select>
          </div>
        </li>`).join("") : '<li class="td-empty">Nenhuma experiência aguardando revisão.</li>';
    } catch (e) { aviso("Revisão: " + e.message); }
  }
  async function decidirRevisao(id, aprovar, motivo) {
    try {
      await api("POST", `/api/admin/revisao/experiencias/${encodeURIComponent(id)}`, { aprovar, motivo });
      aviso(aprovar ? "Experiência aprovada. O parceiro foi avisado." : "Recusada. O parceiro recebeu o motivo.");
    } catch (e) { aviso(e.message); }
    carregarRevisao();
  }
  $("rev-lista")?.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-rev]");
    if (b) { b.disabled = true; decidirRevisao(b.dataset.rev, true, null); }
  });
  $("rev-lista")?.addEventListener("change", (ev) => {
    const s = ev.target.closest("[data-rev-motivo]");
    if (!s || !s.value) return;
    if (!window.confirm(`Recusar por "${s.options[s.selectedIndex].text}"?`)) { s.value = ""; return; }
    s.disabled = true;
    decidirRevisao(s.dataset.revMotivo, false, s.value);
  });

  async function carregarParceiros() {
    carregarRevisao();
    try {
      const qs = $("parc-status").value ? "?status=" + encodeURIComponent($("parc-status").value) : "";
      const d = await api("GET", "/api/admin/parceiros" + qs);
      parcMotivos = { recusa: d.motivosRecusa, suspensao: d.motivosSuspensao };
      renderParceiros(d.parceiros);
    } catch (e) { aviso("Parceiros: " + e.message); }
  }
  $("parc-status")?.addEventListener("change", carregarParceiros);

  async function decidirParceiro(id, acao, motivo) {
    const campo = document.querySelector(`[data-comissao="${CSS.escape(id)}"]`);
    try {
      await api("POST", `/api/admin/parceiros/${encodeURIComponent(id)}/decisao`,
        { acao, motivo, comissao: campo ? Number(campo.value) : null });
      aviso("Decisão registrada. O parceiro foi avisado por e-mail.");
      carregarParceiros();
    } catch (e) { aviso(e.message); carregarParceiros(); }
  }
  $("parc-lista")?.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-parc]");
    if (b) { b.disabled = true; decidirParceiro(b.dataset.parc, b.dataset.acao, null); }
  });
  $("parc-lista")?.addEventListener("change", (ev) => {
    const s = ev.target.closest("[data-parc-motivo]");
    if (!s || !s.value) return;
    const rotulo = s.options[s.selectedIndex].text;
    const verbo = s.dataset.acao === "recusar" ? "Recusar" : "Suspender";
    if (!window.confirm(`${verbo} por "${rotulo}"? O parceiro recebe o motivo por e-mail.`)) { s.value = ""; return; }
    s.disabled = true;
    decidirParceiro(s.dataset.parcMotivo, s.dataset.acao, s.value);
  });

  /* ============================================================
     UTILITÁRIOS NOVOS: contador no menu e diálogo de motivo
     ============================================================ */
  function badgeNum(id, n) {
    const b = $(id);
    if (b) { b.textContent = n; b.hidden = !Number(n); }
  }

  /** Abre o diálogo de motivo e devolve o texto (ou null se cancelar). */
  function pedirMotivo(titulo, quem, rotuloBotao) {
    const dlg = $("motivo-modal");
    $("motivo-title").textContent = titulo;
    $("motivo-quem").textContent = quem || "";
    $("motivo-texto").value = "";
    $("motivo-erro").hidden = true;
    $("motivo-confirmar").querySelector("span").textContent = rotuloBotao || "Confirmar";
    dlg.showModal();
    $("motivo-texto").focus();
    return new Promise((resolve) => {
      const fim = (valor) => {
        $("motivo-form").removeEventListener("submit", ok);
        $("motivo-cancelar").removeEventListener("click", cancelar);
        dlg.removeEventListener("close", fechou);
        if (dlg.open) dlg.close();
        resolve(valor);
      };
      const ok = (ev) => {
        ev.preventDefault();
        const m = $("motivo-texto").value.trim();
        if (m.length < 5) { $("motivo-erro").textContent = "Descreva o motivo (mínimo 5 caracteres)."; $("motivo-erro").hidden = false; return; }
        fim(m);
      };
      const cancelar = () => fim(null);
      const fechou = () => fim(null);
      $("motivo-form").addEventListener("submit", ok);
      $("motivo-cancelar").addEventListener("click", cancelar);
      dlg.addEventListener("close", fechou);
    });
  }

  /* ============================================================
     PERFIL COMPLETO DO USUÁRIO (LGPD: acesso auditado no servidor)
     ============================================================ */
  // Horários de experiência são do fuso de operação, não do navegador de quem modera.
  const FUSO_OP = "America/Sao_Paulo";
  const STATUS_MOD = { ACTIVE: ["badge-success", "Ativa"], SUSPENDED: ["badge-warning", "Suspensa"], BANNED: ["badge-danger", "Banida"] };
  const STATUS_USR = { ACTIVE: ["badge-success", "Ativo"], SUSPENDED: ["badge-warning", "Suspenso"], BANNED: ["badge-danger", "Banido"] };

  async function abrirPerfil(id) {
    const dlg = $("user-modal");
    const corpo = $("user-modal-corpo");
    corpo.textContent = "Carregando...";
    dlg.showModal();
    try {
      const { usuario: u } = await api("GET", `/api/admin/usuarios/${encodeURIComponent(id)}`);
      const doc = u.document
        ? (u.person_type === "PF" ? String(u.document).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : u.document)
        : "Não informado (só existe no cadastro de parceiro)";
      const linha = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
      corpo.innerHTML = `
        <dl class="adm-dl">
          ${linha("Nome", esc(u.name))}
          ${linha("E-mail", esc(u.email) + (u.email_verified_at ? ' <span class="badge badge-success">verificado</span>' : ' <span class="badge badge-warning">não verificado</span>'))}
          ${linha(u.person_type === "PJ" ? "CNPJ" : "CPF", esc(doc))}
          ${linha("Situação", badge(STATUS_USR, u.status) + (u.suspended_reason ? " " + esc(u.suspended_reason) : ""))}
          ${linha("Papel", esc(u.role))}
          ${linha("Cadastro", esc(data(u.created_at)))}
          ${linha("Último login", esc(u.last_login_at ? new Date(u.last_login_at).toLocaleString("pt-BR", { timeZone: FUSO_OP }) : "-"))}
          ${linha("Presença", u.online ? '<span class="live-dot"></span> Online agora' : esc(u.last_seen_at ? "Visto em " + new Date(u.last_seen_at).toLocaleString("pt-BR", { timeZone: FUSO_OP }) : "-"))}
          ${linha("2FA", u.mfa ? "Ativo" : "Inativo")}
          ${linha("Termos aceitos", esc(u.terms_version ? `v${u.terms_version} em ${data(u.terms_accepted_at)}` : "-"))}
          ${linha("Parceiro", u.parceiro_status ? `${esc(u.parceiro_nome)} (${esc(u.parceiro_status)}) · ${esc(u.city || "")}/${esc(u.state || "")} · tel. ${esc(u.phone || "-")}` : "Não")}
          ${linha("Reservas confirmadas", esc(u.reservas_confirmadas))}
          ${linha("Seguidores / seguindo", `${esc(u.seguidores)} / ${esc(u.seguindo)}`)}
          ${linha("Comentários feitos", esc(u.comentarios_feitos))}
          ${linha("Denúncias recebidas", esc(u.denuncias_recebidas))}
          ${u.bio ? linha("Bio", esc(u.bio)) : ""}
        </dl>
        <h3 class="adm-h3">Experiências criadas (${u.experiencias.length})</h3>
        ${u.experiencias.length ? `<ul class="adm-mini-list">${u.experiencias.map((e) => `<li>${badge(STATUS_MOD, e.moderation_status)} <a href="/reservar/${encodeURIComponent(e.slug)}" target="_blank" rel="noopener">${esc(e.title)}</a> · ${esc(e.location || "")} · ${esc(e.starts_at ? data(e.starts_at) : "-")} · ${e.price_cents ? esc(brl(e.price_cents)) : "Gratuita"}</li>`).join("")}</ul>` : '<p class="form-hint">Nenhuma.</p>'}`;
      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      corpo.textContent = e.message;
    }
  }
  $("user-modal-fechar")?.addEventListener("click", () => $("user-modal").close());

  /* ============================================================
     MODERAÇÃO DA COMUNIDADE
     ============================================================ */
  let comTimer = null;
  async function carregarComunidade() {
    const lista = $("com-lista");
    const q = new URLSearchParams();
    const busca = ($("com-busca")?.value || "").trim();
    if (busca) q.set("busca", busca);
    if ($("com-status")?.value) q.set("status", $("com-status").value);
    if ($("com-denuncias")?.checked) q.set("denuncias", "1");
    try {
      const { experiencias } = await api("GET", "/api/admin/comunidade?" + q.toString());
      $("com-contagem").textContent = `${experiencias.length} experiência(s)`;
      if (!experiencias.length) { lista.innerHTML = '<li class="req">Nenhuma experiência da comunidade com esse filtro.</li>'; return; }
      lista.innerHTML = experiencias.map((e) => `
        <li class="req ${e.denuncias_abertas ? "req--late" : ""}">
          <div class="req-head">
            <strong><a href="/reservar/${encodeURIComponent(e.slug)}" target="_blank" rel="noopener">${esc(e.title)}</a></strong>
            <span>${e.origem === "parceiro" ? '<span class="badge badge-info">Parceiro</span>' : '<span class="badge badge-info">Comunidade</span>'} ${badge(STATUS_MOD, e.moderation_status)} ${e.active ? "" : '<span class="badge badge-info">Pausada</span>'}</span>
          </div>
          <p class="req-meta">
            ${e.origem === "parceiro" ? `Parceiro: <strong>${esc(e.parceiro_nome || "")}</strong> · ` : ""}Criador: <button type="button" class="link-btn" data-perfil-com="${esc(e.criador_id)}">${esc(e.criador_nome)}</button> (${esc(e.criador_email)})${e.criador_status !== "ACTIVE" ? " · conta " + esc(e.criador_status) : ""}
            · ${esc(e.location || "")} · ${esc(e.starts_at ? new Date(e.starts_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: FUSO_OP }) : "-")}
          </p>
          <p class="req-meta">
            Valor: <strong>${e.price_cents ? esc(brl(e.price_cents)) : "Gratuita"}</strong> · Vagas: ${esc(e.capacity ?? "-")} · Participantes: ${esc(e.participantes)} · Interessados: ${esc(e.interessados)}
            · ${esc(e.curtidas)} curtidas · ${esc(e.comentarios)} comentários
            · <strong${e.denuncias_abertas ? ' class="req-late-txt"' : ""}>Denúncias: ${esc(e.denuncias_abertas)} abertas / ${esc(e.denuncias_total)}</strong>
          </p>
          ${e.moderation_reason ? `<p class="req-answer"><strong>Motivo da moderação:</strong> ${esc(e.moderation_reason)}${e.moderated_at ? " · " + esc(data(e.moderated_at)) : ""}</p>` : ""}
          <div class="req-actions">
            <button type="button" class="btn btn-sm" data-com-det="${esc(e.id)}" data-titulo="${esc(e.title)}">Denúncias e comentários</button>
            ${e.moderation_status !== "ACTIVE" ? `<button type="button" class="btn btn-sm" data-com-mod="ACTIVE" data-id="${esc(e.id)}">Reativar</button>` : ""}
            ${e.moderation_status !== "SUSPENDED" ? `<button type="button" class="btn btn-sm btn-danger" data-com-mod="SUSPENDED" data-id="${esc(e.id)}" data-titulo="${esc(e.title)}">Suspender</button>` : ""}
            ${e.moderation_status !== "BANNED" ? `<button type="button" class="btn btn-sm btn-danger" data-com-mod="BANNED" data-id="${esc(e.id)}" data-titulo="${esc(e.title)}">Banir</button>` : ""}
            ${e.denuncias_abertas ? `<button type="button" class="btn btn-sm" data-com-arq="${esc(e.id)}">Arquivar denúncias</button>` : ""}
          </div>
        </li>`).join("");
    } catch (e) {
      lista.innerHTML = `<li class="req">Não foi possível carregar: ${esc(e.message)}</li>`;
    }
  }
  $("com-busca")?.addEventListener("input", () => { clearTimeout(comTimer); comTimer = setTimeout(carregarComunidade, 300); });
  $("com-status")?.addEventListener("change", carregarComunidade);
  $("com-denuncias")?.addEventListener("change", carregarComunidade);

  $("com-lista")?.addEventListener("click", async (ev) => {
    const perfil = ev.target.closest("[data-perfil-com]");
    if (perfil) return abrirPerfil(perfil.dataset.perfilCom);
    const det = ev.target.closest("[data-com-det]");
    if (det) return abrirDetalhe(det.dataset.comDet, det.dataset.titulo);
    const arq = ev.target.closest("[data-com-arq]");
    if (arq) {
      if (!window.confirm("Arquivar as denúncias abertas sem mudar a experiência?")) return;
      try { await api("POST", `/api/admin/comunidade/${encodeURIComponent(arq.dataset.comArq)}/denuncias/arquivar`); aviso("Denúncias arquivadas."); carregarComunidade(); }
      catch (e) { aviso(e.message); }
      return;
    }
    const mod = ev.target.closest("[data-com-mod]");
    if (!mod) return;
    const status = mod.dataset.comMod;
    let motivo = null;
    if (status !== "ACTIVE") {
      motivo = await pedirMotivo(status === "BANNED" ? "Banir experiência" : "Suspender experiência", mod.dataset.titulo,
        status === "BANNED" ? "Banir" : "Suspender");
      if (!motivo) return;
    } else if (!window.confirm("Reativar esta experiência? Ela volta a aparecer para o público.")) return;
    try {
      await api("POST", `/api/admin/comunidade/${encodeURIComponent(mod.dataset.id)}/moderar`, { status, motivo });
      aviso(status === "ACTIVE" ? "Experiência reativada." : "Decisão registrada. A experiência saiu do ar.");
      carregarComunidade();
    } catch (e) { aviso(e.message); }
  });

  const MOTIVO_DEN = { GOLPE: "Golpe/cobrança enganosa", INFORMACAO_FALSA: "Informação falsa", CONTEUDO_IMPROPRIO: "Conteúdo impróprio", PERIGOSO: "Perigosa/sem segurança", CONTATO_EXTERNO: "Contato/pagamento por fora", OUTRO: "Outro" };
  let detalheId = null;
  async function abrirDetalhe(id, titulo) {
    detalheId = id;
    const dlg = $("exp-modal");
    $("exp-modal-title").textContent = titulo || "Denúncias e comentários";
    const corpo = $("exp-modal-corpo");
    corpo.textContent = "Carregando...";
    if (!dlg.open) dlg.showModal();
    try {
      const d = await api("GET", `/api/admin/comunidade/${encodeURIComponent(id)}`);
      corpo.innerHTML = `
        <h3 class="adm-h3">Denúncias (${d.denuncias.length})</h3>
        ${d.denuncias.length ? `<ul class="adm-mini-list">${d.denuncias.map((r) => `<li><span class="badge ${r.status === "OPEN" ? "badge-danger" : "badge-info"}">${esc(r.status === "OPEN" ? "Aberta" : r.status === "RESOLVED" ? "Procedente" : "Arquivada")}</span> <strong>${esc(MOTIVO_DEN[r.reason] || r.reason)}</strong> · ${esc(r.denunciante)} · ${esc(data(r.created_at))}${r.details ? `<br><span class="form-hint">${esc(r.details)}</span>` : ""}</li>`).join("")}</ul>` : '<p class="form-hint">Nenhuma denúncia.</p>'}
        <h3 class="adm-h3">Comentários (${d.comentarios.length})</h3>
        ${d.comentarios.length ? `<ul class="adm-mini-list">${d.comentarios.map((c) => `<li>${c.status === "HIDDEN" ? '<span class="badge badge-warning">Oculto</span> ' : ""}<strong>${esc(c.autor)}</strong> · ${esc(data(c.created_at))}<br>${esc(c.body)}${c.hidden_reason ? `<br><span class="form-hint">Motivo: ${esc(c.hidden_reason)}</span>` : ""}
          <br><button type="button" class="btn btn-sm${c.status === "HIDDEN" ? "" : " btn-danger"}" data-coment="${esc(c.id)}" data-ocultar="${c.status === "HIDDEN" ? "0" : "1"}">${c.status === "HIDDEN" ? "Mostrar de novo" : "Ocultar"}</button></li>`).join("")}</ul>` : '<p class="form-hint">Nenhum comentário.</p>'}`;
    } catch (e) { corpo.textContent = e.message; }
  }
  $("exp-modal-fechar")?.addEventListener("click", () => $("exp-modal").close());
  $("exp-modal-corpo")?.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-coment]");
    if (!b) return;
    const ocultar = b.dataset.ocultar === "1";
    let motivo = null;
    if (ocultar) {
      $("exp-modal").close();
      motivo = await pedirMotivo("Ocultar comentário", "O comentário deixa de aparecer na página.", "Ocultar");
      if (!motivo) return abrirDetalhe(detalheId);
    }
    try {
      await api("POST", `/api/admin/comentarios/${encodeURIComponent(b.dataset.coment)}`, { ocultar, motivo });
      aviso(ocultar ? "Comentário ocultado." : "Comentário visível de novo.");
    } catch (e) { aviso(e.message); }
    abrirDetalhe(detalheId);
  });

  /* ============================================================
     RECLAMAÇÕES, SUGESTÕES E AVALIAÇÕES DO AQUATRIP
     ============================================================ */
  const TIPO_FB = { COMPLAINT: ["badge-danger", "Reclamação"], SUGGESTION: ["badge-info", "Sugestão"], RATING: ["badge-success", "Avaliação"] };
  const STATUS_FB = { OPEN: ["badge-warning", "Aberta"], IN_PROGRESS: ["badge-info", "Em andamento"], RESOLVED: ["badge-success", "Resolvida"], CLOSED: ["badge-info", "Encerrada"] };
  async function carregarFeedback() {
    const lista = $("fb-lista");
    const q = new URLSearchParams();
    if ($("fb-status")?.value) q.set("status", $("fb-status").value);
    if ($("fb-tipo")?.value) q.set("tipo", $("fb-tipo").value);
    try {
      const { itens, resumo } = await api("GET", "/api/admin/feedback?" + q.toString());
      $("fb-abertas").textContent = resumo.reclamacoes_abertas;
      $("fb-avaliacoes").textContent = resumo.avaliacoes;
      $("fb-nota").textContent = resumo.nota_media != null ? String(resumo.nota_media).replace(".", ",") + " ★" : "-";
      badgeNum("badge-reclamacoes", resumo.reclamacoes_abertas);
      if (!itens.length) { lista.innerHTML = '<li class="req">Nada por aqui com esse filtro.</li>'; return; }
      lista.innerHTML = itens.map((f) => `
        <li class="req ${f.status === "OPEN" ? "req--new" : ""}">
          <div class="req-head"><strong>${esc(f.subject)}${f.rating ? " · " + "★".repeat(f.rating) : ""}</strong><span>${badge(TIPO_FB, f.kind)} ${badge(STATUS_FB, f.status)}</span></div>
          <p class="req-meta">${f.user_id ? `<button type="button" class="link-btn" data-perfil-fb="${esc(f.user_id)}">${esc(f.user_name)}</button> · ${esc(f.user_email)}` : "Conta removida"} · ${esc(data(f.created_at))}</p>
          <blockquote class="req-body">${esc(f.message)}</blockquote>
          ${f.admin_response ? `<p class="req-answer"><strong>Resposta${f.respondido_por ? " de " + esc(f.respondido_por) : ""}:</strong> ${esc(f.admin_response)}</p>` : ""}
          <form class="req-form" data-fb="${esc(f.id)}" novalidate data-fk-busy="off">
            <label>Resposta para a pessoa (aparece na página dela)
              <textarea name="resposta" maxlength="2000" data-counter placeholder="${f.admin_response ? "Enviar nova resposta (substitui a anterior)" : "Escreva a resposta"}"></textarea>
            </label>
            <div class="req-actions">
              <label class="sr-only" for="fbst-${esc(f.id)}">Status</label>
              <select name="status" id="fbst-${esc(f.id)}">
                ${Object.keys(STATUS_FB).map((k) => `<option value="${k}"${k === f.status ? " selected" : ""}>${STATUS_FB[k][1]}</option>`).join("")}
              </select>
              <button type="submit" class="btn btn-primary btn-sm"><span>Salvar</span></button>
            </div>
          </form>
        </li>`).join("");
      if (window.AQForm) window.AQForm.preparar(lista);
    } catch (e) {
      lista.innerHTML = `<li class="req">Não foi possível carregar: ${esc(e.message)}</li>`;
    }
  }
  $("fb-status")?.addEventListener("change", carregarFeedback);
  $("fb-tipo")?.addEventListener("change", carregarFeedback);
  $("fb-lista")?.addEventListener("click", (ev) => {
    const p = ev.target.closest("[data-perfil-fb]");
    if (p) abrirPerfil(p.dataset.perfilFb);
  });
  $("fb-lista")?.addEventListener("submit", async (ev) => {
    const form = ev.target.closest("[data-fb]");
    if (!form) return;
    ev.preventDefault();
    const botao = form.querySelector('button[type="submit"]');
    const resposta = form.resposta.value.trim();
    if (window.AQForm) window.AQForm.ocupado(botao, true);
    try {
      await api("POST", `/api/admin/feedback/${encodeURIComponent(form.dataset.fb)}`, { status: form.status.value, resposta: resposta || null });
      aviso("Registro atualizado.");
      carregarFeedback();
    } catch (e) { aviso(e.message); }
    finally { if (window.AQForm) window.AQForm.ocupado(botao, false); }
  });

  carregarSecao("dashboard");
  // Parceiros aguardando análise: contador no menu desde a entrada.
  api("GET", "/api/admin/parceiros?status=PENDING").then((d) => {
    const b = $("badge-parceiros"); if (b) { b.textContent = d.parceiros.length; b.hidden = !d.parceiros.length; }
  }).catch(() => {});
  // Contador do menu desde a entrada: pedido LGPD tem prazo legal.
  api("GET", "/api/admin/atendimento").then((d) => atualizarBadge(d.contadores)).catch(() => {});
})();

/* Ícones do painel (Lucide, servido do próprio domínio) */
if (window.lucide) window.lucide.createIcons();
