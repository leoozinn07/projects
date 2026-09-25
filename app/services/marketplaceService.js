/* ==============================================================
   AquaTrip — Conexão do parceiro com o Mercado Pago (fase 3)
   ==============================================================
   Modelo marketplace do Mercado Pago: o parceiro autoriza o app do
   AquaTrip (OAuth) e recebemos um token para criar pagamentos EM NOME
   DELE, com a comissão do AquaTrip como application_fee.

   Fluxo:
     /parceiro/mercadopago/conectar  -> auth.mercadopago.com (consentimento)
     /parceiro/mercadopago/retorno   -> troca o código por tokens

   Segurança:
   - `state` aleatório, de USO ÚNICO, validade de 10 min, amarrado à
     sessão e ao parceiro. Sem ele, um atacante faria a vítima conectar
     a conta DELE — e as vendas da vítima cairiam na conta do atacante.
   - Tokens no cofre, amarrados ao parceiro (ver app/lib/cofre.js).
   - A conta da própria plataforma é recusada (o dinheiro do parceiro
     voltaria para o AquaTrip).
   - Nenhum token vai para log, auditoria ou exportação LGPD.

   ATENÇÃO: implementado conforme a documentação do Mercado Pago, mas
   neste ambiente só foi EXECUTADO contra o simulador (rede bloqueada).
   Primeiro teste real: sandbox, no Render (docs/ativar-mercado-pago.md).
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");
const cofre = require("../lib/cofre");
const auditService = require("./auditService");
const log = require("../lib/logger").forModule("mercadopago-oauth");
const { AuditAction } = auditService;

const AUTH_URL = "https://auth.mercadopago.com/authorization";
const TOKEN_URL = "https://api.mercadopago.com/oauth/token";
const VALIDADE_STATE_MS = 10 * 60 * 1000;
const RENOVAR_ANTES_MS = 7 * 24 * 60 * 60 * 1000;
const FINALIDADE = "mp-oauth-token";

class MarketplaceError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Simulado quando O MESMO provedor de pagamento em uso é o simulador.
 * Antes eu comparava PAYMENT_PROVIDER com "mock" literalmente — mas a
 * camada de pagamento trata "vazio" como "automático -> simulador".
 * Em desenvolvimento os pagamentos eram simulados e a conexão tentava o
 * Mercado Pago real. Uma decisão, um lugar.
 */
const simulado = () => process.env.NODE_ENV !== "production"
  // isSimulated é a decisão OFICIAL da camada de pagamento e não lança
  // erro (getPaymentProvider lançaria sem token configurado).
  && require("../lib/payments").isSimulated();

