/* ==============================================================
   AquaTrip — User Repository
   Única camada que conhece SQL da tabela `users`. Services e
   controllers nunca montam query diretamente — sempre passam por
   aqui. Todas as queries usam parâmetros (?) para evitar SQL
   Injection; nunca concatenar valor de usuário na string SQL.
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");

async function findByEmail(email) {
  const { rows } = await db.query(
    `SELECT id, name, email, password_hash, role, failed_login_count,
            locked_until, last_login_at, created_at, email_verified_at,
            status, suspended_until, terms_version, locale
     FROM users
     WHERE email = ?`,
    [email]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT id, name, email, role, created_at, email_verified_at,
            status, suspended_until, terms_version, locale
     FROM users
     WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function create({ name, email, passwordHash, role = "USER", termsVersion = null, locale = null }) {
  const id = crypto.randomUUID();
  const termsAcceptedAt = termsVersion == null ? null : new Date();
  await db.query(
    `INSERT INTO users (id, name, email, password_hash, role, terms_version, terms_accepted_at, locale)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, email, passwordHash, role, termsVersion, termsAcceptedAt, locale]
  );
  const { rows } = await db.query(
    `SELECT id, name, email, role, created_at, terms_version, locale FROM users WHERE id = ?`,
    [id]
  );
  return rows[0];
}

/** Registra o aceite da versão vigente dos Termos e da Política. */
async function acceptTerms(id, version) {
  const acceptedAt = new Date();
  const { rowCount } = await db.query(
    `UPDATE users SET terms_version = ?, terms_accepted_at = ? WHERE id = ?`,
    [version, acceptedAt, id]
  );
  if (!rowCount) return null;
  return { terms_version: version, terms_accepted_at: acceptedAt };
}

/** Idioma escolhido nas Configurações (pt, en, es). */
async function setLocale(id, locale) {
  await db.query(`UPDATE users SET locale = ? WHERE id = ?`, [locale, id]);
}

async function updatePassword(id, passwordHash) {
  // Trocar a senha zera o bloqueio por tentativas: quem provou ser
  // dono do e-mail não deve ficar preso fora da conta.
  const { rowCount } = await db.query(
    `UPDATE users
     SET password_hash = ?, failed_login_count = 0, locked_until = NULL
     WHERE id = ?`,
    [passwordHash, id]
  );
  if (!rowCount) return null;
  const { rows } = await db.query(`SELECT id, name, email, role FROM users WHERE id = ?`, [id]);
  return rows[0] || null;
}

async function markEmailVerified(id) {
  const { rowCount } = await db.query(
    `UPDATE users
     SET email_verified_at = COALESCE(email_verified_at, ?)
     WHERE id = ?`,
    [new Date(), id]
  );
  if (!rowCount) return null;
  const { rows } = await db.query(
    `SELECT id, email, email_verified_at FROM users WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function registerFailedLogin(id) {
  // Bloqueio progressivo simples: a partir de 5 tentativas erradas,
  // trava a conta por 15 minutos. Mitiga brute force mesmo que o
  // rate limit por IP seja contornado (ex.: IPs rotativos).
  //
  // ORDEM DAS ATRIBUIÇÕES IMPORTA no MySQL: diferente do Postgres (onde
  // todo SET é avaliado contra a linha antes do UPDATE), o MySQL avalia
  // as atribuições de um UPDATE de tabela única da esquerda pra direita —
  // uma atribuição posterior já enxerga o valor NOVO de uma coluna
  // atribuída antes dela. Por isso locked_until (que lê failed_login_count)
  // vem ANTES de failed_login_count ser reatribuído: senão o CASE veria
  // failed_login_count já incrementado e travaria a conta uma tentativa
  // cedo demais (na 4ª, não na 5ª).
  await db.query(
    `UPDATE users
     SET locked_until = CASE
           WHEN failed_login_count + 1 >= 5 THEN NOW() + INTERVAL 15 MINUTE
           ELSE locked_until
         END,
         failed_login_count = failed_login_count + 1
     WHERE id = ?`,
    [id]
  );
}

async function registerSuccessfulLogin(id) {
  await db.query(
    `UPDATE users
     SET failed_login_count = 0,
         locked_until = NULL,
         last_login_at = ?
     WHERE id = ?`,
    [new Date(), id]
  );
}

module.exports = {
  findByEmail,
  acceptTerms,
  setLocale,
  findById,
  create,
  updatePassword,
  markEmailVerified,
  registerFailedLogin,
  registerSuccessfulLogin,
};
