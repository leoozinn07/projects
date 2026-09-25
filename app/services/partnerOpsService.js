/* ==============================================================
   AquaTrip — Operação do parceiro (marketplace, fase 4)
   ==============================================================
   - Reservas: quem vem, quando, quantas pessoas e o código do
     ingresso para conferir na chegada.
   - Vendas: bruto, comissão do AquaTrip e líquido do parceiro, a
     partir dos valores CONGELADOS em cada pagamento.

   Minimização (LGPD): o parceiro vê o NOME do cliente (precisa
   recebê-lo) e o código do ingresso. E-mail e demais dados do cliente
   não saem daqui — o contato acontece pela plataforma.
   ============================================================== */
const db = require("../lib/db");
const { codigoIngresso } = require("../lib/ingresso");

async function parceiroDoUsuario(userId) {
  const { rows } = await db.query(`SELECT id, status FROM partners WHERE user_id = ?`, [userId]);
  if (!rows[0] || !["APPROVED", "SUSPENDED"].includes(rows[0].status)) return null;
  return rows[0];
}

/** Reservas CONFIRMADAS das experiências do parceiro. */
async function reservas(userId, { quando = "proximas" } = {}) {
  const p = await parceiroDoUsuario(userId);
  if (!p) return null;
  const { rows } = await db.query(
    `SELECT b.id, b.quantity, b.status, s.starts_at, sv.title AS experiencia, u.name AS cliente
     FROM bookings b
     JOIN service_slots s ON s.id = b.slot_id
     JOIN services sv     ON sv.id = s.service_id
     JOIN users u         ON u.id = b.user_id
     WHERE sv.partner_id = ? AND b.status = 'CONFIRMED'
       AND ${quando === "passadas" ? "s.starts_at <= NOW()" : "s.starts_at > NOW()"}
     ORDER BY s.starts_at ${quando === "passadas" ? "DESC" : "ASC"}
     LIMIT 300`,
    [p.id]
  );
  // O id da reserva não sai: só o código do ingresso.
  return rows.map(({ id, ...r }) => ({ ...r, codigo: codigoIngresso(id) }));
}

/** Vendas do período com os valores congelados no pagamento. */
async function vendas(userId, { dias = 30 } = {}) {
  const p = await parceiroDoUsuario(userId);
  if (!p) return null;
  const periodo = [30, 90, 365].includes(Number(dias)) ? Number(dias) : 30;
  const { rows } = await db.query(
    `SELECT pa.status, pa.amount_cents, pa.application_fee_cents, pa.commission_pct, pa.method,
            COALESCE(pa.paid_at, pa.created_at) AS data, sv.title AS experiencia, b.quantity
     FROM payments pa
     JOIN bookings b      ON b.id = pa.booking_id
     JOIN service_slots s ON s.id = b.slot_id
     JOIN services sv     ON sv.id = s.service_id
     WHERE pa.partner_id = ? AND pa.status IN ('APPROVED', 'REFUNDED')
       AND COALESCE(pa.paid_at, pa.created_at) > NOW() - INTERVAL ? DAY
     ORDER BY data DESC`,
    [p.id, periodo]
  );
  const aprovadas = rows.filter((r) => r.status === "APPROVED");
  const soma = (lista, f) => lista.reduce((a, r) => a + f(r), 0);
  const bruto = soma(aprovadas, (r) => r.amount_cents);
  const comissao = soma(aprovadas, (r) => r.application_fee_cents);
  return {
    periodoDias: periodo,
    resumo: {
      vendas: aprovadas.length,
      brutoCents: bruto,
      comissaoCents: comissao,
      liquidoCents: bruto - comissao,
      // Estornadas aparecem separadas: não somam no que o parceiro recebeu.
      estornadasCents: soma(rows.filter((r) => r.status === "REFUNDED"), (r) => r.amount_cents),
    },
    vendas: rows.map((r) => ({
      ...r,
      liquido_cents: r.status === "APPROVED" ? r.amount_cents - r.application_fee_cents : 0,
    })),
  };
}

module.exports = { reservas, vendas };
