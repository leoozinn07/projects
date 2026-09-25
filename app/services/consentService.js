/* ==============================================================
   AquaTrip — Consent Service (LGPD)
   ==============================================================
   Registra e consulta as manifestações de consentimento.

   Três princípios guiam o que é gravado aqui:

   1) DEMONSTRABILIDADE (art. 8º, §2º) — o controlador precisa
      provar que houve consentimento. Por isso cada decisão vira
      uma linha imutável, com a versão do texto vigente.
   2) GRANULARIDADE (art. 9º, §1º) — analytics e marketing são
      finalidades separadas. "Necessários" não entra como
      consentimento: a base legal é outra (execução do contrato).
   3) REVOGABILIDADE (art. 8º, §5º) — revogar precisa ser tão
      fácil quanto consentir. Revogação também vira registro.
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");
const auditService = require("./auditService");
const { AuditAction } = auditService;

/* Versão do texto de privacidade. Ao publicar uma nova política,
   incremente aqui: quem consentiu com a versão antiga volta a ver
   o banner, porque consentiu com outro texto. */
const POLICY_VERSION = process.env.PRIVACY_POLICY_VERSION || "1.0";

const ACTIONS = Object.freeze({
  ACCEPT_ALL: "accept_all",
  REJECT_NON_ESSENTIAL: "reject_non_essential",
  CUSTOM: "custom",
  WITHDRAWN: "withdrawn",
});

/** Gera/recupera o id anônimo do visitante, guardado na sessão. */
function visitorId(req) {
  if (!req.session.visitorId) {
    req.session.visitorId = crypto.randomUUID();
  }
  return req.session.visitorId;
}

/**
 * Trunca o IP antes de gravar. O endereço completo raramente é
 * necessário para provar o consentimento, e guardar menos é o
 * princípio da minimização (art. 6º, III).
 */
function minimizarIp(ip) {
  if (!ip) return null;
  const limpo = String(ip).replace(/^::ffff:/, "");
  if (limpo.includes(".")) {
    const p = limpo.split(".");
    return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0` : limpo.slice(0, 64);
  }
  // IPv6: mantém o prefixo de rede
  return limpo.split(":").slice(0, 4).join(":") + "::";
}

/** Registra uma decisão de consentimento. */
async function record(req, { analytics = false, marketing = false, action }) {
  const escolha = {
    visitorId: visitorId(req),
    userId: req.session.user?.id || null,
    policyVersion: POLICY_VERSION,
    analytics: Boolean(analytics),
    marketing: Boolean(marketing),
    action,
    ip: minimizarIp(auditService.clientIp(req)),
    userAgent: (req.headers["user-agent"] || "").slice(0, 400) || null,
  };

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO consent_records
       (id, visitor_id, user_id, policy_version, necessary, analytics, marketing,
        action, ip_address, user_agent)
     VALUES (?, ?, ?, ?, TRUE, ?, ?, ?, ?, ?)`,
    [
      id,
      escolha.visitorId,
      escolha.userId,
      escolha.policyVersion,
      escolha.analytics,
      escolha.marketing,
      escolha.action,
      escolha.ip,
      escolha.userAgent,
    ]
  );
  const { rows } = await db.query(
    `SELECT id, policy_version, analytics, marketing, action, created_at
     FROM consent_records WHERE id = ?`,
    [id]
  );

  // Espelha na sessão para o servidor decidir o que pode carregar
  // sem consultar o banco a cada requisição.
  // Revogação LIMPA o espelho: se guardássemos {analytics:false} como
  // se fosse uma decisão válida, current() devolveria o cache e o
  // aviso nunca voltaria a aparecer — na prática, impedindo a pessoa
  // de consentir de novo depois de revogar.
  if (action === ACTIONS.WITHDRAWN) {
    delete req.session.consent;
  } else {
    req.session.consent = {
      version: POLICY_VERSION,
      analytics: escolha.analytics,
      marketing: escolha.marketing,
    };
  }

  await auditService.log(AuditAction.CONSENT_CHANGED, {
    req,
    metadata: {
      acao: action,
      versao: POLICY_VERSION,
      analytics: escolha.analytics,
      marketing: escolha.marketing,
    },
  });

  return rows[0];
}

/** Consentimento vigente para esta sessão (ou null se nunca decidiu). */
async function current(req) {
  if (req.session.consent?.version === POLICY_VERSION) {
    return req.session.consent;
  }

  const vid = req.session.visitorId;
  const uid = req.session.user?.id;
  if (!vid && !uid) return null;

  const { rows } = await db.query(
    `SELECT policy_version, analytics, marketing, action, created_at
     FROM consent_records
     WHERE visitor_id = ? OR user_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [vid || null, uid || null]
  );

  const ultimo = rows[0];
  // Política nova => precisa consentir de novo.
  if (!ultimo || ultimo.policy_version !== POLICY_VERSION) return null;
  if (ultimo.action === ACTIONS.WITHDRAWN) return null;

  req.session.consent = {
    version: ultimo.policy_version,
    analytics: ultimo.analytics,
    marketing: ultimo.marketing,
  };
  return req.session.consent;
}

/** Histórico do titular — alimenta a Central de Privacidade. */
async function history(userId, limit = 20) {
  const { rows } = await db.query(
    `SELECT policy_version, analytics, marketing, action, ip_address, created_at
     FROM consent_records
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, limit]
  );
  return rows;
}

module.exports = {
  POLICY_VERSION,
  ACTIONS,
  visitorId,
  minimizarIp,
  record,
  current,
  history,
};
