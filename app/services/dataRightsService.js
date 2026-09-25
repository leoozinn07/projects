/* ==============================================================
   AquaTrip — Direitos do titular (LGPD, arts. 18 e 19)
   ==============================================================
   Dois caminhos, propositalmente diferentes:

   - ACESSO e PORTABILIDADE são atendidos NA HORA, gerando um JSON
     com tudo que o sistema tem sobre a pessoa. Não há motivo para
     transformar em ticket algo que a aplicação sabe responder.

   - CORREÇÃO, ELIMINAÇÃO e ANONIMIZAÇÃO viram solicitação
     registrada. Não é burocracia: apagar conta com reserva paga
     esbarra em obrigação legal de guarda fiscal, então a decisão
     exige análise humana — e o registro é o que prova o
     cumprimento do prazo do art. 19.
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");
const auditService = require("./auditService");
const consentService = require("./consentService");
const { AuditAction } = auditService;

const KINDS = Object.freeze({
  ACCESS: "ACCESS",
  PORTABILITY: "PORTABILITY",
  CORRECTION: "CORRECTION",
  DELETION: "DELETION",
  ANONYMIZATION: "ANONYMIZATION",
  INFO_SHARING: "INFO_SHARING",
});

const KIND_LABELS = {
  ACCESS: "Acesso aos dados",
  PORTABILITY: "Portabilidade",
  CORRECTION: "Correção de dados",
  DELETION: "Eliminação de dados",
  ANONYMIZATION: "Anonimização",
  INFO_SHARING: "Informação sobre compartilhamento",
};

/**
 * Monta o pacote completo de dados do titular.
 * Inclui o que existe de fato — nada de campo vazio para "parecer
 * completo", e nada de hash de senha ou token (não são dados do
 * titular, são credenciais).
 */
