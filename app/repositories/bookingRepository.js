/* ==============================================================
   AquaTrip — Booking Repository
   Única camada com SQL de serviços/slots/reservas. Todas as queries
   são parametrizadas (?) — nunca concatenar valor de usuário.
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");
const { visivel } = require("../lib/visibilidade");

/* ---------- Catálogo ---------- */

async function listServices() {
  const { rows } = await db.query(
    `SELECT id, slug, title, location, category, price_cents, currency
     FROM services sv WHERE ${visivel("sv")} ORDER BY title`
  );
  return rows;
}

async function findServiceBySlug(slug) {
  const { rows } = await db.query(
    `SELECT s.id, s.slug, s.title, s.location, s.category, s.price_cents, s.currency,
            s.description, s.cover_alt, m.storage_key AS cover_key,
            pa.display_name AS operador
     FROM services s
     LEFT JOIN media m ON m.id = s.cover_media_id
     LEFT JOIN partners pa ON pa.id = s.partner_id
     WHERE s.slug = ? AND ${visivel("s")}`,
    [slug]
  );
  return rows[0] || null;
}

/**
 * Slots futuros de um serviço com a contagem de vagas já ocupadas.
 * Reservas PENDING expiradas NÃO contam como ocupadas — a vaga é
 * liberada na própria leitura, então não dependemos exclusivamente
 * do job de expiração para mostrar disponibilidade correta.
 */
async function listAvailableSlots(serviceId) {
  const { rows } = await db.query(
    `SELECT s.id,
            s.starts_at,
            s.capacity,
            COALESCE(SUM(b.quantity), 0) AS taken
     FROM service_slots s
     LEFT JOIN bookings b
       ON b.slot_id = s.id
      AND (
            b.status = 'CONFIRMED'
         OR (b.status = 'PENDING' AND b.expires_at > NOW())
      )
     WHERE s.service_id = ?
       AND s.starts_at > NOW()
     GROUP BY s.id
     HAVING s.capacity - COALESCE(SUM(b.quantity), 0) > 0
     ORDER BY s.starts_at`,
    [serviceId]
  );
  return rows;
}

/* ---------- Reserva ---------- */

/**
 * Cria a reserva PENDING de forma atômica e à prova de corrida:
 * usa SELECT ... FOR UPDATE no slot para serializar duas pessoas
 * tentando a última vaga ao mesmo tempo. Sem isso, dois pedidos
 * simultâneos poderiam ler "1 vaga livre" e ambos reservarem.
 * (No Postgres isso era "FOR UPDATE OF s" — trava só a tabela do
 * slot; o MySQL não tem essa forma restrita de FOR UPDATE, então a
 * consulta trava as linhas envolvidas nas duas tabelas do JOIN, o
 * que é mais conservador mas igualmente seguro aqui.)
 *
 * O valor é calculado AQUI a partir do preço do banco — nunca a
 * partir de valor vindo do cliente.
 */
