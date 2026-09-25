/* ==============================================================
   AquaTrip — Reclamações, sugestões e avaliações sobre o AquaTrip
   ==============================================================
   Diferente do formulário de contato (captação de parceiros) e das
   avaliações de experiência (presas a uma reserva): aqui a pessoa
   fala do AQUATRIP em si. O admin responde e acompanha o status; a
   pessoa vê a resposta na mesma página em que abriu o registro.
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");
const auditService = require("./auditService");
const { AuditAction } = auditService;

const TIPOS = Object.freeze({ COMPLAINT: "Reclamação", RATING: "Avaliação do AquaTrip", SUGGESTION: "Sugestão" });
const STATUS = Object.freeze({ OPEN: "Aberta", IN_PROGRESS: "Em andamento", RESOLVED: "Resolvida", CLOSED: "Encerrada" });

class FeedbackError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function criar({ userId, dados, req }) {
  const recentes = await db.query(
    `SELECT COUNT(*) AS n FROM platform_feedback WHERE user_id = ? AND created_at > NOW() - INTERVAL 1 DAY`,
    [userId]
  );
  if (Number(recentes.rows[0].n) >= 10) {
    throw new FeedbackError("Você já enviou muitos registros hoje. Tente de novo amanhã.", "TOO_MANY", 429);
  }
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO platform_feedback (id, user_id, kind, rating, subject, message) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, dados.kind, dados.kind === "RATING" ? dados.rating : null, dados.subject, dados.message]
  );
  await auditService.log(AuditAction.FEEDBACK_CREATED, { req, userId, metadata: { id, tipo: dados.kind } });
  return { id };
}

async function meus(userId) {
  const { rows } = await db.query(
    `SELECT id, kind, rating, subject, message, status, admin_response, responded_at, created_at
     FROM platform_feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    [userId]
  );
  return rows;
}

/* ---------- Admin ---------- */

async function listarAdmin({ status = null, kind = null } = {}) {
  const cond = [];
  const params = [];
  if (status && STATUS[status]) { cond.push("f.status = ?"); params.push(status); }
  if (kind && TIPOS[kind]) { cond.push("f.kind = ?"); params.push(kind); }
  const { rows } = await db.query(
    `SELECT f.id, f.kind, f.rating, f.subject, f.message, f.status, f.admin_response, f.responded_at, f.created_at,
            u.id AS user_id, u.name AS user_name, u.email AS user_email,
            r.name AS respondido_por
     FROM platform_feedback f
     LEFT JOIN users u ON u.id = f.user_id
     LEFT JOIN users r ON r.id = f.responded_by
     ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
     ORDER BY FIELD(f.status, 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'), f.created_at DESC
     LIMIT 200`,
    params
  );
  const { rows: resumo } = await db.query(
    `SELECT
       COUNT(CASE WHEN status IN ('OPEN','IN_PROGRESS') AND kind = 'COMPLAINT' THEN 1 END) AS reclamacoes_abertas,
       COUNT(CASE WHEN kind = 'RATING' THEN 1 END) AS avaliacoes,
       ROUND(AVG(CASE WHEN kind = 'RATING' THEN rating END), 1) AS nota_media
     FROM platform_feedback`
  );
  return {
    itens: rows,
    resumo: {
      reclamacoes_abertas: Number(resumo[0].reclamacoes_abertas),
      avaliacoes: Number(resumo[0].avaliacoes),
      nota_media: resumo[0].nota_media == null ? null : Number(resumo[0].nota_media),
    },
  };
}

async function responder({ adminId, id, status, resposta, req }) {
  if (!STATUS[status]) throw new FeedbackError("Status inválido.", "INVALID_STATUS", 422);
  const texto = resposta == null ? null : String(resposta).trim();
  if (texto !== null && (texto.length < 2 || texto.length > 2000)) {
    throw new FeedbackError("A resposta precisa ter entre 2 e 2000 caracteres.", "INVALID_RESPONSE", 422);
  }
  const { rowCount } = await db.query(
    `UPDATE platform_feedback
     SET status = ?,
         admin_response = COALESCE(?, admin_response),
         responded_by = CASE WHEN ? IS NULL THEN responded_by ELSE ? END,
         responded_at = CASE WHEN ? IS NULL THEN responded_at ELSE NOW(6) END
     WHERE id = ?`,
    [status, texto, texto, adminId, texto, id]
  );
  if (!rowCount) throw new FeedbackError("Registro não encontrado.", "NOT_FOUND", 404);
  await auditService.log(AuditAction.ADMIN_FEEDBACK_ANSWERED, {
    req, userId: adminId, metadata: { id, status, respondeu: texto !== null },
  });
  return { id, status };
}

module.exports = { FeedbackError, TIPOS, STATUS, criar, meus, listarAdmin, responder };
