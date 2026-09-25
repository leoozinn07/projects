/* ==============================================================
   AquaTrip — Provider Mercado Pago
   ==============================================================
   Implementa o MESMO contrato do mockProvider, via API REST oficial
   (sem SDK, para não adicionar dependência: usamos fetch nativo do
   Node 18+).

   Credenciais vêm EXCLUSIVAMENTE de variáveis de ambiente:
     MP_ACCESS_TOKEN        -> token do ambiente (TEST-... ou APP_USR-...)
     MP_WEBHOOK_SECRET      -> segredo da assinatura de webhook
     PAYMENT_ENV            -> 'sandbox' | 'production'
     PUBLIC_BASE_URL        -> URL pública para o notification_url

   SEGURANÇA DE CARTÃO (PCI): este adaptador NUNCA recebe PAN/CVV.
   O fluxo correto é o navegador tokenizar o cartão com o SDK
   público do Mercado Pago (MercadoPago.js / Bricks) e enviar ao
   backend apenas o `token`. É esse token que vai aqui em
   `cardToken`. Se algum dia alguém tentar passar número de cartão
   por aqui, o guard abaixo derruba a requisição.
   ============================================================== */
const crypto = require("crypto");
const { PaymentStatus, PaymentMethod, PaymentError } = require("./contract");

const name = "mercadopago";
const API_BASE = "https://api.mercadopago.com";

function accessToken() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    throw new PaymentError(
      "MP_ACCESS_TOKEN não configurado no ambiente.",
      "MISSING_CREDENTIALS"
    );
  }
  return token;
}

function isProduction() {
  return process.env.PAYMENT_ENV === "production";
}

/**
 * Mapeia os status do Mercado Pago para os status normalizados do
 * AquaTrip. Manter esse mapa aqui (e não espalhado pelo sistema) é o
 * que permite trocar de gateway sem tocar no resto do código.
 */
function mapStatus(mpStatus) {
  switch (mpStatus) {
    case "approved":
    case "authorized":
      return PaymentStatus.APPROVED;
    case "pending":
    case "in_process":
    case "in_mediation":
      return PaymentStatus.PENDING;
    case "rejected":
      return PaymentStatus.REJECTED;
    case "cancelled":
      return PaymentStatus.CANCELLED;
    case "refunded":
    case "charged_back":
      return PaymentStatus.REFUNDED;
    default:
      return PaymentStatus.PENDING;
  }
}

function mapMethodToMp(method) {
  switch (method) {
    case PaymentMethod.PIX:
      return "pix";
    case PaymentMethod.CREDIT_CARD:
    case PaymentMethod.DEBIT_CARD:
      return null; // definido pelo token do cartão
    default:
      throw new PaymentError(`Método não suportado: ${method}`, "UNSUPPORTED_METHOD");
  }
}

/**
 * `token`: quando a venda é de PARCEIRO, a chamada usa o token OAuth
 * DELE (a venda é criada em nome dele). Sem `token`, usa o da plataforma.
 */
