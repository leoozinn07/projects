/* ==============================================================
   AquaTrip — Audit Service
   Camada que o resto do sistema usa para registrar eventos.
   Centraliza o catálogo de ações e a sanitização do metadata.
   ============================================================== */
const auditRepository = require("../repositories/auditRepository");

/**
 * Catálogo fechado de ações. Usar constantes (e não strings soltas)
 * evita que o mesmo evento vire "LOGIN", "login" e "user_login" em
 * lugares diferentes, o que inutilizaria qualquer consulta depois.
 */
const AuditAction = Object.freeze({
  // Autenticação
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILED: "LOGIN_FAILED",
  LOGOUT: "LOGOUT",
  USER_REGISTERED: "USER_REGISTERED",
  TERMS_ACCEPTED: "TERMS_ACCEPTED",
  LOCALE_CHANGED: "LOCALE_CHANGED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",

  // Recuperação de conta
  PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
  PASSWORD_RESET_COMPLETED: "PASSWORD_RESET_COMPLETED",
  PASSWORD_RESET_THROTTLED: "PASSWORD_RESET_THROTTLED",
  EMAIL_VERIFICATION_SENT: "EMAIL_VERIFICATION_SENT",
  EMAIL_VERIFIED: "EMAIL_VERIFIED",
  EMAIL_CHANGE_REQUESTED: "EMAIL_CHANGE_REQUESTED",
  EMAIL_CHANGED: "EMAIL_CHANGED",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  PROFILE_UPDATED: "PROFILE_UPDATED",

  // Verificação em duas etapas
  MFA_CHALLENGED: "MFA_CHALLENGED",
  MFA_FAILED: "MFA_FAILED",
  MFA_ENABLED: "MFA_ENABLED",
  MFA_DISABLED: "MFA_DISABLED",
  MFA_CODES_REGENERATED: "MFA_CODES_REGENERATED",
  MFA_RESET_BY_ADMIN: "MFA_RESET_BY_ADMIN",
  MFA_RESET_BY_SERVER: "MFA_RESET_BY_SERVER",

  // Avaliações
  REVIEW_CREATED: "REVIEW_CREATED",
  REVIEW_DELETED: "REVIEW_DELETED",
  REVIEW_HIDDEN: "REVIEW_HIDDEN",
  REVIEW_RESTORED: "REVIEW_RESTORED",
  PHOTO_SUBMITTED: "PHOTO_SUBMITTED",
  PHOTO_APPROVED: "PHOTO_APPROVED",
  PHOTO_REJECTED: "PHOTO_REJECTED",

  // Marketplace
  PARTNER_APPLIED: "PARTNER_APPLIED",
  PARTNER_DECIDED: "PARTNER_DECIDED",
  PARTNER_SERVICE_CREATED: "PARTNER_SERVICE_CREATED",
  PARTNER_SERVICE_UPDATED: "PARTNER_SERVICE_UPDATED",
  PARTNER_SERVICE_SUBMITTED: "PARTNER_SERVICE_SUBMITTED",
  PARTNER_SERVICE_REVIEWED: "PARTNER_SERVICE_REVIEWED",
  PARTNER_MP_CONNECTED: "PARTNER_MP_CONNECTED",
  PARTNER_MP_DISCONNECTED: "PARTNER_MP_DISCONNECTED",

  // Privacidade / LGPD
  CONSENT_CHANGED: "CONSENT_CHANGED",
  DATA_REQUEST_CREATED: "DATA_REQUEST_CREATED",
  DATA_EXPORTED: "DATA_EXPORTED",
  DATA_REQUEST_ANSWERED: "DATA_REQUEST_ANSWERED",

  // Reservas
  BOOKING_CREATED: "BOOKING_CREATED",
  BOOKING_CANCELLED: "BOOKING_CANCELLED",
  BOOKING_CONFIRMED: "BOOKING_CONFIRMED",
  BOOKING_EXPIRED: "BOOKING_EXPIRED",
  BOOKING_RECONCILED: "BOOKING_RECONCILED",

  // Pagamentos
  PAYMENT_STARTED: "PAYMENT_STARTED",
  PAYMENT_STATUS_CHANGED: "PAYMENT_STATUS_CHANGED",
  PAYMENT_REFUNDED: "PAYMENT_REFUNDED",

  // Webhooks
  WEBHOOK_RECEIVED: "WEBHOOK_RECEIVED",
  WEBHOOK_REJECTED: "WEBHOOK_REJECTED",

  // Área administrativa
  ADMIN_ACCESS: "ADMIN_ACCESS",
  ADMIN_USER_SUSPENDED: "ADMIN_USER_SUSPENDED",
  ADMIN_USER_REACTIVATED: "ADMIN_USER_REACTIVATED",
  ADMIN_SERVICE_CREATED: "ADMIN_SERVICE_CREATED",
  ADMIN_SERVICE_UPDATED: "ADMIN_SERVICE_UPDATED",
  ADMIN_SLOTS_CREATED: "ADMIN_SLOTS_CREATED",
  ADMIN_SLOTS_UPDATED: "ADMIN_SLOTS_UPDATED",
  ACCESS_DENIED: "ACCESS_DENIED",
});

/**
 * Chaves que jamais podem entrar na trilha de auditoria. A trilha é
 * lida por operadores e costuma ser exportada — vazar segredo aqui
 * é tão grave quanto vazar no log da aplicação.
 */
const BLOCKED_KEYS = [
  "senha",
  "password",
  "password_hash",
  "passwordHash",
  "_csrf",
  "csrfToken",
  "token",
  "cardToken",
  "card_number",
  "cardNumber",
  "cvv",
  "securityCode",
  "security_code",
  "authorization",
  "cookie",
  "secret",
];

function sanitize(metadata) {
  if (!metadata || typeof metadata !== "object") return null;

  const clean = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lower = key.toLowerCase();
    if (BLOCKED_KEYS.some((blocked) => lower.includes(blocked.toLowerCase()))) {
      continue; // descarta silenciosamente
    }
    // Não guardamos objetos aninhados profundos: além de inflar a
    // tabela, é por onde dado sensível costuma entrar sem querer.
    if (value && typeof value === "object") {
      clean[key] = Array.isArray(value) ? `[${value.length} itens]` : "[objeto]";
    } else {
      clean[key] = value;
    }
  }
  return Object.keys(clean).length ? clean : null;
}

/**
 * Extrai o IP do cliente. Como a app roda com `trust proxy`, o
 * express já resolve X-Forwarded-For; mantemos um fallback e
 * truncamos para caber na coluna.
 */
function clientIp(req) {
  if (!req) return null;
  const ip = req.ip || req.connection?.remoteAddress || null;
  return ip ? String(ip).slice(0, 64) : null;
}

/**
 * Registra um evento. Recebe `req` para extrair IP e usuário da
 * sessão automaticamente — assim o chamador não precisa repetir isso.
 */
async function log(action, { req = null, userId = null, metadata = null } = {}) {
  const resolvedUserId = userId || req?.session?.user?.id || null;
  return auditRepository.record({
    userId: resolvedUserId,
    action,
    ipAddress: clientIp(req),
    metadata: sanitize(metadata),
  });
}

module.exports = {
  AuditAction,
  log,
  sanitize,
  clientIp,
  list: auditRepository.list,
  countAll: auditRepository.countAll,
  listActions: auditRepository.listActions,
};
