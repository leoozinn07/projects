/* ==============================================================
   AquaTrip — Avaliações verificadas
   ==============================================================
   Regras:
   - Só avalia o dono de uma reserva CONFIRMADA cuja data já passou.
   - Uma avaliação por reserva (UNIQUE no banco).
   - Autor exibido como "Lia S.": identifica sem expor o nome todo.
   - Moderação só por violação, com motivo e autor registrados.
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");
const auditService = require("./auditService");
const mediaService = require("./mediaService");
const mailService = require("./mailService");
const log = require("../lib/logger").forModule("avaliacoes");
const { AuditAction } = auditService;

class ReviewError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** "Lia Beatriz Souza" -> "Lia S." */
function nomeExibido(nome) {
  const partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length || nome === "Titular anonimizado") return "Viajante";
  const primeiro = partes[0];
  const ultimo = partes.length > 1 ? partes[partes.length - 1] : "";
  return ultimo ? `${primeiro} ${ultimo.charAt(0).toUpperCase()}.` : primeiro;
}

/** Reserva que o usuário pode avaliar (ou o motivo de não poder). */
async function elegibilidade(userId, bookingId) {
  const { rows } = await db.query(
    `SELECT b.id, b.user_id, b.status, s.starts_at, sv.id AS service_id, sv.title, sv.slug,
            r.id AS review_id
     FROM bookings b
     JOIN service_slots s ON s.id = b.slot_id
     JOIN services sv     ON sv.id = s.service_id
     LEFT JOIN reviews r  ON r.booking_id = b.id
     WHERE b.id = ?`,
    [bookingId]
  );
  const b = rows[0];
  // "Não encontrada" também para reserva de outra pessoa: não confirma
  // que o id existe.
  if (!b || b.user_id !== userId) throw new ReviewError("Reserva não encontrada.", "NOT_FOUND", 404);
  if (b.status !== "CONFIRMED") {
    throw new ReviewError("Só é possível avaliar reservas confirmadas.", "NOT_CONFIRMED", 409);
  }
  if (new Date(b.starts_at) > new Date()) {
    throw new ReviewError("Você poderá avaliar depois da data da experiência.", "NOT_YET", 409);
  }
  if (b.review_id) throw new ReviewError("Você já avaliou esta experiência.", "ALREADY_REVIEWED", 409);
  return b;
}

async function criar({ userId, bookingId, rating, title, body, req }) {
  const b = await elegibilidade(userId, bookingId);
  try {
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO reviews (id, booking_id, user_id, service_id, rating, title, body)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, bookingId, userId, b.service_id, rating, title || null, body || null]
    );
    const { rows } = await db.query(
      `SELECT id, rating, created_at FROM reviews WHERE id = ?`,
      [id]
    );
    await auditService.log(AuditAction.REVIEW_CREATED, {
      req, userId, metadata: { avaliacaoId: id, servicoId: b.service_id, nota: rating },
    });
    return { ...rows[0], slug: b.slug };
  } catch (err) {
    // Duplo envio simultâneo: a UNIQUE do banco decide.
    // ER_DUP_ENTRY (errno 1062) é o equivalente MySQL do 23505 do Postgres.
    if (err.code === "ER_DUP_ENTRY") throw new ReviewError("Você já avaliou esta experiência.", "ALREADY_REVIEWED", 409);
    throw err;
  }
}

/** O autor pode retirar a própria avaliação a qualquer momento. */
async function excluirPropria({ userId, reviewId, req }) {
  // O CASCADE apaga as linhas de review_photos, mas não toca no disco
  // nem na tabela media. Apagamos explicitamente para não deixar órfãs.
  const { rows: fotos } = await db.query(
    `SELECT m.id FROM review_photos rp JOIN media m ON m.id = rp.media_id
     JOIN reviews r ON r.id = rp.review_id WHERE r.id = ? AND r.user_id = ?`,
    [reviewId, userId]
  );
  const { rowCount } = await db.query(`DELETE FROM reviews WHERE id = ? AND user_id = ?`, [reviewId, userId]);
  if (!rowCount) throw new ReviewError("Avaliação não encontrada.", "NOT_FOUND", 404);
  for (const f of fotos) await mediaService.apagar(f.id);
  await auditService.log(AuditAction.REVIEW_DELETED, { req, userId, metadata: { avaliacaoId: reviewId } });
}

