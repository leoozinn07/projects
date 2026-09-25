/* ==============================================================
   AquaTrip — Audit Repository
   Grava a trilha de auditoria. Regras:
   - NUNCA derruba o fluxo principal: se a gravação falhar, o erro é
     logado e a requisição segue. Auditoria quebrada não pode impedir
     alguém de pagar uma reserva.
   - NUNCA recebe dado sensível: sem senha, sem token, sem cartão.
     O que entra em `metadata` é responsabilidade do chamador.
   ============================================================== */
const db = require("../lib/db");
const log = require("../lib/logger").forModule("auditoria");

async function record({ userId = null, action, ipAddress = null, metadata = null }) {
  try {
    const { insertId } = await db.query(
      `INSERT INTO audit_log (user_id, action, ip_address, metadata)
       VALUES (?, ?, ?, ?)`,
      [userId, action, ipAddress, metadata ? JSON.stringify(metadata) : null]
    );
    return { id: insertId };
  } catch (err) {
    // Log e segue: perder um registro de auditoria é ruim, mas
    // derrubar um pagamento por causa disso é pior.
    log.error({ err, action }, "falha ao gravar evento de auditoria");
    return null;
  }
}

/** Consulta paginada para o painel administrativo. */
async function list({ limit = 50, offset = 0, action = null, userId = null } = {}) {
  const conditions = [];
  const params = [];

  if (action) {
    params.push(action);
    conditions.push(`a.action = ?`);
  }
  if (userId) {
    params.push(userId);
    conditions.push(`a.user_id = ?`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT a.id, a.action, a.ip_address, a.metadata, a.created_at,
            u.email AS user_email, u.name AS user_name
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     ${where}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ? OFFSET ?`,
    params
  );
  return rows;
}

async function countAll({ action = null } = {}) {
  const params = [];
  let where = "";
  if (action) {
    params.push(action);
    where = "WHERE action = ?";
  }
  const { rows } = await db.query(
    `SELECT COUNT(*) AS total FROM audit_log ${where}`,
    params
  );
  return rows[0].total;
}

/** Ações distintas já registradas — alimenta o filtro do painel. */
async function listActions() {
  const { rows } = await db.query(
    `SELECT DISTINCT action FROM audit_log ORDER BY action`
  );
  return rows.map((r) => r.action);
}

module.exports = { record, list, countAll, listActions };
