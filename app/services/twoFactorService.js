/* ==============================================================
   AquaTrip — Autenticação em dois fatores (TOTP)
   ==============================================================
   TOTP (app autenticador: Google Authenticator, Authy, 1Password...)
   e não SMS: SMS é vulnerável a clonagem de chip (SIM swap), o golpe
   mais comum contra 2FA no Brasil.

   Proteções:
   - Segredo de 160 bits (RFC 4226), CRIPTOGRAFADO com AES-256-GCM.
     A chave (TOTP_ENCRYPTION_KEY) fica fora do banco: um dump do
     banco sozinho não gera códigos.
   - Código de uso único: guardamos o último intervalo aceito e
     recusamos qualquer código de intervalo igual ou anterior.
   - Tolerância de ±1 intervalo (30 s) para relógio de celular atrasado.
   - Códigos de recuperação com hash; cada um vale uma vez.
   ============================================================== */
const crypto = require("crypto");
const { authenticator } = require("otplib");
const QRCode = require("qrcode");
const db = require("../lib/db");
const log = require("../lib/logger").forModule("2fa");

authenticator.options = { step: 30, window: 1, digits: 6 };

const EMISSOR = process.env.TOTP_ISSUER || "AquaTrip";
const QTD_RECUPERACAO = 10;

class TwoFactorError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* ---------- Criptografia do segredo ---------- */
function chave() {
  const b64 = process.env.TOTP_ENCRYPTION_KEY;
  if (b64) {
    const k = Buffer.from(b64, "base64");
    if (k.length !== 32) throw new Error("[2fa] TOTP_ENCRYPTION_KEY precisa ter 32 bytes em base64.");
    return k;
  }
  if (process.env.NODE_ENV === "production") {
    // Em produção, sem chave própria = recusa subir o 2FA. Derivar do
    // SESSION_SECRET misturaria dois segredos com ciclos de vida diferentes.
    throw new Error("[2fa] TOTP_ENCRYPTION_KEY é obrigatória em produção.");
  }
  log.warn("TOTP_ENCRYPTION_KEY ausente: usando chave derivada (só em desenvolvimento).");
  return crypto.createHash("sha256").update("dev-2fa:" + (process.env.SESSION_SECRET || "")).digest();
}

function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", chave(), iv);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), dados.toString("base64")].join(":");
}