function base() {
  return (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}
const redirectUri = () => `${base()}/parceiro/mercadopago/retorno`;

function credenciaisApp() {
  const id = process.env.MP_CLIENT_ID;
  const secret = process.env.MP_CLIENT_SECRET;
  if (!id || !secret) {
    throw new MarketplaceError("A conexão com o Mercado Pago ainda não foi configurada pela equipe.", "NOT_CONFIGURED", 503);
  }
  return { id, secret };
}

async function parceiroAprovado(userId) {
  const { rows } = await db.query(`SELECT id, status, mp_connected_at FROM partners WHERE user_id = ?`, [userId]);
  if (!rows[0] || rows[0].status !== "APPROVED") {
    throw new MarketplaceError("Só parceiros aprovados conectam o Mercado Pago.", "PARTNER_NOT_ACTIVE", 403);
  }
  return rows[0];
}

/* ---------- 1. Início: URL de consentimento ---------- */

async function iniciar(req) {
  const p = await parceiroAprovado(req.session.user.id);
  const state = crypto.randomBytes(32).toString("hex");
  req.session.mpOauth = { state, partnerId: p.id, expira: Date.now() + VALIDADE_STATE_MS };

  if (simulado()) {
    // Desenvolvimento sem Mercado Pago: tela local que imita o consentimento.
    return `/parceiro/mercadopago/simulador?state=${state}`;
  }
  const { id } = credenciaisApp();
  const q = new URLSearchParams({
    client_id: id, response_type: "code", platform_id: "mp", state, redirect_uri: redirectUri(),
  });
  return `${AUTH_URL}?${q}`;
}

/* ---------- 2. Retorno: confere o state e troca o código ---------- */

function conferirState(req, state) {
  const salvo = req.session.mpOauth;
  delete req.session.mpOauth; // USO ÚNICO: consumido já na primeira tentativa, válida ou não
  const a = Buffer.from(String(state || ""));
  const b = Buffer.from(String(salvo?.state || ""));
  const igual = a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
  if (!salvo || !igual) throw new MarketplaceError("Link de conexão inválido. Comece de novo pela área do parceiro.", "INVALID_STATE", 400);
  if (Date.now() > salvo.expira) throw new MarketplaceError("O link de conexão expirou. Comece de novo.", "STATE_EXPIRED", 400);
  return salvo.partnerId;
}

async function pedirToken(corpo) {
  if (simulado()) {
    // Resposta no MESMO formato da API real (documentação do /oauth/token).
    const codigo = corpo.code || corpo.refresh_token || "";
    const conta = codigo.startsWith("MOCK-CONTA-") ? codigo.split("MOCK-CONTA-")[1].split(":")[0] : "999";
    return {
      access_token: `TEST-SIM-${crypto.randomBytes(12).toString("hex")}`,
      refresh_token: `TG-SIM-${crypto.randomBytes(12).toString("hex")}`,
      public_key: `TEST-PUB-${crypto.randomBytes(8).toString("hex")}`,
      user_id: Number(conta), expires_in: 15552000, live_mode: false, token_type: "Bearer",
    };
  }
  const { id, secret } = credenciaisApp();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: id, client_secret: secret, ...corpo }),
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok || !dados.access_token) {
    // Só o código de erro vai para o log; nunca o corpo inteiro (pode ter token).
    log.error({ status: res.status, erro: dados.error, mensagem: dados.message }, "falha no /oauth/token");
    throw new MarketplaceError("O Mercado Pago recusou a conexão. Tente de novo.", "TOKEN_EXCHANGE_FAILED", 502);
  }
  return dados;
}

async function concluir({ req, code, state }) {
  const partnerId = conferirState(req, state);
  const p = await parceiroAprovado(req.session.user.id);
  if (p.id !== partnerId) throw new MarketplaceError("Link de conexão inválido.", "INVALID_STATE", 400);
  if (!code) throw new MarketplaceError("O Mercado Pago não autorizou a conexão.", "NO_CODE", 400);

  const t = await pedirToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
  const contaMp = String(t.user_id);

  // A conta da própria plataforma não pode receber como parceiro.
  if (process.env.MP_PLATFORM_USER_ID && contaMp === String(process.env.MP_PLATFORM_USER_ID)) {
    throw new MarketplaceError("Essa é a conta do próprio AquaTrip. Conecte a conta do seu negócio.", "PLATFORM_ACCOUNT", 409);
  }
  // Produção exige conta real; ambiente de teste exige conta de teste.
  const producao = process.env.PAYMENT_ENV === "production";
  if (typeof t.live_mode === "boolean" && t.live_mode !== producao) {
    throw new MarketplaceError(
      producao ? "Conecte a conta real do Mercado Pago, não uma conta de teste." : "Neste ambiente, conecte uma conta de TESTE do Mercado Pago.",
      "WRONG_MODE", 409
    );
  }

  try {
    const expiresAt = new Date(Date.now() + Number(t.expires_in || 15552000) * 1000);
    await db.query(
      `UPDATE partners SET mp_user_id = ?, mp_access_token_enc = ?, mp_refresh_token_enc = ?,
              mp_token_expires_at = ?, mp_public_key = ?,
              mp_live_mode = ?, mp_connected_at = NOW()
       WHERE id = ?`,
      [contaMp,
       cofre.cifrar(t.access_token, { finalidade: FINALIDADE, dono: partnerId }),
       cofre.cifrar(t.refresh_token, { finalidade: FINALIDADE, dono: partnerId }),
       expiresAt, t.public_key || null, Boolean(t.live_mode),
       partnerId]
    );
  } catch (err) {
    // ER_DUP_ENTRY (errno 1062) é o equivalente MySQL do 23505 do Postgres.
    if (err.code === "ER_DUP_ENTRY") {
      // Mesma conta já recebe por outro parceiro. Mensagem genérica.
      throw new MarketplaceError("Essa conta do Mercado Pago não pode ser usada. Conecte a conta do seu negócio.", "ACCOUNT_IN_USE", 409);
    }
    throw err;
  }
  // Sem tokens na auditoria — só o fato e a conta.
  await auditService.log(AuditAction.PARTNER_MP_CONNECTED, { req, userId: req.session.user.id, metadata: { parceiroId: partnerId, contaMp } });
}

