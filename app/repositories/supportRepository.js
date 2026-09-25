/* ==============================================================
   AquaTrip — Support Repository
   Mensagens de contato, solicitações LGPD e anonimização de conta.
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");

const PRAZO_LGPD_DIAS = 15;

/* ---------- Contato ---------- */

async function createMessage({ name, email, company, region, message, ip }) {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO contact_messages (id, name, email, company, region, message, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, email, company, region, message, ip]
  );
  const { rows } = await db.query(
    `SELECT id, created_at FROM contact_messages WHERE id = ?`,
    [id]
  );
  return rows[0];
}

async function listMessages({ status = null } = {}) {
  const { rows } = await db.query(
    `SELECT id, name, email, company, region, message, status, created_at, read_at
     FROM contact_messages
     ${status ? "WHERE status = ?" : ""}
     ORDER BY (status = 'NEW') DESC, created_at DESC
     LIMIT 200`,
    status ? [status] : []
  );
  return rows;
}

async function setMessageStatus(id, status) {
  const { rowCount } = await db.query(
    `UPDATE contact_messages
     SET status = ?,
         read_at = CASE WHEN ? <> 'NEW' THEN COALESCE(read_at, NOW()) ELSE NULL END
     WHERE id = ?`,
    [status, status, id]
  );
  if (!rowCount) return null;
  const { rows } = await db.query(
    `SELECT id, status, read_at FROM contact_messages WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

/* ---------- Solicitações LGPD ---------- */

async function listRequests({ abertas = false } = {}) {
  const { rows } = await db.query(
    `SELECT r.id, r.kind, r.status, r.details, r.response, r.created_at, r.resolved_at,
            u.id AS user_id, u.name AS user_name, u.email AS user_email, u.anonymized_at,
            DATE_ADD(r.created_at, INTERVAL ? DAY) AS prazo,
            CEIL(TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(r.created_at, INTERVAL ? DAY)) / 86400)
              AS dias_restantes
     FROM data_requests r
     JOIN users u ON u.id = r.user_id
     ${abertas ? "WHERE r.status IN ('OPEN', 'IN_PROGRESS')" : ""}
     ORDER BY (r.status IN ('OPEN', 'IN_PROGRESS')) DESC, r.created_at`,
    [PRAZO_LGPD_DIAS, PRAZO_LGPD_DIAS]
  );
  return rows.map((r) => ({
    ...r,
    dias_restantes: r.dias_restantes == null ? null : Number(r.dias_restantes),
  }));
}

async function getRequest(id) {
  const { rows } = await db.query(
    `SELECT r.*, u.email AS user_email, u.name AS user_name, u.role AS user_role
     FROM data_requests r JOIN users u ON u.id = r.user_id
     WHERE r.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function updateRequest(id, { status, response, adminId }) {
  const { rowCount } = await db.query(
    `UPDATE data_requests
     SET status = ?,
         response = COALESCE(?, response),
         handled_by = ?,
         resolved_at = CASE WHEN ? IN ('DONE', 'REJECTED') THEN NOW() ELSE NULL END
     WHERE id = ?`,
    [status, response, adminId, status, id]
  );
  if (!rowCount) return null;
  const { rows } = await db.query(
    `SELECT id, kind, status, response, resolved_at FROM data_requests WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function counters() {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM contact_messages WHERE status = 'NEW') AS contatos_novos,
       (SELECT COUNT(*) FROM media WHERE status = 'PENDING') AS fotos_pendentes,
       (SELECT COUNT(*) FROM data_requests WHERE status IN ('OPEN','IN_PROGRESS')) AS lgpd_abertas,
       (SELECT COUNT(*) FROM data_requests
         WHERE status IN ('OPEN','IN_PROGRESS')
           AND DATE_ADD(created_at, INTERVAL ? DAY) < NOW()) AS lgpd_atrasadas`,
    [PRAZO_LGPD_DIAS]
  );
  const r = rows[0];
  return {
    contatos_novos: Number(r.contatos_novos),
    fotos_pendentes: Number(r.fotos_pendentes),
    lgpd_abertas: Number(r.lgpd_abertas),
    lgpd_atrasadas: Number(r.lgpd_atrasadas),
  };
}

/* ---------- Anonimização ----------
   Atende eliminação/anonimização (LGPD art. 18, IV e VI) sem violar
   a guarda obrigatória (art. 16): reservas e pagamentos ficam, mas
   deixam de apontar para alguém identificável.

   O que acontece, numa transação só:
   - nome e e-mail substituídos; senha trocada por valor aleatório;
     conta suspensa (ninguém entra mais nela)
   - diário de viagens e tokens pendentes: apagados (sem obrigação
     legal de guarda)
   - mensagens de contato enviadas com o mesmo e-mail: apagadas
   - e-mail removido do metadata da auditoria (IP e data ficam:
     guarda de registros de acesso, Marco Civil art. 15)
   - sessões abertas derrubadas
   Fica: reservas, pagamentos e registro de consentimento (prova). */
async function countLiveBookings(userId) {
  const { rows } = await db.query(
    `SELECT COUNT(*) AS n
     FROM bookings b JOIN service_slots s ON s.id = b.slot_id
     JOIN services sv ON sv.id = s.service_id
     -- Inclui quem vai numa experiência que a pessoa CRIOU: anonimizar
     -- o organizador deixaria participantes sem viagem.
     WHERE (b.user_id = ? OR sv.creator_user_id = ?)
       AND ((b.status = 'CONFIRMED' AND s.starts_at > NOW())
            OR (b.status = 'PENDING' AND b.expires_at > NOW()))`,
    [userId, userId]
  );
  return rows[0].n;
}

async function anonymizeUser(userId, { hashInutilizavel }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT email FROM users WHERE id = ? FOR UPDATE`,
      [userId]
    );
    if (!rows[0]) throw new Error("usuário não encontrado");
    const emailAntigo = rows[0].email;
    const marcador = crypto.randomBytes(6).toString("hex");

    await client.query(
      `UPDATE users
       SET name = 'Titular anonimizado',
           email = ?,
           password_hash = ?,
           status = 'SUSPENDED',
           suspended_until = NULL,
           suspended_reason = 'Conta anonimizada a pedido do titular',
           email_verified_at = NULL,
           last_login_at = NULL,
           failed_login_count = 0,
           locked_until = NULL,
           anonymized_at = NOW()
       WHERE id = ?`,
      [`anonimizado-${marcador}@anonimizado.invalid`, hashInutilizavel, userId]
    );

    await client.query(`DELETE FROM trips WHERE user_id = ?`, [userId]);

    // Texto livre escrito pela pessoa pode identificá-la ("fui com meu
    // marido João..."): não dá para anonimizar com segurança, então sai.
    // Fotos das avaliações: linhas de media saem na transação; os
    // ARQUIVOS só depois do COMMIT (se a transação fosse desfeita, um
    // arquivo apagado antes não voltaria). O MySQL não tem DELETE...
    // RETURNING: seleciona os storage_key antes de apagar.
    const { rows: fotos } = await client.query(
      `SELECT m.id, m.storage_key
       FROM review_photos rp
       JOIN reviews r ON r.id = rp.review_id
       JOIN media m   ON m.id = rp.media_id
       WHERE r.user_id = ?`,
      [userId]
    );
    if (fotos.length) {
      const placeholders = fotos.map(() => "?").join(", ");
      await client.query(
        `DELETE FROM media WHERE id IN (${placeholders})`,
        fotos.map((f) => f.id)
      );
    }

    // Fotos enviadas pela pessoa e ainda sem vínculo (ex.: recusadas).
    const { rows: soltas } = await client.query(
      `SELECT id, storage_key FROM media WHERE uploaded_by = ? AND purpose IN ('REVIEW', 'AVATAR', 'EXPERIENCE')`,
      [userId]
    );
    if (soltas.length) {
      const placeholders = soltas.map(() => "?").join(", ");
      await client.query(
        `DELETE FROM media WHERE id IN (${placeholders})`,
        soltas.map((f) => f.id)
      );
    }

    await client.query(`DELETE FROM reviews WHERE user_id = ?`, [userId]);
    // Rede social: texto livre e vínculos identificam a pessoa.
    await client.query(`UPDATE users SET bio = NULL, avatar_media_id = NULL, last_seen_at = NULL WHERE id = ?`, [userId]);
    await client.query(`DELETE FROM experience_comments WHERE user_id = ?`, [userId]);
    await client.query(`DELETE FROM experience_likes WHERE user_id = ?`, [userId]);
    await client.query(`DELETE FROM experience_interests WHERE user_id = ?`, [userId]);
    await client.query(`DELETE FROM user_follows WHERE follower_id = ? OR followee_id = ?`, [userId, userId]);
    await client.query(`DELETE FROM experience_reports WHERE reporter_id = ?`, [userId]);
    await client.query(`DELETE FROM platform_feedback WHERE user_id = ?`, [userId]);
    // Experiências que a pessoa criou saem do ar (histórico de reservas
    // de terceiros continua íntegro) e perdem o texto livre.
    await client.query(
      `UPDATE services SET active = FALSE, moderation_status = 'BANNED',
         moderation_reason = 'Conta do criador anonimizada', trip_info = NULL,
         description = 'Experiência removida.'
       WHERE creator_user_id = ?`,
      [userId]
    );
    // Candidatura de parceiro não aprovada: sem obrigação de guarda.
    await client.query(
      `DELETE FROM partners WHERE user_id = ? AND status IN ('PENDING', 'REJECTED')`,
      [userId]
    );
    await client.query(`DELETE FROM password_reset_tokens WHERE user_id = ?`, [userId]);
    await client.query(`DELETE FROM email_verification_tokens WHERE user_id = ?`, [userId]);
    await client.query(`DELETE FROM contact_messages WHERE email = ?`, [emailAntigo]);
    // metadata - 'email' - 'alvoEmail' - 'cliente_email' (jsonb) → JSON_REMOVE;
    // metadata->>'chave' (jsonb) → JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.chave')).
    await client.query(
      `UPDATE audit_log
       SET metadata = JSON_REMOVE(metadata, '$.email', '$.alvoEmail', '$.cliente_email')
       WHERE user_id = ?
          OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.email')) = ?
          OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.alvoEmail')) = ?`,
      [userId, emailAntigo, emailAntigo]
    );
    await client.query(
      `DELETE FROM session WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.user.id')) = ?`,
      [userId]
    );

    await client.query("COMMIT");
    return { ok: true, arquivosParaApagar: [...fotos, ...soltas].map((f) => f.storage_key) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  PRAZO_LGPD_DIAS,
  createMessage,
  listMessages,
  setMessageStatus,
  listRequests,
  getRequest,
  updateRequest,
  counters,
  countLiveBookings,
  anonymizeUser,
};