function decifrar(pacote) {
  const [versao, iv, tag, dados] = String(pacote).split(":");
  if (versao !== "v1") throw new Error("formato de segredo desconhecido");
  const d = crypto.createDecipheriv("aes-256-gcm", chave(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64")); // GCM detecta adulteração
  return Buffer.concat([d.update(Buffer.from(dados, "base64")), d.final()]).toString("utf8");
}

/* ---------- Verificação ---------- */
const passoAtual = () => Math.floor(Date.now() / 1000 / 30);
const normalizar = (c) => String(c || "").replace(/\s|-/g, "");

/** Qual passo (intervalo de 30 s) o código corresponde, ou null. */
function passoDoCodigo(codigo, segredo) {
  if (!/^\d{6}$/.test(codigo)) return null;
  const delta = authenticator.checkDelta(codigo, segredo); // -1, 0, +1 ou null
  return delta === null ? null : passoAtual() + delta;
}

async function statusDe(userId) {
  const { rows } = await db.query(
    `SELECT totp_enabled_at,
            (SELECT COUNT(*) FROM recovery_codes r WHERE r.user_id = u.id AND r.used_at IS NULL) AS recuperacao_restantes
     FROM users u WHERE id = ?`,
    [userId]
  );
  return { ativo: Boolean(rows[0]?.totp_enabled_at), ativadoEm: rows[0]?.totp_enabled_at || null,
           recuperacaoRestantes: Number(rows[0]?.recuperacao_restantes || 0) };
}

/* ---------- Configuração ---------- */

/** Segredo novo, de 160 bits (RFC 4226). Ainda NÃO gravado. */
const gerarSegredo = () => authenticator.generateSecret(20);

/** QR code (data URL, permitido pela CSP img-src) e URI otpauth. */
async function qrPara(email, segredo) {
  const uri = authenticator.keyuri(email, EMISSOR, segredo);
  return { uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

function gerarCodigosRecuperacao() {
  // 10 caracteres base32 em dois blocos: fácil de digitar, ~50 bits cada.
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: QTD_RECUPERACAO }, () => {
    const b = crypto.randomBytes(10);
    const s = Array.from(b, (x) => alfabeto[x % alfabeto.length]).join("");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
const hashCodigo = (c) => crypto.createHash("sha256").update(normalizar(c).toUpperCase()).digest("hex");

async function gravarCodigosRecuperacao(client, userId) {
  const codigos = gerarCodigosRecuperacao();
  await client.query(`DELETE FROM recovery_codes WHERE user_id = ?`, [userId]);
  for (const c of codigos) {
    await client.query(
      `INSERT INTO recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)`,
      [crypto.randomUUID(), userId, hashCodigo(c)]
    );
  }
  return codigos;
}

/** Confirma a configuração: o primeiro código prova que o app foi configurado certo. */
async function ativar({ userId, segredo, codigo }) {
  const passo = passoDoCodigo(normalizar(codigo), segredo);
  if (passo === null) {
    throw new TwoFactorError("Código incorreto. Confira se o horário do celular está automático e tente o código atual.", "BAD_CODE");
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `UPDATE users SET totp_secret_enc = ?, totp_enabled_at = NOW(), totp_last_step = ?
       WHERE id = ? AND totp_enabled_at IS NULL`,
      [cifrar(segredo), passo, userId]
    );
    if (!rowCount) throw new TwoFactorError("A verificação em duas etapas já está ativa.", "ALREADY_ON", 409);
    const codigos = await gravarCodigosRecuperacao(client, userId);
    await client.query("COMMIT");
    return codigos; // mostrados UMA vez; no banco só o hash
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Verifica um código do app ou de recuperação. Atômico: o UPDATE só
 * acontece se o passo for maior que o último aceito — dois envios do
 * mesmo código ao mesmo tempo não passam os dois.
 */
async function verificar({ userId, codigo }) {
  const entrada = normalizar(codigo);
  const { rows } = await db.query(`SELECT totp_secret_enc, totp_last_step FROM users WHERE id = ?`, [userId]);
  if (!rows[0]?.totp_secret_enc) return { ok: false };

  if (/^\d{6}$/.test(entrada)) {
    let segredo;
    try { segredo = decifrar(rows[0].totp_secret_enc); }
    catch (err) { log.error({ err, userId }, "falha ao decifrar segredo 2FA"); return { ok: false }; }

    const passo = passoDoCodigo(entrada, segredo);
    if (passo === null) return { ok: false };
    const { rowCount } = await db.query(
      `UPDATE users SET totp_last_step = ?
       WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)`,
      [passo, userId, passo]
    );
    return rowCount ? { ok: true, metodo: "app" } : { ok: false, reuso: true };
  }

  // Código de recuperação (10 caracteres). O MySQL não tem UPDATE...
  // RETURNING com subconsulta: marca como usado e, se pegou a linha,
  // conta os que sobraram numa segunda consulta (o código recém-usado
  // já sai da contagem, porque used_at deixou de ser NULL).
  if (/^[A-Z2-9]{10}$/i.test(entrada)) {
    const hash = hashCodigo(entrada);
    const { rowCount } = await db.query(
      `UPDATE recovery_codes SET used_at = NOW()
       WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
      [userId, hash]
    );
    if (rowCount) {
      const { rows: restantes } = await db.query(
        `SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL`,
        [userId]
      );
      return { ok: true, metodo: "recuperacao", restantes: Number(restantes[0].n) };
    }
  }
  return { ok: false };
}

async function regenerarCodigos(userId) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const codigos = await gravarCodigosRecuperacao(client, userId);
    await client.query("COMMIT");
    return codigos;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function desativar(userId) {
  await db.query(
    `UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?`,
    [userId]
  );
  await db.query(`DELETE FROM recovery_codes WHERE user_id = ?`, [userId]);
}

/**
 * Valida a chave na SUBIDA do servidor. Sem isso, um servidor com a
 * chave ausente ou errada subiria normalmente e só falharia no primeiro
 * login de admin — trancando todos fora no pior momento.
 */
function validarConfiguracao() {
  chave();
  return true;
}

module.exports = {
  validarConfiguracao,
  TwoFactorError, statusDe, gerarSegredo, qrPara, ativar, verificar,
  regenerarCodigos, desativar, cifrar, decifrar, hashCodigo, QTD_RECUPERACAO,
};
