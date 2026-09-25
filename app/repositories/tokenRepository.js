/* ==============================================================
   AquaTrip — Token Repository
   Tokens de verificação de e-mail e de redefinição de senha.

   REGRA: o banco só vê o HASH do token. O valor em claro existe
   apenas no e-mail do usuário. Se o banco vazar, os links enviados
   continuam inúteis — mesma lógica de nunca guardar senha em claro.
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Token opaco de 32 bytes: inviável de adivinhar por força bruta. */
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

/* ---------- Redefinição de senha ---------- */

async function createPasswordResetToken({ userId, expiresInMinutes, requestedIp }) {
  const token = generateToken();
  // Calculado aqui em JS e mandado pronto — sem aritmética de intervalo no SQL.
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Invalida pedidos anteriores ainda válidos: se alguém pediu duas
    // vezes, só o link mais recente funciona. Evita que um link antigo,
    // possivelmente já exposto, continue abrindo a conta.
    await client.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE user_id = ? AND used_at IS NULL AND expires_at > NOW()`,
      [userId]
    );

    await client.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, requested_ip)
       VALUES (?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), userId, hashToken(token), expiresAt, requestedIp]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return token; // valor em claro devolvido só para montar o e-mail
}

/**
 * Consome o token de redefinição: valida e marca como usado na MESMA
 * operação. Isso impede que dois cliques simultâneos no link (ou um
 * atacante em corrida) usem o mesmo token duas vezes. O MySQL não tem
 * UPDATE...RETURNING: o rowCount do UPDATE já garante que só quem de
 * fato consumiu o token (condição WHERE bateu) segue para o SELECT.
 */
async function consumePasswordResetToken(token) {
  const hash = hashToken(token);
  const { rowCount } = await db.query(
    `UPDATE password_reset_tokens
     SET used_at = NOW()
     WHERE token_hash = ?
       AND used_at IS NULL
       AND expires_at > NOW()`,
    [hash]
  );
  if (!rowCount) return null;
  const { rows } = await db.query(
    `SELECT user_id FROM password_reset_tokens WHERE token_hash = ?`,
    [hash]
  );
  return rows[0] || null;
}

/** Só verifica se o token é utilizável, sem consumir (para exibir o form). */
async function peekPasswordResetToken(token) {
  const { rows } = await db.query(
    `SELECT user_id FROM password_reset_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

async function countRecentResetRequests(userId, withinMinutes = 60) {
  const desde = new Date(Date.now() - withinMinutes * 60 * 1000);
  const { rows } = await db.query(
    `SELECT COUNT(*) AS total
     FROM password_reset_tokens
     WHERE user_id = ? AND created_at > ?`,
    [userId, desde]
  );
  return Number(rows[0].total);
}

/* ---------- Verificação de e-mail ---------- */

async function createEmailVerificationToken({ userId, expiresInHours, newEmail = null }) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE email_verification_tokens
       SET used_at = NOW()
       WHERE user_id = ? AND used_at IS NULL AND expires_at > NOW()`,
      [userId]
    );
    await client.query(
      `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, new_email)
       VALUES (?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), userId, hashToken(token), expiresAt, newEmail]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return token;
}

async function consumeEmailVerificationToken(token) {
  const hash = hashToken(token);
  const { rowCount } = await db.query(
    `UPDATE email_verification_tokens
     SET used_at = NOW()
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()`,
    [hash]
  );
  if (!rowCount) return null;
  const { rows } = await db.query(
    `SELECT user_id, new_email FROM email_verification_tokens WHERE token_hash = ?`,
    [hash]
  );
  return rows[0] || null;
}

/* ---------- Limpeza ---------- */

/** Remove tokens vencidos/usados há mais de 7 dias. */
async function purgeOldTokens() {
  const { rowCount: a } = await db.query(
    `DELETE FROM password_reset_tokens
     WHERE created_at < NOW() - INTERVAL 7 DAY`
  );
  const { rowCount: b } = await db.query(
    `DELETE FROM email_verification_tokens
     WHERE created_at < NOW() - INTERVAL 7 DAY`
  );
  return a + b;
}

module.exports = {
  hashToken,
  generateToken,
  createPasswordResetToken,
  consumePasswordResetToken,
  peekPasswordResetToken,
  countRecentResetRequests,
  createEmailVerificationToken,
  consumeEmailVerificationToken,
  purgeOldTokens,
};
