/* ==============================================================
   AquaTrip — Área do parceiro: reservas e vendas (fase 4)
   ============================================================== */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  if (!$("ops-reservas")) return;
  const esc = window.escHTML;
  const brl = (c) => (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const dataHora = (d) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  const data = (d) => new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  let vendasAtuais = [];

  async function get(url) {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Falha ao carregar.");
    return d;
  }
  const vazio = (tbody, cols, msg) => { tbody.innerHTML = `<tr><td colspan="${cols}" class="td-empty">${esc(msg)}</td></tr>`; };

  async function reservas() {
    const tb = $("ops-reservas");
    try {
      const { reservas: rs } = await get(`/api/parceiro/reservas?quando=${encodeURIComponent($("ops-quando").value)}`);
      if (!rs.length) return vazio(tb, 5, "Nenhuma reserva confirmada neste filtro.");
      tb.innerHTML = rs.map((r) => `<tr>
        <td>${esc(dataHora(r.starts_at))}</td><td>${esc(r.experiencia)}</td><td>${esc(r.cliente)}</td>
        <td>${esc(r.quantity)}</td><td class="td-mono">${esc(r.codigo)}</td></tr>`).join("");
    } catch (e) { vazio(tb, 5, e.message); }
  }

  async function vendas() {
    const tb = $("ops-vendas");
    try {
      const d = await get(`/api/parceiro/vendas?dias=${encodeURIComponent($("ops-dias").value)}`);
      vendasAtuais = d.vendas;
      $("ops-bruto").textContent = brl(d.resumo.brutoCents);
      $("ops-comissao").textContent = brl(d.resumo.comissaoCents);
      $("ops-liquido").textContent = brl(d.resumo.liquidoCents);
      $("ops-estornado").textContent = brl(d.resumo.estornadasCents);
      if (!d.vendas.length) return vazio(tb, 6, "Nenhuma venda no período.");
      tb.innerHTML = d.vendas.map((v) => `<tr>
        <td>${esc(data(v.data))}</td><td>${esc(v.experiencia)}</td><td>${esc(brl(v.amount_cents))}</td>
        <td>${esc(brl(v.application_fee_cents))} <small>(${esc(Number(v.commission_pct))}%)</small></td>
        <td>${esc(brl(v.liquido_cents))}</td><td>${v.status === "APPROVED" ? "Paga" : "Estornada"}</td></tr>`).join("");
    } catch (e) { vazio(tb, 6, e.message); }
  }

  // CSV: células começando com = + - @ viram texto (evita fórmula no Excel).
  const celula = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  $("ops-csv").addEventListener("click", () => {
    if (!vendasAtuais.length) return window.alert("Nada para exportar no período.");
    const linhas = [["data", "experiencia", "valor", "comissao_pct", "comissao", "liquido", "situacao"]]
      .concat(vendasAtuais.map((v) => [data(v.data), v.experiencia, (v.amount_cents / 100).toFixed(2),
        Number(v.commission_pct), (v.application_fee_cents / 100).toFixed(2), (v.liquido_cents / 100).toFixed(2),
        v.status === "APPROVED" ? "paga" : "estornada"]));
    const csv = "\uFEFF" + linhas.map((l) => l.map(celula).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `vendas-${$("ops-dias").value}dias.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("ops-quando").addEventListener("change", reservas);
  $("ops-dias").addEventListener("change", vendas);
  reservas();
  vendas();
})();