async function mpRequest(path, { method = "GET", body, idempotencyKey, token } = {}) {
  const headers = {
    Authorization: `Bearer ${token || accessToken()}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    // Não logar o corpo inteiro: pode conter dados do pagador.
    throw new PaymentError(
      `Mercado Pago respondeu ${res.status}: ${data.message || "erro"}`,
      "PROVIDER_ERROR"
    );
  }
  return data;
}

/** Barreira dura contra trafegar dado sensível de cartão. */
function assertNoRawCardData(input) {
  const forbidden = ["card_number", "cardNumber", "pan", "cvv", "security_code", "securityCode"];
  for (const key of forbidden) {
    if (input && Object.prototype.hasOwnProperty.call(input, key)) {
      throw new PaymentError(
        "Dados brutos de cartão não podem trafegar pelo backend. Use tokenização no cliente.",
        "PCI_VIOLATION"
      );
    }
  }
}

async function createPayment({
  bookingId,
  amountCents,
  currency = "BRL",
  method,
  installments = 1,
  idempotencyKey,
  payer = {},
  cardToken = null,
  paymentMethodId = null, // "visa", "master", "debelo"... devolvido pelo Brick
  issuerId = null,
  description = "",
  seller = null, // { accessToken, applicationFeeCents } em venda de parceiro
  ...rest
}) {
  assertNoRawCardData(rest);
  assertNoRawCardData(payer);

  const body = {
    transaction_amount: Number((amountCents / 100).toFixed(2)),
    description: description || `AquaTrip — reserva ${bookingId}`,
    external_reference: bookingId,
    notification_url: process.env.PUBLIC_BASE_URL
      ? `${process.env.PUBLIC_BASE_URL}/webhooks/payments`
      : undefined,
    payer: {
      email: payer.email,
      first_name: payer.firstName,
    },
  };
  // CPF/CNPJ do titular: o Brick coleta no navegador; exigido pelo MP
  // para cartão no Brasil e recomendado no PIX.
  if (payer.identification && payer.identification.number) {
    body.payer.identification = {
      type: payer.identification.type,
      number: String(payer.identification.number).replace(/\D/g, ""),
    };
  }

  if (method === PaymentMethod.PIX) {
    body.payment_method_id = mapMethodToMp(method);
  } else {
    if (!cardToken) {
      throw new PaymentError(
        "cardToken é obrigatório para pagamento com cartão (tokenize no cliente).",
        "MISSING_CARD_TOKEN"
      );
    }
    body.token = cardToken;
    body.installments = method === PaymentMethod.DEBIT_CARD ? 1 : installments;
    if (paymentMethodId) body.payment_method_id = paymentMethodId;
    if (issuerId) body.issuer_id = Number(issuerId);
  }

  // Marketplace: comissão da plataforma como application_fee (em reais,
  // como transaction_amount). O restante fica com o vendedor.
  if (seller) {
    if (!seller.accessToken) throw new PaymentError("Venda de parceiro sem credencial do vendedor.", "MISSING_SELLER_TOKEN");
    body.application_fee = Number((seller.applicationFeeCents / 100).toFixed(2));
  }

  const data = await mpRequest("/v1/payments", {
    method: "POST",
    body,
    idempotencyKey,
    token: seller ? seller.accessToken : undefined,
  });

  const displayData = { environment: isProduction() ? "production" : "sandbox" };
  // Motivo da recusa/análise (ex.: cc_rejected_insufficient_amount),
  // para a tela explicar o que houve sem expor nada sensível.
  if (data.status_detail) displayData.statusDetail = String(data.status_detail).slice(0, 60);

  if (method === PaymentMethod.PIX) {
    const tx = data.point_of_interaction?.transaction_data || {};
    displayData.pixCopiaECola = tx.qr_code || null;
    displayData.pixQrCodeBase64 = tx.qr_code_base64 || null;
  } else if (data.card) {
    // Só os 4 últimos dígitos e a bandeira, que o próprio MP devolve.
    displayData.lastFour = data.card.last_four_digits || null;
    displayData.brand = data.payment_method_id || paymentMethodId || null;
    displayData.installments = data.installments || installments;
  }

  return {
    providerPaymentId: String(data.id),
    status: mapStatus(data.status),
    displayData,
  };
}

/** Pagamento de parceiro só é legível com o token DELE (foi criado em nome dele). */
async function getPayment(providerPaymentId, { accessToken: token } = {}) {
  const data = await mpRequest(`/v1/payments/${providerPaymentId}`, { token });
  return {
    providerPaymentId: String(data.id),
    status: mapStatus(data.status),
    displayData: { environment: isProduction() ? "production" : "sandbox" },
  };
}

async function refundPayment(providerPaymentId, { accessToken: token } = {}) {
  await mpRequest(`/v1/payments/${providerPaymentId}/refunds`, {
    method: "POST",
    body: {},
    idempotencyKey: `refund_${providerPaymentId}`,
    token,
  });
  return { providerPaymentId, status: PaymentStatus.REFUNDED };
}

/**
 * Valida a assinatura do webhook do Mercado Pago.
 * O MP envia o header `x-signature: ts=<timestamp>,v1=<hash>` e o
 * hash é HMAC-SHA256 do manifest "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
 */
function parseWebhook({ headers = {}, parsedBody }) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  const signatureHeader = headers["x-signature"];
  const requestId = headers["x-request-id"] || "";
  const body = parsedBody || {};
  const dataId = body.data?.id ? String(body.data.id) : null;

  let valid = false;

  if (secret && signatureHeader && dataId) {
    const parts = Object.fromEntries(
      String(signatureHeader)
        .split(",")
        .map((p) => p.split("=").map((s) => s.trim()))
    );
    const ts = parts.ts;
    const v1 = parts.v1;

    if (ts && v1) {
      const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
      const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
      if (v1.length === expected.length) {
        valid = crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
      }
    }
  }

  return {
    valid,
    // O MP não manda um id de evento estável; compomos um a partir do
    // pagamento + ação, o que ainda garante idempotência por efeito.
    eventId: dataId ? `${body.action || body.type || "event"}:${dataId}` : null,
    eventType: body.action || body.type || null,
    providerPaymentId: dataId,
    status: null, // MP exige consultar a API para saber o status atual
  };
}

module.exports = {
  name,
  createPayment,
  getPayment,
  refundPayment,
  parseWebhook,
  isProduction,
};