/* ---------- Desconectar ---------- */

async function desconectar({ req }) {
  const p = await parceiroAprovado(req.session.user.id);
  await db.query(
    `UPDATE partners SET mp_user_id = NULL, mp_access_token_enc = NULL, mp_refresh_token_enc = NULL,
            mp_token_expires_at = NULL, mp_public_key = NULL, mp_live_mode = NULL, mp_connected_at = NULL
     WHERE id = ?`, [p.id]
  );
  await auditService.log(AuditAction.PARTNER_MP_DISCONNECTED, { req, userId: req.session.user.id, metadata: { parceiroId: p.id } });
}

/* ---------- Token para vender em nome do parceiro ---------- */

/**
 * Devolve o token de acesso decifrado, renovando se faltar menos de
 * 7 dias para expirar. Lança NOT_CONNECTED se não houver conexão.
 */
async function credencialDoParceiro(partnerId) {
  const { rows } = await db.query(
    `SELECT id, status, mp_access_token_enc, mp_refresh_token_enc, mp_token_expires_at, mp_public_key
     FROM partners WHERE id = ?`, [partnerId]
  );
  const p = rows[0];
  if (!p || !p.mp_access_token_enc || p.status !== "APPROVED") {
    throw new MarketplaceError("Esta experiência não está disponível para pagamento no momento.", "NOT_CONNECTED", 409);
  }
  let accessToken = cofre.decifrar(p.mp_access_token_enc, { finalidade: FINALIDADE, dono: p.id });

  if (new Date(p.mp_token_expires_at).getTime() - Date.now() < RENOVAR_ANTES_MS) {
    const refresh = cofre.decifrar(p.mp_refresh_token_enc, { finalidade: FINALIDADE, dono: p.id });
    const t = await pedirToken({ grant_type: "refresh_token", refresh_token: refresh });
    accessToken = t.access_token;
    const expiresAt = new Date(Date.now() + Number(t.expires_in || 15552000) * 1000);
    await db.query(
      `UPDATE partners SET mp_access_token_enc = ?, mp_refresh_token_enc = ?,
              mp_token_expires_at = ? WHERE id = ?`,
      [cofre.cifrar(t.access_token, { finalidade: FINALIDADE, dono: p.id }),
       cofre.cifrar(t.refresh_token, { finalidade: FINALIDADE, dono: p.id }), expiresAt, p.id]
    );
    log.info({ parceiroId: p.id }, "token do Mercado Pago renovado");
  }
  return { accessToken, publicKey: p.mp_public_key };
}

/** Chave PÚBLICA do parceiro (não é segredo): o navegador tokeniza o
 *  cartão com ela, porque a cobrança sai em nome dele. */
async function chavePublicaDoParceiro(partnerId) {
  const { rows } = await db.query(
    `SELECT mp_public_key FROM partners WHERE id = ? AND status = 'APPROVED'`, [partnerId]
  );
  return rows[0]?.mp_public_key || null;
}

/** Comissão em centavos, arredondada; sempre menor que o valor. */
function calcularComissao(valorCents, pct) {
  const fee = Math.round((valorCents * Number(pct)) / 100);
  return Math.min(Math.max(fee, 0), valorCents - 1);
}

module.exports = {
  MarketplaceError, simulado, redirectUri, iniciar, concluir, desconectar,
  credencialDoParceiro, chavePublicaDoParceiro, calcularComissao, _conferirState: conferirState,
};