async function exportUserData(userId, req = null) {
  const [perfil, reservas, pagamentos, consentimentos, solicitacoes, acessos, viagens, avaliacoes, parceiro] =
    await Promise.all([
      db.query(
        `SELECT id, name, email, role, status, suspended_until, suspended_reason,
                email_verified_at, last_login_at, created_at, bio
         FROM users WHERE id = ?`,
        [userId]
      ),
      db.query(
        `SELECT b.id, b.status, b.quantity, b.amount_cents, b.currency,
                b.created_at, b.confirmed_at, b.cancelled_at,
                s.starts_at, sv.title AS experiencia, sv.location AS local
         FROM bookings b
         JOIN service_slots s ON s.id = b.slot_id
         JOIN services sv ON sv.id = s.service_id
         WHERE b.user_id = ?
         ORDER BY b.created_at DESC`,
        [userId]
      ),
      db.query(
        `SELECT p.id, p.method, p.status, p.amount_cents, p.currency,
                p.installments, p.paid_at, p.refunded_at, p.created_at,
                p.provider
         FROM payments p
         JOIN bookings b ON b.id = p.booking_id
         WHERE b.user_id = ?
         ORDER BY p.created_at DESC`,
        [userId]
      ),
      db.query(
        `SELECT policy_version, necessary, analytics, marketing, action, created_at
         FROM consent_records WHERE user_id = ? ORDER BY created_at DESC`,
        [userId]
      ),
      db.query(
        `SELECT kind, status, details, response, created_at, resolved_at
         FROM data_requests WHERE user_id = ? ORDER BY created_at DESC`,
        [userId]
      ),
      db.query(
        `SELECT action, ip_address, created_at
         FROM audit_log WHERE user_id = ?
         ORDER BY created_at DESC LIMIT 200`,
        [userId]
      ),
      db.query(
        // MySQL não tem NULLS LAST, mas trata NULL como o menor valor em
        // ORDER BY — DESC já deixa os nulos por último sozinho.
        `SELECT place, region, starts_on, ends_on, rating, notes, tags, created_at
         FROM trips WHERE user_id = ? ORDER BY starts_on DESC`,
        [userId]
      ),
      db.query(
        `SELECT sv.title AS experiencia, r.rating AS nota, r.title AS titulo, r.body AS texto,
                r.status, r.hidden_reason AS motivo_ocultacao, r.created_at
         FROM reviews r JOIN services sv ON sv.id = r.service_id
         WHERE r.user_id = ? ORDER BY r.created_at DESC`,
        [userId]
      ),
      // Cadastro de parceiro, se houver. Tokens do Mercado Pago NÃO:
      // são credenciais, não dado pessoal exportável.
      db.query(
        `SELECT person_type, document, legal_name, display_name, phone, city, state, description,
                status, rejection_reason, commission_pct, mp_connected_at, created_at
         FROM partners WHERE user_id = ?`,
        [userId]
      ),
    ]);

  const [experienciasCriadas, comentarios, curtidas, seguindo, seguidores, interesses, feedbacks, denuncias] = await Promise.all([
    db.query(
      `SELECT title, location, category, price_cents, description, trip_info, active, moderation_status, created_at
       FROM services WHERE creator_user_id = ? ORDER BY created_at DESC`, [userId]),
    db.query(
      `SELECT sv.title AS experiencia, c.body AS texto, c.status, c.created_at
       FROM experience_comments c JOIN services sv ON sv.id = c.service_id
       WHERE c.user_id = ? ORDER BY c.created_at DESC`, [userId]),
    db.query(
      `SELECT sv.title AS experiencia, l.created_at FROM experience_likes l JOIN services sv ON sv.id = l.service_id
       WHERE l.user_id = ? ORDER BY l.created_at DESC`, [userId]),
    // De outras pessoas só o nome público: é o que já aparece no perfil delas.
    db.query(`SELECT u.name, f.created_at FROM user_follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ?`, [userId]),
    db.query(`SELECT COUNT(*) AS n FROM user_follows WHERE followee_id = ?`, [userId]),
    db.query(
      `SELECT sv.title AS experiencia, i.created_at FROM experience_interests i JOIN services sv ON sv.id = i.service_id
       WHERE i.user_id = ?`, [userId]),
    db.query(
      `SELECT kind, rating, subject, message, status, admin_response, responded_at, created_at
       FROM platform_feedback WHERE user_id = ? ORDER BY created_at DESC`, [userId]),
    db.query(
      `SELECT sv.title AS experiencia, r.reason, r.details, r.status, r.created_at
       FROM experience_reports r JOIN services sv ON sv.id = r.service_id WHERE r.reporter_id = ?`, [userId]),
  ]);
  const { nomeExibido } = require("./reviewService");

  if (req) {
    await auditService.log(AuditAction.DATA_EXPORTED, {
      req,
      userId,
      metadata: { reservas: reservas.rowCount, pagamentos: pagamentos.rowCount },
    });
  }

  return {
    _sobre: {
      gerado_em: new Date().toISOString(),
      formato: "JSON",
      observacao:
        "Exportação dos dados pessoais tratados pelo AquaTrip, conforme art. 18 da LGPD. " +
        "Credenciais (hash de senha, tokens de sessão) não são incluídas por não constituírem " +
        "dado pessoal exportável e por representarem risco de segurança se expostas.",
      versao_politica_privacidade: consentService.POLICY_VERSION,
    },
    perfil: perfil.rows[0] || null,
    reservas: reservas.rows,
    pagamentos: pagamentos.rows.map((p) => ({
      ...p,
      observacao_cartao:
        "Dados de cartão nunca são armazenados pelo AquaTrip — ficam com o provedor de pagamento.",
    })),
    consentimentos: consentimentos.rows,
    solicitacoes_de_privacidade: solicitacoes.rows,
    diario_de_viagens: viagens.rows,
    avaliacoes: avaliacoes.rows,
    cadastro_de_parceiro: parceiro.rows[0] || null,
    comunidade: {
      experiencias_criadas: experienciasCriadas.rows,
      comentarios: comentarios.rows,
      curtidas: curtidas.rows,
      interesses: interesses.rows,
      seguindo: seguindo.rows.map((r) => ({ nome: nomeExibido(r.name), desde: r.created_at })),
      total_de_seguidores: Number(seguidores.rows[0].n),
      denuncias_enviadas: denuncias.rows,
    },
    reclamacoes_e_avaliacoes_do_aquatrip: feedbacks.rows,
    registros_de_acesso: acessos.rows,
  };
}

/** Cria uma solicitação que exige análise humana. */
async function createRequest({ userId, kind, details, req }) {
  if (!Object.values(KINDS).includes(kind)) {
    throw new Error("Tipo de solicitação inválido.");
  }

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO data_requests (id, user_id, kind, details, requested_ip)
     VALUES (?, ?, ?, ?, ?)`,
    [id, userId, kind, details || null, consentService.minimizarIp(auditService.clientIp(req))]
  );
  const { rows } = await db.query(
    `SELECT id, kind, status, created_at FROM data_requests WHERE id = ?`,
    [id]
  );

  await auditService.log(AuditAction.DATA_REQUEST_CREATED, {
    req,
    userId,
    metadata: { tipo: kind, solicitacaoId: id },
  });

  return rows[0];
}

async function listRequests(userId) {
  const { rows } = await db.query(
    `SELECT id, kind, status, details, response, created_at, resolved_at
     FROM data_requests WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

module.exports = { KINDS, KIND_LABELS, exportUserData, createRequest, listRequests };
