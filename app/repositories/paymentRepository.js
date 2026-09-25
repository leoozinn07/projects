/* ==============================================================
   AquaTrip — Payment Repository
   SQL de pagamentos e eventos de webhook.
   Lembrete: nada de PAN/CVV aqui. `display_data` só recebe o que o
   gateway devolve para exibição (últimos 4 dígitos, QR do PIX).
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");

async function createPayment({
  bookingId,
  provider,
  providerPaymentId,
  method,
  status,
  amountCents,
  currency,
  installments,
  idempotencyKey,
  displayData,
  partnerId = null,
  commissionPct = null,
  applicationFeeCents = null,
}) {
  const id = crypto.randomUUID();
  // paid_at: no Postgres era calculado no próprio INSERT via CASE
  // WHEN $5::payment_status = 'APPROVED'. Sem RETURNING no MySQL,
  // calculamos aqui e mandamos já pronto — mesma regra, sem round-trip
  // extra pra "descobrir" o valor gravado.
  const paidAt = status === "APPROVED" ? new Date() : null;
  await db.query(
    `INSERT INTO payments
       (id, booking_id, provider, provider_payment_id, method, status, amount_cents,
        currency, installments, idempotency_key, display_data, paid_at,
        partner_id, commission_pct, application_fee_cents)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      bookingId,
      provider,
      providerPaymentId,
      method,
      status,
      amountCents,
      currency,
      installments,
      idempotencyKey,
      displayData ? JSON.stringify(displayData) : null,
      paidAt,
      partnerId,
      commissionPct,
      applicationFeeCents,
    ]
  );
  const { rows } = await db.query(`SELECT * FROM payments WHERE id = ?`, [id]);
  return rows[0];
}

async function findByIdempotencyKey(key) {
  const { rows } = await db.query(
    `SELECT * FROM payments WHERE idempotency_key = ?`,
    [key]
  );
  return rows[0] || null;
}

async function findByProviderPaymentId(provider, providerPaymentId) {
  const { rows } = await db.query(
    `SELECT * FROM payments WHERE provider = ? AND provider_payment_id = ?`,
    [provider, providerPaymentId]
  );
  return rows[0] || null;
}

async function findActiveByBooking(bookingId) {
  const { rows } = await db.query(
    `SELECT * FROM payments
     WHERE booking_id = ? AND status IN ('PENDING','APPROVED')
     ORDER BY created_at DESC LIMIT 1`,
    [bookingId]
  );
  return rows[0] || null;
}

/** Quantas tentativas de pagamento a reserva já teve. */
async function countByBooking(bookingId) {
  const { rows } = await db.query(
    `SELECT COUNT(*) AS n FROM payments WHERE booking_id = ?`,
    [bookingId]
  );
  return rows[0].n;
}

async function findLatestByBooking(bookingId) {
  const { rows } = await db.query(
    `SELECT * FROM payments WHERE booking_id = ?
     ORDER BY created_at DESC LIMIT 1`,
    [bookingId]
  );
  return rows[0] || null;
}

/**
 * Atualiza o status. A transição é condicional: um pagamento já
 * APPROVED/REFUNDED não volta para PENDING por causa de um webhook
 * atrasado chegando fora de ordem.
 */
async function updateStatus(paymentId, status) {
  const agora = new Date();
  const { rowCount } = await db.query(
    `UPDATE payments
     SET status = ?,
         paid_at = CASE WHEN ? = 'APPROVED' AND paid_at IS NULL THEN ? ELSE paid_at END,
         refunded_at = CASE WHEN ? = 'REFUNDED' THEN ? ELSE refunded_at END
     WHERE id = ?
       AND status NOT IN ('REFUNDED')
       AND NOT (status = 'APPROVED' AND ? = 'PENDING')`,
    [status, status, agora, status, agora, paymentId, status]
  );
  if (!rowCount) return null;
  const { rows } = await db.query(`SELECT * FROM payments WHERE id = ?`, [paymentId]);
  return rows[0] || null;
}

/* ---------- Webhook (idempotência) ---------- */

/**
 * Registra o evento. Se já existir (mesmo provider + event id), o
 * INSERT IGNORE não insere nada e affectedRows fica 0 — e o chamador
 * sabe que é uma reentrega e não deve reprocessar (equivalente ao
 * ON CONFLICT DO NOTHING + RETURNING null do Postgres).
 */
async function recordWebhookEvent({ provider, eventId, eventType, payload }) {
  const { rowCount, insertId } = await db.query(
    `INSERT IGNORE INTO webhook_events (provider, provider_event_id, event_type, payload)
     VALUES (?, ?, ?, ?)`,
    [provider, eventId, eventType, payload ? JSON.stringify(payload) : null]
  );
  return rowCount ? { id: insertId } : null; // null = evento duplicado
}

async function markWebhookProcessed(id) {
  await db.query(`UPDATE webhook_events SET processed_at = ? WHERE id = ?`, [new Date(), id]);
}

module.exports = {
  countByBooking,
  createPayment,
  findByIdempotencyKey,
  findByProviderPaymentId,
  findActiveByBooking,
  findLatestByBooking,
  updateStatus,
  recordWebhookEvent,
  markWebhookProcessed,
};
