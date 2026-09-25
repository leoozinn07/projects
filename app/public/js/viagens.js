/* ==============================================================
   AquaTrip — Diário de viagens
   ==============================================================
   Antes: lia o localStorage e, como nenhuma tela gravava nada ali,
   caía sempre no array DEFAULTS — todo usuário via as mesmas
   viagens inventadas como se fossem dele. Agora cada viagem
   pertence à conta e vem da API.

   Card é <article>, não <a>: ele tem botão de excluir dentro, e
   elemento interativo dentro de link é HTML inválido.
   ============================================================== */
(function () {
  "use strict";

  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const esc = window.escHTML;
  const t = (k, v, padrao) => (window.AQ ? AQ.t(k, v, padrao) : padrao);
  let viagens = [];

  /* ---------- utilitários ---------- */
  function dias(a, b) {
    if (!a || !b) return null;
    return Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000) + 1);
  }
  function mesAno(d) {
    if (!d) return t("viagens_sem_data", null, "Sem data");
    return new Date(String(d).slice(0, 10) + "T12:00:00")
      .toLocaleDateString((window.AQ && window.AQ.intl) || "pt-BR", { month: "short", year: "numeric" });
  }
  function estrelas(n) {
    if (!n) return "";
    const cheias = "★".repeat(n), vazias = "★".repeat(5 - n);
    return `<span class="at-stars" aria-label="${t("viagens_estrelas_aria", { n }, `${n} de 5 estrelas`)}">` +
           `<span class="at-star at-star--on">${cheias}</span>` +
           `<span class="at-star">${vazias}</span></span>`;
  }

  async function api(metodo, url, corpo) {
    const res = await fetch(url, {
      method: metodo,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": CSRF, Accept: "application/json" },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (res.status === 401) { window.location.href = "/login?redirect=/viagens"; return null; }
    if (res.status === 204) return {};
    const dados = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(dados.error || "Não foi possível concluir.");
    return dados;
  }

  /* ---------- render ---------- */
  function render() {
    const timeline = document.getElementById("at-timeline");
    const semDataLbl = t("viagens_sem_data", null, "Sem data");
    const porAno = {};
    viagens.forEach((v) => {
      const ano = v.starts_on ? String(v.starts_on).slice(0, 4) : semDataLbl;
      (porAno[ano] = porAno[ano] || []).push(v);
    });
    const anos = Object.keys(porAno).sort((a, b) => (a === semDataLbl ? 1 : b === semDataLbl ? -1 : b - a));

    if (!anos.length) {
      timeline.innerHTML =
        '<section class="at-empty">' +
        `<p>${t("viagens_vazio_titulo", null, "Seu diário ainda está vazio.")}</p>` +
        `<p>${t("viagens_vazio_texto", null, "Registre os lugares por onde passou. Só você vê.")}</p>` +
        `<button type="button" class="btn-primary" data-open-sheet="tripSheet">${t("viagens_registrar_primeira", null, "Registrar primeira viagem")}</button>` +
        "</section>";
      document.querySelector("#at-timeline [data-open-sheet]")
        ?.addEventListener("click", () => window.aquatripOpenSheet("tripSheet"));
    } else {
      timeline.innerHTML = anos.map((ano) => `
        <section class="at-year-group">
          <h2 class="at-year-label">${esc(ano)}</h2>
          <div class="at-cards">
            ${porAno[ano].map((v) => {
              const d = dias(v.starts_on, v.ends_on);
              const diaLbl = d === 1 ? t("viagens_dia", null, "dia") : t("viagens_dias", null, "dias");
              return `
              <article class="at-card">
                <div class="at-card-body">
                  <div class="at-card-row">
                    <div>
                      <h3 class="at-card-city">${esc(v.place)}</h3>
                      <p class="at-card-country">${esc(v.region || "")}</p>
                    </div>
                    <span class="at-card-date">${esc(mesAno(v.starts_on))}</span>
                  </div>
                  ${v.notes ? `<p class="at-card-desc">${esc(v.notes)}</p>` : ""}
                  ${(v.tags || []).length
                    ? `<ul class="at-card-tags">${v.tags.map((g) => `<li class="at-tag">${esc(g)}</li>`).join("")}</ul>`
                    : ""}
                </div>
                <div class="at-card-footer">
                  ${estrelas(v.rating)}
                  ${d ? `<span class="at-dur">${d} ${diaLbl}</span>` : ""}
                  <button type="button" class="at-del" data-excluir="${esc(v.id)}"
                          aria-label="${t("viagens_excluir_aria", { place: v.place }, `Excluir ${v.place} do diário`)}">${t("viagens_excluir", null, "Excluir")}</button>
                </div>
              </article>`;
            }).join("")}
          </div>
        </section>`).join("");
    }

    const totalDias = viagens.reduce((s, v) => s + (dias(v.starts_on, v.ends_on) || 0), 0);
    const regioes = new Set(viagens.map((v) => v.region).filter(Boolean)).size;
    document.getElementById("s-v").textContent = viagens.length;
    document.getElementById("s-p").textContent = regioes;
    document.getElementById("s-d").textContent = totalDias;
    const destinoLbl = viagens.length === 1 ? t("viagens_destino", null, "destino") : t("viagens_destinos", null, "destinos");
    const regiaoLbl = regioes === 1 ? t("viagens_regiao", null, "região") : t("viagens_regioes", null, "regiões");
    document.getElementById("at-subtitle").textContent = viagens.length
      ? `${viagens.length} ${destinoLbl} · ${regioes} ${regiaoLbl}`
      : t("viagens_nenhuma", null, "Nenhuma viagem registrada");
  }

  /* ---------- carregar ---------- */
  async function carregar() {
    const timeline = document.getElementById("at-timeline");
    timeline.innerHTML = `<section class="at-empty">${t("viagens_carregando", null, "Carregando...")}</section>`;
    try {
      const dados = await api("GET", "/api/viagens");
      if (!dados) return;
      viagens = dados.viagens;
      render();
    } catch (e) {
      timeline.innerHTML =
        `<section class="at-empty">${t("viagens_erro_carregar", null, "Não foi possível carregar seu diário.")} ` +
        `<button type="button" class="btn-ghost" id="recarregar">${t("viagens_tentar_de_novo", null, "Tentar de novo")}</button></section>`;
      document.getElementById("recarregar")?.addEventListener("click", carregar);
    }
  }

  /* ---------- criar ---------- */
  const form = document.getElementById("tripForm");
  const aviso = document.getElementById("tripErro");

  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    aviso.hidden = true;
    const f = new FormData(form);
    const corpo = {
      place: f.get("place"),
      region: f.get("region"),
      startsOn: f.get("startsOn"),
      endsOn: f.get("endsOn"),
      rating: f.get("rating") ? Number(f.get("rating")) : null,
      notes: f.get("notes"),
      tags: String(f.get("tags") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8),
    };
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const dados = await api("POST", "/api/viagens", corpo);
      if (!dados) return;
      viagens.unshift(dados.viagem);
      viagens.sort((a, b) => String(b.starts_on || "").localeCompare(String(a.starts_on || "")));
      render();
      form.reset();
      window.aquatripCloseSheet("tripSheet");
      window.aquatripToast?.(t("viagens_registrada", null, "Viagem registrada no seu diário."));
    } catch (e) {
      aviso.textContent = e.message;
      aviso.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- excluir ---------- */
  document.getElementById("at-timeline")?.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-excluir]");
    if (!btn) return;
    const id = btn.dataset.excluir;
    const trip = viagens.find((v) => v.id === id);
    const confirmMsg = trip
      ? t("viagens_confirmar_excluir", { place: trip.place }, `Excluir "${trip.place}" do seu diário?`)
      : t("viagens_confirmar_excluir_generico", null, 'Excluir "esta viagem" do seu diário?');
    if (!window.confirm(confirmMsg)) return;

    btn.disabled = true;
    try {
      await api("DELETE", `/api/viagens/${encodeURIComponent(id)}`);
      viagens = viagens.filter((v) => v.id !== id);
      render();
      window.aquatripToast?.(t("viagens_excluida", null, "Viagem excluída."));
    } catch (e) {
      btn.disabled = false;
      window.aquatripToast?.(e.message);
    }
  });

  carregar();
})();
