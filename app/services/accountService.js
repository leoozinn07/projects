/* ==============================================================
   AquaTrip — Minha conta
   ==============================================================
   Edição de nome, troca de senha e troca de e-mail.

   Senha e e-mail exigem a SENHA ATUAL. Motivo: uma sessão aberta
   num computador compartilhado, ou roubada, não pode bastar para
   tomar a conta de vez. Nome não exige — não dá acesso a nada.
   ============================================================== */
const argon2 = require("argon2");
const db = require("../lib/db");
const userRepository = require("../repositories/userRepository");
const tokenRepository = require("../repositories/tokenRepository");
const mailService = require("./mailService");
const auditService = require("./auditService");
const log = require("../lib/logger").forModule("conta");
const { AuditAction } = auditService;

const HASH_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const EMAIL_CHANGE_HOURS = 24;

class AccountError extends Error {
  constructor(message, code, campo = null, status = 400) {
    super(message);
    this.code = code;
    this.campo = campo;
    this.status = status;
  }
}

async function senhaConfere(userId, senha) {
  const { rows } = await db.query(`SELECT password_hash FROM users WHERE id = ?`, [userId]);
  if (!rows[0] || !senha) return false;
  try {
    return await argon2.verify(rows[0].password_hash, senha);
  } catch {
    return false;
  }
}

/** Resumo exibido na página "Minha conta". */
async function overview(userId) {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.email_verified_at, u.created_at,
            (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.status = 'CONFIRMED') AS reservas,
            (SELECT COUNT(*) FROM trips t WHERE t.user_id = u.id) AS viagens,
            (SELECT new_email FROM email_verification_tokens
              WHERE user_id = u.id AND new_email IS NOT NULL AND used_at IS NULL AND expires_at > NOW()
              ORDER BY created_at DESC LIMIT 1) AS email_pendente
     FROM users u WHERE u.id = ?`,
    [userId]
  );
  const r = rows[0];
  if (!r) return null;
  return { ...r, reservas: Number(r.reservas), viagens: Number(r.viagens) };
}

/* ---------- Nome ---------- */

async function updateName({ userId, name, req }) {
  await db.query(`UPDATE users SET name = ? WHERE id = ?`, [name, userId]);
  const { rows } = await db.query(
    `SELECT id, name, email, role FROM users WHERE id = ?`,
    [userId]
  );
  await auditService.log(AuditAction.PROFILE_UPDATED, { req, userId, metadata: { campo: "nome" } });
  return rows[0];
}

/* ---------- Senha ---------- */

async function changePassword({ userId, atual, nova, req }) {
  if (!(await senhaConfere(userId, atual))) {
    throw new AccountError("Senha atual incorreta.", "WRONG_PASSWORD", "senhaAtual");
  }
  if (atual === nova) {
    throw new AccountError("A nova senha precisa ser diferente da atual.", "SAME_PASSWORD", "novaSenha");
  }
  const hash = await argon2.hash(nova, HASH_OPTIONS);
  const user = await userRepository.updatePassword(userId, hash);

  // Derruba as OUTRAS sessões: se alguém entrou com a senha antiga,
  // perde o acesso agora. A sessão atual é regenerada no controller.
  await db.query(
    `DELETE FROM session
     WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.user.id')) = ? AND session_id <> ?`,
    [userId, req.sessionID]
  );

  await auditService.log(AuditAction.PASSWORD_CHANGED, { req, userId });
  mailService
    .sendPasswordChanged({ to: user.email, name: user.name })
    .catch((err) => log.error({ err }, "falha ao avisar troca de senha"));
  return user;
}

/* ---------- E-mail ---------- */

async function requestEmailChange({ userId, novoEmail, senha, req }) {
  if (!(await senhaConfere(userId, senha))) {
    throw new AccountError("Senha incorreta.", "WRONG_PASSWORD", "senhaEmail");
  }
  const user = await userRepository.findById(userId);
  const destino = novoEmail.trim().toLowerCase();
  if (destino === String(user.email).toLowerCase()) {
    throw new AccountError("Esse já é o seu e-mail.", "SAME_EMAIL", "novoEmail");
  }

  // Endereço já usado por outra conta: a resposta é a MESMA de sucesso
  // (anti-enumeração) — senão o formulário vira detector de contas.
  // O link simplesmente não é enviado.
  const ocupado = await userRepository.findByEmail(destino);

  if (!ocupado) {
    const token = await tokenRepository.createEmailVerificationToken({
      userId,
      expiresInHours: EMAIL_CHANGE_HOURS,
      newEmail: destino,
    });
    const base = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
    try {
      await mailService.send({
        to: destino,
        template: "email_troca",
        subject: "Confirme seu novo e-mail — AquaTrip",
        text:
          `${user.name}, recebemos um pedido para usar este endereço na sua conta AquaTrip.\n\n` +
          `Para confirmar, abra: ${base}/verificar-email/${token}\n\n` +
          `O link vale por ${EMAIL_CHANGE_HOURS} horas. Se não foi você, ignore — nada muda.`,
      });
    } catch (err) {
      log.error({ err }, "falha ao enviar confirmação de troca de e-mail");
    }
  }

  // O endereço ATUAL é avisado sempre: se não foi o dono, ele fica
  // sabendo enquanto ainda controla a conta.
  mailService
    .send({
      to: user.email,
      template: "email_troca_aviso",
      subject: "Pedido de troca de e-mail — AquaTrip",
      text:
        `${user.name}, alguém pediu para trocar o e-mail da sua conta AquaTrip.\n\n` +
        `Nada muda até o novo endereço ser confirmado. Se não foi você, troque sua ` +
        `senha agora: isso encerra todas as sessões abertas.`,
    })
    .catch((err) => log.error({ err }, "falha ao avisar e-mail atual"));

  await auditService.log(AuditAction.EMAIL_CHANGE_REQUESTED, { req, userId });
  return { enviado: true };
}

module.exports = {
  AccountError,
  EMAIL_CHANGE_HOURS,
  overview,
  updateName,
  changePassword,
  requestEmailChange,
};
