/* ==============================================================
   AquaTrip — Provider de pagamento SIMULADO (mock)
   ==============================================================
   Usado quando não há credenciais do gateway real configuradas.
   Reproduz o fluxo REAL de ponta a ponta — inclusive o webhook
   assíncrono — para que todos os estados possam ser testados sem
   processar cobrança nenhuma.

   Como forçar cada resultado (útil em teste/demo):
     - Cartão terminando em 0000 -> REJECTED
     - Cartão terminando em 0001 -> PENDING (fica em análise)
     - Qualquer outro           -> APPROVED
     - PIX                      -> nasce PENDING e é confirmado
                                   quando o webhook simulado chega
   ============================================================== */
const crypto = require("crypto");
const { PaymentStatus, PaymentMethod, PaymentError } = require("./contract");

const name = "mock";

// Armazena os pagamentos simulados em memória (some ao reiniciar —
// o registro durável fica na tabela `payments`, como no gateway real).
const store = new Map();

function impressao(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex").slice(0, 16);
}

/** Confere o token como o Mercado Pago faria (404 com o token errado). */
function conferirVendedor(record, accessToken) {
  const esperado = record && record.vendedor ? record.vendedor.fp : null;
  const usado = accessToken ? impressao(accessToken) : null;
  if (esperado !== usado) {
    throw new PaymentError("Pagamento não encontrado para esta credencial.", "NOT_FOUND");
  }
}

function fakePixPayload(providerPaymentId, amountCents) {
  // Formato propositalmente FALSO e identificável: não é um payload
  // PIX válido e não pode ser pago em banco nenhum.
  return `00020126SIMULADO-NAO-PAGAVEL-${providerPaymentId}-${amountCents}5204000053039865802BR`;
}

async function createPayment({
  bookingId,
  amountCents,
  currency = "BRL",
  method,
  installments = 1,
  cardLastFour = null,
  description = "",
  seller = null,
}) {
  const providerPaymentId = `mock_${crypto.randomBytes(8).toString("hex")}`;
  // Marketplace: guarda QUEM vendeu (impressão digital do token, nunca o
  // token) e a comissão. Imita a regra real: pagamento criado com o token
  // do parceiro só é lido/estornado com o token dele.
  const vendedor = seller ? { fp: impressao(seller.accessToken), feeCents: seller.applicationFeeCents } : null;

  let status = PaymentStatus.PENDING;
  let displayData = null;

  if (method === PaymentMethod.PIX) {
    status = PaymentStatus.PENDING;
    displayData = {
      simulated: true,
      pixCopiaECola: fakePixPayload(providerPaymentId, amountCents),
      // QR code é gerado no front a partir do código acima.
      expiresInSeconds: 900,
    };
  } else if (
    method === PaymentMethod.CREDIT_CARD ||
    method === PaymentMethod.DEBIT_CARD
  ) {
    // Regras de simulação por final do cartão (ver cabeçalho).
    if (cardLastFour === "0000") status = PaymentStatus.REJECTED;
    else if (cardLastFour === "0001") status = PaymentStatus.PENDING;
    else status = PaymentStatus.APPROVED;

    displayData = {
      simulated: true,
      lastFour: cardLastFour || "****",
      installments: method === PaymentMethod.DEBIT_CARD ? 1 : installments,
    };
    // Mesmos códigos do Mercado Pago, para a tela de recusa ser testável.
    if (status === PaymentStatus.REJECTED) displayData.statusDetail = "cc_rejected_insufficient_amount";
    if (status === PaymentStatus.PENDING) displayData.statusDetail = "pending_review_manual";
  } else {
    throw new PaymentError(`Método não suportado: ${method}`, "UNSUPPORTED_METHOD");
  }

  const record = {
    providerPaymentId,
    bookingId,
    amountCents,
    currency,
    method,
    status,
    displayData,
    description,
    vendedor,
  };
  store.set(providerPaymentId, record);

  return { providerPaymentId, status, displayData };
}

