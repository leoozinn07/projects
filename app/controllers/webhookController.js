/* ==============================================================
   AquaTrip — Webhook Controller
   ==============================================================
   Endpoint público chamado pelo gateway. Regras:
     1) valida a assinatura (senão 401 — qualquer um poderia forjar
        "pagamento aprovado" e ganhar reserva de graça);
     2) registra o evento e usa a unicidade no banco para garantir
        idempotência (gateway reenvia evento em caso de falha);
     3) para o Mercado Pago, NUNCA confia no status que veio no
        corpo — consulta a API para saber o status real;
     4) responde 200 rápido mesmo em caso duplicado, senão o gateway
        fica reenviando para sempre.
   ============================================================== */
const bookingService = require("../services/bookingService");
const log = require("../lib/logger").forModule("webhook");
const paymentRepository = require("../repositories/paymentRepository");
const { getPaymentProvider } = require("../lib/payments");
const mockProvider = require("../lib/payments/mockProvider");
const auditService = require("../services/auditService");
const { AuditAction } = auditService;

async function handlePaymentWebhook(req, res) {
  const provider = getPaymentProvider();

  let parsed;
  try {
    parsed = provider.parseWebhook({
      headers: req.headers,
      rawBody: req.rawBody,
      parsedBody: req.body,
    });
  } catch (err) {
    (req.log || log).error({ err }, "erro ao interpretar payload");
    return res.status(400).json({ error: "invalid payload" });
  }

  if (!parsed.valid) {
    (req.log || log).warn("assinatura inválida — requisição rejeitada.");
    // Tentativa de webhook forjado e' evento de seguranca: registrar.
    await auditService.log(AuditAction.WEBHOOK_REJECTED, {
      req,
      metadata: { provider: provider.name, motivo: "assinatura_invalida" },
    });
    return res.status(401).json({ error: "invalid signature" });
  }
  if (!parsed.eventId || !parsed.providerPaymentId) {
    return res.status(400).json({ error: "missing event id or payment id" });
  }

  // Idempotência: se o insert não retorna linha, já processamos antes.
  const recorded = await paymentRepository.recordWebhookEvent({
    provider: provider.name,
    eventId: parsed.eventId,
    eventType: parsed.eventType,
    payload: req.body,
  });

  if (!recorded) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    // O status confiável vem da API do gateway, não do corpo do POST
    // (o corpo pode ser forjado/estar defasado). O mock já entrega o
    // status no evento porque ele é a própria fonte da verdade local.
    let status = parsed.status;
    if (!status) {
      // Venda de parceiro só é legível com o token DELE.
      const local = await paymentRepository.findByProviderPaymentId(provider.name, parsed.providerPaymentId);
      const remote = await provider.getPayment(parsed.providerPaymentId,
        await bookingService.credencialDoPagamento(local));
      status = remote.status;
    }

    await bookingService.applyPaymentStatus({
      provider: provider.name,
      providerPaymentId: parsed.providerPaymentId,
      status,
    });

    await paymentRepository.markWebhookProcessed(recorded.id);
    await auditService.log(AuditAction.WEBHOOK_RECEIVED, {
      req,
      metadata: {
        provider: provider.name,
        evento: parsed.eventType,
        providerPaymentId: parsed.providerPaymentId,
        status,
      },
    });
    return res.status(200).json({ received: true });
  } catch (err) {
    (req.log || log).error({ err }, "erro ao processar evento");
    // 500 faz o gateway reenviar — e a idempotência já nos protege.
    return res.status(500).json({ error: "processing failed" });
  }
}

/* --------------------------------------------------------------
   SIMULAÇÃO (somente fora de produção e somente com provider mock)
   Permite exercitar todos os estados sem cobrança real. Em produção
   esta rota nem é registrada (ver router.js), e aqui há uma segunda
   trava caso alguém a registre por engano.
   -------------------------------------------------------------- */
async function simulatePaymentStatus(req, res) {
  if (process.env.NODE_ENV === "production" || !bookingService.isSimulated()) {
    return res.status(404).json({ error: "not found" });
  }

  const { providerPaymentId, status } = req.body || {};
  if (!providerPaymentId || !status) {
    return res.status(400).json({ error: "providerPaymentId e status são obrigatórios" });
  }

  try {
    // Gera um webhook assinado de verdade e o envia pelo mesmo caminho
    // do gateway real — assim o teste exercita a validação de
    // assinatura e a idempotência, não um atalho.
    const { body, signature } = mockProvider.simulateStatusChange(
      providerPaymentId,
      status
    );

    req.headers["x-aquatrip-signature"] = signature;
    req.rawBody = JSON.stringify(body);
    req.body = body;

    return handlePaymentWebhook(req, res);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

module.exports = { handlePaymentWebhook, simulatePaymentStatus };
