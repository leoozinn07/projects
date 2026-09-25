/* ==============================================================
   AquaTrip — Contrato do Gateway de Pagamento
   ==============================================================
   Esta é a fronteira entre o AquaTrip e QUALQUER provedor de
   pagamento. O resto do sistema (services, controllers, views)
   nunca importa "mercadopago" nem "mock" diretamente — só chama
   este contrato. Trocar de provedor = escrever um novo arquivo
   que implemente estes métodos e mudar uma variável de ambiente.

   Todo provider DEVE implementar:

   createPayment({ bookingId, amountCents, currency, method,
                   installments, idempotencyKey, payer, description })
     -> {
          providerPaymentId: string,
          status: 'PENDING'|'APPROVED'|'REJECTED'|...,
          displayData: object|null   // QR code PIX, últimos 4 dígitos...
        }

   getPayment(providerPaymentId)
     -> { providerPaymentId, status, displayData }

   refundPayment(providerPaymentId)
     -> { providerPaymentId, status: 'REFUNDED' }

   parseWebhook({ headers, rawBody, parsedBody })
     -> {
          valid: boolean,           // assinatura conferida
          eventId: string,          // para idempotência
          eventType: string,
          providerPaymentId: string|null
        }

   name -> identificador curto salvo em payments.provider

   REGRA INEGOCIÁVEL: nenhum provider pode receber, logar ou
   devolver número completo de cartão, CVV ou validade. Esses dados
   devem ir do navegador do cliente DIRETO para o gateway (via SDK
   oficial / tokenização), e o backend só lida com o token/id
   resultante.
   ============================================================== */

/** Status de pagamento normalizados do AquaTrip (independem do provedor). */
const PaymentStatus = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
  EXPIRED: "EXPIRED",
});

const PaymentMethod = Object.freeze({
  PIX: "PIX",
  CREDIT_CARD: "CREDIT_CARD",
  DEBIT_CARD: "DEBIT_CARD",
});

/** Erro de domínio de pagamento (permite tratar diferente de bug interno). */
class PaymentError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
  }
}

module.exports = { PaymentStatus, PaymentMethod, PaymentError };