async function getPayment(providerPaymentId, { accessToken } = {}) {
  const record = store.get(providerPaymentId);
  if (record) conferirVendedor(record, accessToken);
  if (!record) {
    // Cache em memória perdido (restart do processo). O registro
    // durável está na tabela `payments`; aqui devolvemos PENDING para
    // que o chamador consulte/mantenha o estado do banco em vez de
    // quebrar o fluxo.
    return {
      providerPaymentId,
      status: PaymentStatus.PENDING,
      displayData: { simulated: true, restored: true },
    };
  }
  return {
    providerPaymentId,
    status: record.status,
    displayData: record.displayData,
  };
}

async function refundPayment(providerPaymentId, { accessToken } = {}) {
  if (!providerPaymentId || !String(providerPaymentId).startsWith("mock_")) {
    throw new PaymentError("Id de pagamento simulado inválido.", "INVALID_ID");
  }
  if (store.get(providerPaymentId)) conferirVendedor(store.get(providerPaymentId), accessToken);
  // Não exigimos o registro em memória: quem valida se o pagamento
  // está realmente apto a estorno é o bookingService, consultando o
  // banco (status APPROVED). O provider só executa o estorno.
  const record = store.get(providerPaymentId) || { providerPaymentId };
  record.status = PaymentStatus.REFUNDED;
  store.set(providerPaymentId, record);
  return { providerPaymentId, status: PaymentStatus.REFUNDED };
}

/**
 * Muda o status de um pagamento simulado e devolve o corpo de webhook
 * correspondente — é o gatilho usado pela rota de simulação para
 * exercitar o fluxo assíncrono igual ao do gateway real.
 *
 * O `store` em memória é só um cache: ele se perde quando o processo
 * reinicia, e isso não pode travar o teste. O registro durável de um
 * pagamento é a tabela `payments` (o webhook resultante é validado
 * contra ela adiante), então aqui basta reconstruir o registro
 * mínimo se ele não estiver mais em memória.
 */
function simulateStatusChange(providerPaymentId, newStatus) {
  if (!providerPaymentId || !String(providerPaymentId).startsWith("mock_")) {
    throw new PaymentError("Id de pagamento simulado inválido.", "INVALID_ID");
  }

  const record = store.get(providerPaymentId) || { providerPaymentId };
  record.status = newStatus;
  store.set(providerPaymentId, record);

  const body = {
    id: `evt_${crypto.randomBytes(6).toString("hex")}`,
    type: "payment.updated",
    data: { id: providerPaymentId, status: newStatus },
  };
  return { body, signature: signBody(JSON.stringify(body)) };
}

function signBody(rawBody) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET || "dev-mock-secret";
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Valida a assinatura HMAC do webhook simulado. Mesmo sendo um mock,
 * a validação é real — assim o código que trata webhook já nasce
 * exercitando o caminho seguro, e não vira um "TODO" na migração
 * para o gateway de verdade.
 */
function parseWebhook({ headers = {}, rawBody, parsedBody }) {
  const received = headers["x-aquatrip-signature"];
  const expected = signBody(rawBody);

  let valid = false;
  if (received && received.length === expected.length) {
    // timingSafeEqual evita vazar informação por tempo de comparação.
    valid = crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  }

  const body = parsedBody || {};
  return {
    valid,
    eventId: body.id || null,
    eventType: body.type || null,
    providerPaymentId: body.data?.id || null,
    status: body.data?.status || null,
  };
}

/** Só para testes: quem vendeu (impressão do token) e a comissão registrada. */
function _inspecionar(providerPaymentId) {
  const r = store.get(providerPaymentId);
  return r ? { vendedor: r.vendedor, amountCents: r.amountCents } : null;
}

module.exports = {
  _inspecionar,
  _impressao: impressao,
  name,
  createPayment,
  getPayment,
  refundPayment,
  parseWebhook,
  simulateStatusChange,
  signBody,
};
