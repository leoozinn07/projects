/* ==============================================================
   AquaTrip — Cofre: cifragem de credenciais de terceiros
   ==============================================================
   Usado para os tokens OAuth do Mercado Pago dos parceiros — eles
   dão acesso à conta de recebimento de cada um.

   - AES-256-GCM (cifra + detecção de adulteração).
   - Chave POR FINALIDADE, derivada da chave mestra por HKDF: uma
     falha no uso de uma finalidade não compromete as outras.
   - AAD (dado autenticado): o texto cifrado fica AMARRADO ao dono
     (ex.: id do parceiro). Copiar o token de um parceiro para a linha
     de outro faz a decifragem FALHAR — ninguém desvia o dinheiro de
     uma conta para outra trocando linhas no banco.

   Chave mestra: TOTP_ENCRYPTION_KEY (32 bytes, base64), já validada
   na subida do servidor. O 2FA usa a chave direta; aqui só subchaves.
   ============================================================== */
const crypto = require("crypto");

function mestra() {
  const bruta = Buffer.from(process.env.TOTP_ENCRYPTION_KEY || "", "base64");
  if (bruta.length !== 32) throw new Error("TOTP_ENCRYPTION_KEY deve ter 32 bytes em base64");
  return bruta;
}

function subchave(finalidade) {
  return Buffer.from(crypto.hkdfSync("sha256", mestra(), Buffer.alloc(0), `aquatrip:${finalidade}`, 32));
}

/** Formato: v1.<iv>.<tag>.<cifrado> (base64url). */
function cifrar(texto, { finalidade, dono }) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", subchave(finalidade), iv);
  c.setAAD(Buffer.from(String(dono)));
  const dados = Buffer.concat([c.update(String(texto), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), dados.toString("base64url")].join(".");
}

function decifrar(pacote, { finalidade, dono }) {
  const [v, iv, tag, dados] = String(pacote || "").split(".");
  if (v !== "v1" || !iv || !tag || !dados) throw new Error("cofre: formato inválido");
  const d = crypto.createDecipheriv("aes-256-gcm", subchave(finalidade), Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(String(dono)));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  // Dono errado, finalidade errada ou byte alterado => lança erro.
  return Buffer.concat([d.update(Buffer.from(dados, "base64url")), d.final()]).toString("utf8");
}

module.exports = { cifrar, decifrar };
