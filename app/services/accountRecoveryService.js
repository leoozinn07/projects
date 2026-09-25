/* ==============================================================
   AquaTrip — Account Recovery Service
   Recuperação de senha e verificação de e-mail.

   Duas ameaças guiam o desenho aqui:
   1) ENUMERAÇÃO DE CONTAS — "esqueci a senha" é o ponto clássico de
      vazamento: se a resposta muda conforme o e-mail existe ou não,
      vira uma API para descobrir quem tem conta. Por isso a resposta
      é SEMPRE idêntica.
   2) TOMADA DE CONTA — token longo e opaco, guardado só como hash,
      uso único consumido atomicamente, validade curta, e toda sessão
      antiga derrubada após a troca.
   ============================================================== */
const argon2 = require("argon2");
const db = require("../lib/db");
const log = require("../lib/logger").forModule("recuperacao");
const userRepository = require("../repositories/userRepository");
const tokenRepository = require("../repositories/tokenRepository");
const mailService = require("./mailService");
const auditService = require("./auditService");
const { AuditAction } = auditService;

const RESET_EXPIRES_MINUTES = Number(process.env.PASSWORD_RESET_EXPIRES_MINUTES || 30);
const VERIFY_EXPIRES_HOURS = Number(process.env.EMAIL_VERIFY_EXPIRES_HOURS || 48);
const MAX_RESETS_PER_HOUR = Number(process.env.PASSWORD_RESET_MAX_PER_HOUR || 5);

const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

class RecoveryError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "RecoveryError";
    this.code = code;
  }
}

function baseUrl() {
  return process.env.PUBLIC_BASE_URL || "http://localhost:3000";
}

/* ==============================================================
   RECUPERAÇÃO DE SENHA
   ============================================================== */

/**
 * Inicia a recuperação. NUNCA revela se o e-mail existe: o chamador
 * sempre mostra a mesma mensagem, aconteça o que acontecer aqui.
 */
async function requestPasswordReset({ email, req = null }) {
  const normalizado = String(email || "").trim().toLowerCase();
  const user = await userRepository.findByEmail(normalizado);

  if (!user) {
    // Conta inexistente: registramos para detectar varredura, mas o
    // usuário final recebe a mesma resposta de sucesso.
    await auditService.log(AuditAction.PASSWORD_RESET_REQUESTED, {
      req,
      metadata: { email: normalizado, encontrado: false },
    });
    return { sent: false };
  }

  // Freio contra uso do sistema como máquina de spam contra um
  // endereço real (e contra gasto de cota do provedor de e-mail).
  const recentes = await tokenRepository.countRecentResetRequests(user.id, 60);
  if (recentes >= MAX_RESETS_PER_HOUR) {
    await auditService.log(AuditAction.PASSWORD_RESET_THROTTLED, {
      req,
      userId: user.id,
      metadata: { pedidosNaUltimaHora: recentes },
    });
    return { sent: false, throttled: true };
  }

  const token = await tokenRepository.createPasswordResetToken({
    userId: user.id,
    expiresInMinutes: RESET_EXPIRES_MINUTES,
    requestedIp: auditService.clientIp(req),
  });

  const url = `${baseUrl()}/redefinir-senha/${token}`;

  try {
    await mailService.sendPasswordReset({
      to: user.email,
      name: user.name,
      url,
      expiraEmMinutos: RESET_EXPIRES_MINUTES,
    });
  } catch (err) {
    // Falha de envio não vaza nada para o usuário: ele vê a mesma
    // mensagem. Mas precisa ficar registrado para o time.
    log.error({ err }, "falha ao enviar e-mail de reset");
  }

  await auditService.log(AuditAction.PASSWORD_RESET_REQUESTED, {
    req,
    userId: user.id,
    metadata: { email: user.email, encontrado: true },
  });

  return { sent: true, token, url };
}

/** Verifica se um token de reset ainda é utilizável (para exibir o form). */
async function checkResetToken(token) {
  if (!token || typeof token !== "string" || token.length < 32) return false;
  const row = await tokenRepository.peekPasswordResetToken(token);
  return Boolean(row);
}

/**
 * Conclui a redefinição. O token é consumido atomicamente, então dois
 * cliques simultâneos no mesmo link não trocam a senha duas vezes.
 */
