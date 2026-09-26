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

/** Processa um evento de pagamento e devolve { status, body } da resposta. */
async function processarWebhook(req) {
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
    return { status: 400, body: { error: "invalid payload" } };
  }

  if (!parsed.valid) {
    (req.log || log).warn("assinatura inválida — requisição rejeitada.");
    // Tentativa de webhook forjado e' evento de seguranca: registrar.
    await auditService.log(AuditAction.WEBHOOK_REJECTED, {
      req,
      metadata: { provider: provider.name, motivo: "assinatura_invalida" },
    });
    return { status: 401, body: { error: "invalid signature" } };
  }
  if (!parsed.eventId || !parsed.providerPaymentId) {
    return { status: 400, body: { error: "missing event id or payment id" } };
  }

  // Idempotência: se o insert não retorna linha, já processamos antes.
  const recorded = await paymentRepository.recordWebhookEvent({
    provider: provider.name,
    eventId: parsed.eventId,
    eventType: parsed.eventType,
    payload: req.body,
  });

  if (!recorded) {
    return { status: 200, body: { received: true, duplicate: true } };
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
    return { status: 200, body: { received: true } };
  } catch (err) {
    (req.log || log).error({ err }, "erro ao processar evento");
    // 500 faz o gateway reenviar — e a idempotência já nos protege.
    return { status: 500, body: { error: "processing failed" } };
  }
}

async function handlePaymentWebhook(req, res) {
  const r = await processarWebhook(req);
  return res.status(r.status).json(r.body);
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

/* --------------------------------------------------------------
   PIX DE TESTE: "Já realizei o pagamento"
   Checkout de demonstração: não existe banco do outro lado. O botão
   aprova o PIX SIMULADO do próprio dono da reserva, pelo mesmo caminho
   do webhook (assinatura, idempotência, confirmação da reserva). Só
   existe com o provider simulado e fora de produção.
   -------------------------------------------------------------- */
async function confirmarPixDeTeste(req, res, next) {
  if (process.env.NODE_ENV === "production" || !bookingService.isSimulated()) {
    return res.status(404).render("pages/erro", { statusCode: 404, title: "Página não encontrada", message: "", stack: null });
  }
  const voltar = (msg) => res.redirect(`/reservas/${req.params.id}/checkout?error=${encodeURIComponent(msg)}`);
  try {
    const booking = await bookingService.getBookingForUser(req.params.id, req.session.user);
    if (booking.user_id !== req.session.user.id) throw new bookingService.BookingError("Reserva não encontrada.", "NOT_FOUND");
    if (booking.status === "CONFIRMED") return res.redirect(`/reservas/${booking.id}/comprovante`);
    if (booking.status !== "PENDING") return voltar("Esta reserva não está aguardando pagamento.");

    const payment = await paymentRepository.findLatestByBooking(booking.id);
    if (!payment || payment.method !== "PIX" || payment.status !== "PENDING" || payment.provider !== mockProvider.name) {
      return voltar("Gere o QR Code PIX antes de confirmar o pagamento.");
    }

    const { body, signature } = mockProvider.simulateStatusChange(payment.provider_payment_id, "APPROVED");
    req.headers["x-aquatrip-signature"] = signature;
    req.rawBody = JSON.stringify(body);
    req.body = body;
    const r = await processarWebhook(req);
    if (r.status !== 200) return voltar("Não foi possível confirmar o pagamento de teste. Tente novamente.");

    const atualizada = await bookingService.getBookingForUser(booking.id, req.session.user);
    if (atualizada.status !== "CONFIRMED") {
      return voltar("O prazo da reserva terminou antes da confirmação. Escolha o horário de novo.");
    }
    return res.redirect(`/reservas/${booking.id}/comprovante`);
  } catch (err) {
    if (err instanceof bookingService.BookingError) {
      return res.status(404).render("pages/erro", { statusCode: 404, title: "Reserva não encontrada", message: err.message, stack: null });
    }
    return next(err);
  }
}

module.exports = { handlePaymentWebhook, simulatePaymentStatus, confirmarPixDeTeste };
