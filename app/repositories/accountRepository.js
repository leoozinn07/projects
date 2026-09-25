/* ==============================================================
   AquaTrip — Conta do usuário: ingressos e diário de viagens
   ==============================================================
   Toda consulta aqui é filtrada por user_id na própria cláusula
   WHERE — não existe caminho que leia ingresso ou viagem de outra
   pessoa, nem por id adivinhado (IDOR/BOLA).
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");

/* ---------- Ingressos ----------
   Ingresso não é tabela nova: é uma reserva confirmada. Criar uma
   tabela separada abriria espaço para os dois divergirem (ingresso
   válido de reserva estornada, por exemplo). */
async function listTickets(userId) {
  const { rows } = await db.query(
    `SELECT b.id, b.status, b.quantity, b.amount_cents, b.confirmed_at,
            s.starts_at,
            sv.title, sv.location, sv.category
     FROM bookings b
     JOIN service_slots s ON s.id = b.slot_id
     JOIN services sv     ON sv.id = s.service_id
     WHERE b.user_id = ?
       AND b.status IN ('CONFIRMED', 'REFUNDED')
     ORDER BY s.starts_at DESC`,
    [userId]
  );
  return rows;
}

/* ---------- Diário de viagens ---------- */

async function listTrips(userId) {
  const { rows } = await db.query(
    // MySQL não tem NULLS LAST, mas trata NULL como o menor valor em
    // ORDER BY — então DESC já deixa os nulos por último sozinho.
    `SELECT id, place, region, starts_on, ends_on, rating, notes, tags, created_at
     FROM trips
     WHERE user_id = ?
     ORDER BY starts_on DESC, created_at DESC`,
    [userId]
  );
  return rows;
}

async function createTrip(userId, t) {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO trips (id, user_id, place, region, starts_on, ends_on, rating, notes, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, t.place, t.region, t.startsOn, t.endsOn, t.rating, t.notes, t.tags]
  );
  const { rows } = await db.query(
    `SELECT id, place, region, starts_on, ends_on, rating, notes, tags, created_at
     FROM trips WHERE id = ?`,
    [id]
  );
  return rows[0];
}

/** Atualiza só se a viagem for do usuário: o WHERE com user_id é a trava. */
async function updateTrip(userId, id, t) {
  const { rowCount } = await db.query(
    `UPDATE trips
     SET place = ?, region = ?, starts_on = ?, ends_on = ?,
         rating = ?, notes = ?, tags = ?
     WHERE id = ? AND user_id = ?`,
    [t.place, t.region, t.startsOn, t.endsOn, t.rating, t.notes, t.tags, id, userId]
  );
  if (!rowCount) return null;
  const { rows } = await db.query(
    `SELECT id, place, region, starts_on, ends_on, rating, notes, tags, created_at
     FROM trips WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function deleteTrip(userId, id) {
  const { rowCount } = await db.query(
    `DELETE FROM trips WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
  return rowCount > 0;
}

module.exports = { listTickets, listTrips, createTrip, updateTrip, deleteTrip };