async function resetPassword({ token, newPassword, req = null }) {
  if (!newPassword || newPassword.length < 8) {
    throw new RecoveryError("A senha precisa ter pelo menos 8 caracteres.", "WEAK_PASSWORD");
  }
  if (newPassword.length > 72) {
    throw new RecoveryError("Senha longa demais.", "PASSWORD_TOO_LONG");
  }

  const row = await tokenRepository.consumePasswordResetToken(token);
  if (!row) {
    throw new RecoveryError(
      "Este link de redefinição é inválido ou já expirou. Peça um novo.",
      "INVALID_TOKEN"
    );
  }

  const hash = await argon2.hash(newPassword, HASH_OPTIONS);
  const user = await userRepository.updatePassword(row.user_id, hash);

  await auditService.log(AuditAction.PASSWORD_RESET_COMPLETED, {
    req,
    userId: row.user_id,
    metadata: { email: user?.email },
  });

  // Avisa o dono da conta. Se não foi ele, é o sinal para reagir.
  if (user) {
    try {
      await mailService.sendPasswordChanged({ to: user.email, name: user.name });
    } catch (err) {
      log.error({ err }, "falha ao avisar troca de senha");
    }
  }

  return user;
}

/* ==============================================================
   VERIFICAÇÃO DE E-MAIL
   ============================================================== */

async function sendVerificationEmail({ userId, req = null }) {
  const user = await userRepository.findById(userId);
  if (!user) throw new RecoveryError("Usuário não encontrado.", "USER_NOT_FOUND");

  if (user.email_verified_at) {
    return { alreadyVerified: true };
  }

  const token = await tokenRepository.createEmailVerificationToken({
    userId: user.id,
    expiresInHours: VERIFY_EXPIRES_HOURS,
  });

  const url = `${baseUrl()}/verificar-email/${token}`;

  try {
    await mailService.sendEmailVerification({
      to: user.email,
      name: user.name,
      url,
      expiraEmHoras: VERIFY_EXPIRES_HOURS,
    });
  } catch (err) {
    log.error({ err }, "falha ao enviar verificação");
  }

  await auditService.log(AuditAction.EMAIL_VERIFICATION_SENT, {
    req,
    userId: user.id,
    metadata: { email: user.email },
  });

  return { sent: true, token, url };
}

async function verifyEmail({ token, req = null }) {
  const row = await tokenRepository.consumeEmailVerificationToken(token);
  if (!row) {
    throw new RecoveryError(
      "Este link de confirmação é inválido ou já expirou.",
      "INVALID_TOKEN"
    );
  }

  // Link de TROCA de e-mail: o endereço novo só passa a valer agora,
  // depois de provado que a pessoa controla a caixa dele.
  if (row.new_email) {
    const antes = await userRepository.findById(row.user_id);
    try {
      await db.query(
        `UPDATE users SET email = ?, email_verified_at = NOW() WHERE id = ?`,
        [row.new_email, row.user_id]
      );
    } catch (err) {
      // ER_DUP_ENTRY (errno 1062) é o equivalente MySQL do 23505
      // (unique_violation) do Postgres.
      if (err.code === "ER_DUP_ENTRY") {
        // Alguém cadastrou esse endereço entre o pedido e o clique.
        throw new RecoveryError("Este e-mail passou a ser usado por outra conta. Faça um novo pedido.", "EMAIL_TAKEN");
      }
      throw err;
    }
    await auditService.log(AuditAction.EMAIL_CHANGED, { req, userId: row.user_id });
    mailService
      .send({
        to: antes.email,
        template: "email_trocado",
        subject: "O e-mail da sua conta foi alterado — AquaTrip",
        text: `${antes.name}, o e-mail da sua conta AquaTrip foi alterado. ` +
              `Se não foi você, responda esta mensagem imediatamente.`,
      })
      .catch(() => {});
    return { ...(await userRepository.findById(row.user_id)), emailTrocado: true };
  }

  const user = await userRepository.markEmailVerified(row.user_id);

  await auditService.log(AuditAction.EMAIL_VERIFIED, {
    req,
    userId: row.user_id,
    metadata: { email: user?.email },
  });

  return user;
}

module.exports = {
  RecoveryError,
  RESET_EXPIRES_MINUTES,
  VERIFY_EXPIRES_HOURS,
  requestPasswordReset,
  checkResetToken,
  resetPassword,
  sendVerificationEmail,
  verifyEmail,
};