async function createPendingBooking({ userId, slotId, quantity, holdMinutes }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const slotRes = await client.query(
      `SELECT s.id, s.capacity, s.starts_at, sv.price_cents, sv.currency
       FROM service_slots s
       JOIN services sv ON sv.id = s.service_id
       -- Sem isto, horário de experiência desativada (ou de parceiro
       -- suspenso) continuava reservável por quem tivesse o id.
       WHERE s.id = ? AND ${visivel("sv")}
       FOR UPDATE`,
      [slotId]
    );
    const slot = slotRes.rows[0];
    if (!slot) {
      await client.query("ROLLBACK");
      return { error: "SLOT_NOT_FOUND" };
    }
    if (new Date(slot.starts_at) <= new Date()) {
      await client.query("ROLLBACK");
      return { error: "SLOT_IN_PAST" };
    }

    const takenRes = await client.query(
      `SELECT COALESCE(SUM(quantity), 0) AS taken
       FROM bookings
       WHERE slot_id = ?
         AND (status = 'CONFIRMED' OR (status = 'PENDING' AND expires_at > NOW()))`,
      [slotId]
    );
    const taken = takenRes.rows[0].taken;

    if (taken + quantity > slot.capacity) {
      await client.query("ROLLBACK");
      return { error: "NO_CAPACITY", available: slot.capacity - taken };
    }

    const amountCents = slot.price_cents * quantity;
    const bookingId = crypto.randomUUID();
    // Experiência gratuita não tem o que pagar: a vaga já nasce
    // confirmada, sem checkout de R$ 0 nem prazo de expiração.
    const gratuita = amountCents === 0;
    const expiresAt = gratuita ? null : new Date(Date.now() + holdMinutes * 60 * 1000);

    await client.query(
      `INSERT INTO bookings (id, user_id, slot_id, quantity, amount_cents, currency, expires_at, status, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bookingId, userId, slotId, quantity, amountCents, slot.currency, expiresAt,
        gratuita ? "CONFIRMED" : "PENDING", gratuita ? new Date() : null]
    );
    const bookingRes = await client.query(
      `SELECT id, user_id, slot_id, status, quantity, amount_cents, currency,
              expires_at, created_at
       FROM bookings WHERE id = ?`,
      [bookingId]
    );

    await client.query("COMMIT");
    return { booking: bookingRes.rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function findBookingById(id) {
  const { rows } = await db.query(
    `SELECT b.*, s.starts_at, sv.title AS service_title, sv.slug AS service_slug,
            sv.location AS service_location
     FROM bookings b
     JOIN service_slots s ON s.id = b.slot_id
     JOIN services sv ON sv.id = s.service_id
     WHERE b.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function listBookingsByUser(userId) {
  const { rows } = await db.query(
    `SELECT b.id, b.status, b.quantity, b.amount_cents, b.currency, b.created_at,
            b.confirmed_at, b.expires_at,
            s.starts_at, sv.title AS service_title, sv.location AS service_location,
            sv.slug AS service_slug, r.id AS review_id
     FROM bookings b
     JOIN service_slots s ON s.id = b.slot_id
     JOIN services sv ON sv.id = s.service_id
     LEFT JOIN reviews r ON r.booking_id = b.id
     WHERE b.user_id = ?
     ORDER BY b.created_at DESC`,
    [userId]
  );
  return rows;
}

/**
 * Transições de status são sempre condicionais no SQL (WHERE status = ...).
 * Isso garante que um webhook duplicado ou fora de ordem não consiga,
 * por exemplo, confirmar uma reserva já cancelada.
 */
async function markConfirmed(bookingId) {
  const { rowCount } = await db.query(
    `UPDATE bookings
     SET status = 'CONFIRMED', confirmed_at = ?, expires_at = NULL
     WHERE id = ? AND status = 'PENDING'`,
    [new Date(), bookingId]
  );
  if (!rowCount) return null;
  const { rows } = await db.query(`SELECT id, status FROM bookings WHERE id = ?`, [bookingId]);
  return rows[0] || null;
}

async function markCancelled(bookingId, { onlyIfStatus } = {}) {
  const params = [new Date(), bookingId];
  let statusFilter = "status IN ('PENDING', 'CONFIRMED')";
  if (onlyIfStatus) {
    statusFilter = "status = ?";
    params.push(onlyIfStatus);
  }
  const { rowCount } = await db.query(
    `UPDATE bookings
     SET status = 'CANCELLED', cancelled_at = ?, expires_at = NULL
     WHERE id = ? AND ${statusFilter}`,
    params
  );
  if (!rowCount) return null;
  const { rows } = await db.query(`SELECT id, status FROM bookings WHERE id = ?`, [bookingId]);
  return rows[0] || null;
}

async function markRefunded(bookingId) {
  const { rowCount } = await db.query(
    `UPDATE bookings
     SET status = 'REFUNDED', cancelled_at = ?
     WHERE id = ? AND status = 'CONFIRMED'`,
    [new Date(), bookingId]
  );
  if (!rowCount) return null;
  const { rows } = await db.query(`SELECT id, status FROM bookings WHERE id = ?`, [bookingId]);
  return rows[0] || null;
}

/**
 * Libera reservas pendentes vencidas (chamado por job periódico).
 * O MySQL não tem UPDATE ... RETURNING: por isso primeiro lê os ids
 * elegíveis e depois atualiza exatamente esses ids, dentro da mesma
 * transação — evita ter que adivinhar quais linhas foram tocadas.
 */
async function expireStaleBookings() {
  return db.withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT id FROM bookings
       WHERE status = 'PENDING' AND expires_at IS NOT NULL AND expires_at <= ?
       FOR UPDATE`,
      [new Date()]
    );
    const ids = rows.map((r) => r.id);
    if (!ids.length) return [];

    const placeholders = ids.map(() => "?").join(", ");
    await tx.query(`UPDATE bookings SET status = 'EXPIRED' WHERE id IN (${placeholders})`, ids);
    return ids;
  });
}

module.exports = {
  listServices,
  findServiceBySlug,
  listAvailableSlots,
  createPendingBooking,
  findBookingById,
  listBookingsByUser,
  markConfirmed,
  markCancelled,
  markRefunded,
  expireStaleBookings,
};