/** Resumo e lista pública de uma experiência (só visíveis). */
async function publicas(serviceId, limite = 20) {
  const [resumo, lista] = await Promise.all([
    db.query(
      `SELECT COUNT(*) AS total, ROUND(AVG(rating), 1) AS media,
              COUNT(CASE WHEN rating = 5 THEN 1 END) AS n5,
              COUNT(CASE WHEN rating = 4 THEN 1 END) AS n4,
              COUNT(CASE WHEN rating = 3 THEN 1 END) AS n3,
              COUNT(CASE WHEN rating = 2 THEN 1 END) AS n2,
              COUNT(CASE WHEN rating = 1 THEN 1 END) AS n1
       FROM reviews WHERE service_id = ? AND status = 'VISIBLE'`,
      [serviceId]
    ),
    db.query(
      `SELECT r.id, r.rating, r.title, r.body, r.created_at, u.name
       FROM reviews r JOIN users u ON u.id = r.user_id
       WHERE r.service_id = ? AND r.status = 'VISIBLE'
       ORDER BY r.created_at DESC
       LIMIT ?`,
      [serviceId, limite]
    ),
  ]);
  const ids = lista.rows.map((r) => r.id);
  // status = ANY($1) (array) do Postgres → IN (?, ?, ...) montado a
  // partir da lista de ids desta página (nunca vinda direto do cliente).
  const fotos = ids.length ? (await db.query(
    `SELECT rp.review_id, m.storage_key
     FROM review_photos rp JOIN media m ON m.id = rp.media_id
     WHERE rp.review_id IN (${ids.map(() => "?").join(", ")}) AND m.status = 'APPROVED'
     ORDER BY rp.position`,
    ids
  )).rows : [];
  const r0 = resumo.rows[0];
  return {
    resumo: {
      total: Number(r0.total),
      media: r0.media == null ? null : Number(r0.media),
      n5: Number(r0.n5), n4: Number(r0.n4), n3: Number(r0.n3), n2: Number(r0.n2), n1: Number(r0.n1),
    },
    // O nome completo nunca sai daqui: vira "Lia S." no servidor.
    avaliacoes: lista.rows.map(({ name, ...r }) => ({
      ...r,
      autor: nomeExibido(name),
      // Só APROVADAS: pendente e recusada nunca chegam à página pública.
      fotos: fotos.filter((f) => f.review_id === r.id).map((f) => `/media/${f.storage_key}`),
    })),
  };
}

/** Reservas do usuário que já podem ser avaliadas e ainda não foram. */
async function pendentes(userId) {
  const { rows } = await db.query(
    `SELECT b.id AS booking_id, sv.title, s.starts_at
     FROM bookings b
     JOIN service_slots s ON s.id = b.slot_id
     JOIN services sv     ON sv.id = s.service_id
     LEFT JOIN reviews r  ON r.booking_id = b.id
     WHERE b.user_id = ? AND b.status = 'CONFIRMED' AND s.starts_at < NOW() AND r.id IS NULL
     ORDER BY s.starts_at DESC`,
    [userId]
  );
  return rows;
}

/* ---------- Fotos ---------- */

const MAX_FOTOS = 3;

async function adicionarFoto({ userId, reviewId, buffer, req }) {
  const { rows } = await db.query(
    `SELECT r.id, (SELECT COUNT(*) FROM review_photos rp JOIN media m ON m.id = rp.media_id
                   WHERE rp.review_id = r.id AND m.status <> 'REJECTED') AS fotos,
            (SELECT COALESCE(MAX(position), 0) FROM review_photos WHERE review_id = r.id) AS ultima
     FROM reviews r WHERE r.id = ? AND r.user_id = ?`,
    [reviewId, userId]
  );
  // 404 também para avaliação de outra pessoa: não confirma que existe.
  if (!rows[0]) throw new ReviewError("Avaliação não encontrada.", "NOT_FOUND", 404);
  if (Number(rows[0].fotos) >= MAX_FOTOS) {
    throw new ReviewError(`Cada avaliação aceita até ${MAX_FOTOS} fotos.`, "TOO_MANY_PHOTOS", 409);
  }

  // Mesmo pipeline das capas: tipo real, limites e REMOÇÃO DE METADADOS.
  // Aqui é ainda mais importante — é foto de celular de cliente, com o
  // GPS de onde ela foi tirada.
  const media = await mediaService.salvarImagem({ buffer, usuarioId: userId, purpose: "REVIEW", status: "PENDING" });

  // Vínculo numa transação com trava na avaliação: dois envios
  // simultâneos não ocupam a mesma vaga nem passam do limite.
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT id FROM reviews WHERE id = ? FOR UPDATE`, [reviewId]);
    // Foto recusada libera a vaga (o registro da decisão fica em media).
    // DELETE...USING (Postgres) → DELETE multi-tabela do MySQL.
    await client.query(
      `DELETE rp FROM review_photos rp JOIN media m ON rp.media_id = m.id
       WHERE rp.review_id = ? AND m.status = 'REJECTED'`, [reviewId]
    );
    // generate_series não existe no MySQL: MAX_FOTOS é constante fixa (3),
    // então a "série" vira uma tabela derivada literal via UNION ALL.
    const posicoes = Array.from({ length: MAX_FOTOS }, (_, i) => `SELECT ${i + 1} AS p`).join(" UNION ALL ");
    const { rows: livre } = await client.query(
      `SELECT MIN(p) AS pos FROM (${posicoes}) t
       WHERE p NOT IN (SELECT position FROM review_photos WHERE review_id = ?)`, [reviewId]
    );
    if (!livre[0].pos) throw new ReviewError(`Cada avaliação aceita até ${MAX_FOTOS} fotos.`, "TOO_MANY_PHOTOS", 409);
    await client.query(
      `INSERT INTO review_photos (review_id, media_id, position) VALUES (?, ?, ?)`,
      [reviewId, media.id, livre[0].pos]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    await mediaService.apagar(media.id); // não deixa arquivo órfão
    throw err;
  } finally {
    client.release();
  }
  await auditService.log(AuditAction.PHOTO_SUBMITTED, {
    req, userId, metadata: { avaliacaoId: reviewId, midiaId: media.id },
  });
  return { id: media.id, status: "PENDING", url: `/media/${media.storage_key}` };
}

/** Fotos da avaliação do próprio autor, com status (inclui pendentes). */
async function fotosDoAutor(userId, reviewId) {
  const { rows } = await db.query(
    `SELECT m.id, m.storage_key, m.status, m.rejection_reason
     FROM review_photos rp JOIN media m ON m.id = rp.media_id JOIN reviews r ON r.id = rp.review_id
     WHERE rp.review_id = ? AND r.user_id = ? ORDER BY rp.position`,
    [reviewId, userId]
  );
  return rows.map((f) => ({
    id: f.id,
    status: f.status,
    url: f.status === "REJECTED" ? null : `/media/${f.storage_key}`,
    motivo: f.rejection_reason ? mediaService.MOTIVOS_RECUSA[f.rejection_reason] : null,
  }));
}

/** Decisão do moderador + aviso ao autor em caso de recusa. */
async function moderarFoto({ adminId, mediaId, aprovar, motivo, req }) {
  const m = await mediaService.moderar({ mediaId, adminId, aprovar, motivo });
  // Capa enviada por parceiro: aprovada vira a capa; recusada sai da espera.
  if (m.purpose === "COVER") {
    await require("./partnerExperienceService").aoModerarCapa({
      mediaId, aprovada: aprovar, motivoTexto: aprovar ? null : mediaService.MOTIVOS_RECUSA[motivo],
    });
  }
  // Foto de experiência da comunidade: a primeira aprovada vira a capa.
  if (m.purpose === "EXPERIENCE" && aprovar) {
    await require("./communityService").aoAprovarFoto(mediaId);
  }
  await auditService.log(aprovar ? AuditAction.PHOTO_APPROVED : AuditAction.PHOTO_REJECTED, {
    req, userId: adminId, metadata: { midiaId: mediaId, motivo: aprovar ? null : motivo },
  });
  if (!aprovar && m.uploaded_by) {
    // Moderação silenciosa parece censura; o motivo ensina a enviar certo.
    const { rows } = await db.query(
      `SELECT u.email, u.name, sv.title, sv.slug FROM users u
       JOIN reviews r ON r.user_id = u.id
       JOIN review_photos rp ON rp.review_id = r.id
       JOIN services sv ON sv.id = r.service_id
       WHERE u.id = ? AND rp.media_id = ?`,
      [m.uploaded_by, mediaId]
    );
    if (rows[0]) {
      mailService.send({
        to: rows[0].email,
        template: "foto_recusada",
        subject: "Uma foto da sua avaliação não foi publicada — AquaTrip",
        text: `${rows[0].name.split(" ")[0]}, uma das fotos da sua avaliação de "${rows[0].title}" não foi publicada.\n\n` +
              `Motivo: ${mediaService.MOTIVOS_RECUSA[motivo]}.\n\n` +
              `Sua avaliação continua no ar. Você pode enviar outra foto em Minhas reservas.`,
      }).catch((err) => log.error({ err }, "falha ao avisar recusa de foto"));
    }
  }
  return m;
}

/* ---------- Moderação ---------- */

async function recentesParaModeracao() {
  const { rows } = await db.query(
    `SELECT r.id, r.rating, r.title, r.body, r.status, r.hidden_reason, r.created_at,
            u.name AS autor, u.email AS autor_email, sv.title AS experiencia
     FROM reviews r
     JOIN users u     ON u.id = r.user_id
     JOIN services sv ON sv.id = r.service_id
     ORDER BY r.created_at DESC LIMIT 100`
  );
  return rows;
}

async function moderar({ adminId, reviewId, ocultar, motivo, req }) {
  if (ocultar && !(motivo && motivo.trim().length >= 10)) {
    throw new ReviewError(
      "Informe o motivo (mínimo de 10 caracteres). Avaliação só pode ser ocultada por violação — nunca por ser negativa.",
      "REASON_REQUIRED"
    );
  }
  const { rowCount } = await db.query(
    `UPDATE reviews
     SET status = ?, hidden_reason = ?, hidden_by = ?
     WHERE id = ?`,
    [ocultar ? "HIDDEN" : "VISIBLE", ocultar ? motivo.trim() : null, ocultar ? adminId : null, reviewId]
  );
  if (!rowCount) throw new ReviewError("Avaliação não encontrada.", "NOT_FOUND", 404);
  const { rows } = await db.query(
    `SELECT id, status, hidden_reason, rating FROM reviews WHERE id = ?`,
    [reviewId]
  );
  await auditService.log(ocultar ? AuditAction.REVIEW_HIDDEN : AuditAction.REVIEW_RESTORED, {
    req, userId: adminId,
    // A nota fica no registro: permite auditar se a moderação esconde só as ruins.
    metadata: { avaliacaoId: reviewId, nota: rows[0].rating, motivo: ocultar ? motivo.trim() : null },
  });
  return rows[0];
}

module.exports = {
  MAX_FOTOS, adicionarFoto, fotosDoAutor, moderarFoto,
  ReviewError, nomeExibido, elegibilidade, criar, excluirPropria,
  publicas, pendentes, recentesParaModeracao, moderar,
};
