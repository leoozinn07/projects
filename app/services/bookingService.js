/* ==============================================================
   AquaTrip — Booking Service
   Regra de negócio do fluxo de reserva + pagamento.
   Sem SQL (fica nos repositories) e sem req/res (fica no controller).

   Fluxo:
     escolher serviço/slot
       -> createBooking()      : reserva PENDING segurando a vaga
       -> startPayment()       : cria cobrança no gateway
       -> webhook do gateway   : applyPaymentStatus() confirma/libera
       -> comprovante / estorno
   ============================================================== */
const crypto = require("crypto");
const log = require("../lib/logger").forModule("reservas");
const bookingRepository = require("../repositories/bookingRepository");
const paymentRepository = require("../repositories/paymentRepository");
const marketplaceService = require("./marketplaceService");
const { getPaymentProvider, isSimulated } = require("../lib/payments");
const auditService = require("./auditService");
const { AuditAction } = auditService;
const { PaymentStatus, PaymentMethod } = require("../lib/payments/contract");

// Quanto tempo a reserva pendente segura a vaga.
const HOLD_MINUTES = Number(process.env.BOOKING_HOLD_MINUTES || 15);

class BookingError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "BookingError";
    this.code = code;
  }
}

/* ---------- Catálogo ---------- */

function listServices() {
  return bookingRepository.listServices();
}

async function getServiceWithSlots(slug) {
  const service = await bookingRepository.findServiceBySlug(slug);
  if (!service) throw new BookingError("Experiência não encontrada.", "SERVICE_NOT_FOUND");
  const slots = await bookingRepository.listAvailableSlots(service.id);
  return { service, slots };
}

/* ---------- Reserva ---------- */

async function createBooking({ userId, slotId, quantity }) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new BookingError("Quantidade inválida.", "INVALID_QUANTITY");
  }

  const result = await bookingRepository.createPendingBooking({
    userId,
    slotId,
    quantity,
    holdMinutes: HOLD_MINUTES,
  });

  if (result.error === "SLOT_NOT_FOUND") {
    throw new BookingError("Horário não encontrado.", "SLOT_NOT_FOUND");
  }
  if (result.error === "SLOT_IN_PAST") {
    throw new BookingError("Esse horário já passou.", "SLOT_IN_PAST");
  }
  if (result.error === "NO_CAPACITY") {
    throw new BookingError(
      `Não há vagas suficientes nesse horário (restam ${result.available}).`,
      "NO_CAPACITY"
    );
  }

  return result.booking;
}

async function getBookingForUser(bookingId, user) {
  const booking = await bookingRepository.findBookingById(bookingId);
  if (!booking) throw new BookingError("Reserva não encontrada.", "NOT_FOUND");

  // Autorização a nível de objeto (evita IDOR/BOLA): dono ou admin.
  if (booking.user_id !== user.id && user.role !== "ADMIN") {
    throw new BookingError("Reserva não encontrada.", "NOT_FOUND");
  }
  return booking;
}

function listUserBookings(userId) {
  return bookingRepository.listBookingsByUser(userId);
}

/* ---------- Pagamento ---------- */

/**
 * Cria a cobrança no gateway para uma reserva pendente.
 *
 * Proteções contra cobrança duplicada, em camadas:
 *  1) se já existe pagamento PENDING/APPROVED para a reserva, devolve
 *     ele em vez de criar outro;
 *  2) idempotencyKey determinística por (booking + método) — retry de
 *     rede ou duplo clique cai na MESMA chave;
 *  3) índice único no banco (uniq_payment_active_per_booking) como
 *     última linha de defesa, mesmo sob concorrência.
 */
/** Parceiro dono da experiência reservada (e a comissão dele), se houver. */
async function dadosDaVenda(bookingId) {
  const { rows } = await require("../lib/db").query(
    `SELECT sv.partner_id, pa.commission_pct
     FROM bookings b JOIN service_slots s ON s.id = b.slot_id
     JOIN services sv ON sv.id = s.service_id
     LEFT JOIN partners pa ON pa.id = sv.partner_id
     WHERE b.id = ?`, [bookingId]
  );
  return rows[0] || {};
}

/**
 * O que o checkout precisa para montar o formulário de cartão do
 * Mercado Pago: a chave pública certa (do parceiro, em venda de
 * parceiro; senão a da plataforma). null = sem gateway real.
 */
async function configDoCheckout(bookingId) {
  if (isSimulated()) return null;
  const venda = await dadosDaVenda(bookingId);
  const publicKey = venda.partner_id
    ? await marketplaceService.chavePublicaDoParceiro(venda.partner_id)
    : (process.env.MP_PUBLIC_KEY || "").trim() || null;
  return { publicKey };
}

/** Credencial para ler/estornar o pagamento: a do parceiro, se a venda foi dele. */
async function credencialDoPagamento(payment) {
  if (!payment || !payment.partner_id) return {};
  const { accessToken } = await marketplaceService.credencialDoParceiro(payment.partner_id);
  return { accessToken };
}

async function startPayment({
  bookingId, user, method, installments = 1,
  cardToken = null, cardLastFour = null,
  paymentMethodId = null, issuerId = null, identification = null,
}) {
  if (!Object.values(PaymentMethod).includes(method)) {
    throw new BookingError("Método de pagamento inválido.", "INVALID_METHOD");
  }

  const booking = await getBookingForUser(bookingId, user);

  if (booking.status !== "PENDING") {
    throw new BookingError(
      `Esta reserva não está aguardando pagamento (status: ${booking.status}).`,
      "BOOKING_NOT_PAYABLE"
    );
  }
  if (booking.expires_at && new Date(booking.expires_at) <= new Date()) {
    throw new BookingError("Esta reserva expirou. Faça uma nova.", "BOOKING_EXPIRED");
  }

  // (1) já existe cobrança viva?
  const existing = await paymentRepository.findActiveByBooking(bookingId);
  if (existing) return { payment: existing, reused: true };

  // (2) chave idempotente determinística POR TENTATIVA. Duas requisições
  // simultâneas da mesma tentativa geram a mesma chave (o índice único
  // segura a corrida); depois de uma recusa, a próxima tentativa é outra
  // chave, senão a pessoa ficaria presa ao pagamento recusado.
  const tentativa = await paymentRepository.countByBooking(bookingId);
  const idempotencyKey = crypto
    .createHash("sha256")
    .update(`${bookingId}:${method}:${booking.amount_cents}:${tentativa}`)
    .digest("hex")
    .slice(0, 64);

  const already = await paymentRepository.findByIdempotencyKey(idempotencyKey);
  if (already) return { payment: already, reused: true };

  const provider = getPaymentProvider();

  // Marketplace: experiência de parceiro é vendida EM NOME DELE, com a
  // comissão do AquaTrip calculada AQUI (servidor) sobre o valor do banco.
  const venda = await dadosDaVenda(bookingId);
  let seller = null;
  if (venda.partner_id) {
    const cred = await marketplaceService.credencialDoParceiro(venda.partner_id);
    seller = {
      accessToken: cred.accessToken,
      applicationFeeCents: marketplaceService.calcularComissao(booking.amount_cents, venda.commission_pct),
    };
  }

  const result = await provider.createPayment({
    bookingId,
    amountCents: booking.amount_cents, // valor do BANCO, nunca do cliente
    currency: booking.currency,
    method,
    installments,
    idempotencyKey,
    cardToken,
    cardLastFour,
    paymentMethodId,
    issuerId,
    payer: {
      email: user.email,
      firstName: (user.name || "").split(" ")[0],
      identification,
    },
    description: `AquaTrip — ${booking.service_title}`,
    seller,
  });

  let payment;
  try {
    payment = await paymentRepository.createPayment({
      bookingId,
      provider: provider.name,
      providerPaymentId: result.providerPaymentId,
      method,
      status: result.status,
      amountCents: booking.amount_cents,
      currency: booking.currency,
      installments,
      idempotencyKey,
      displayData: result.displayData,
      // Comissão CONGELADA: mudança futura do percentual não altera vendas passadas.
      partnerId: venda.partner_id || null,
      commissionPct: venda.partner_id ? venda.commission_pct : null,
      applicationFeeCents: seller ? seller.applicationFeeCents : null,
    });
  } catch (err) {
    // (3) corrida perdida para o índice único: outra requisição criou
    // o pagamento no meio do caminho. Devolvemos o dela.
    // ER_DUP_ENTRY (errno 1062) é o equivalente MySQL do 23505 do Postgres.
    if (err.code === "ER_DUP_ENTRY") {
      const winner =
        (await paymentRepository.findByIdempotencyKey(idempotencyKey)) ||
        (await paymentRepository.findActiveByBooking(bookingId));
      if (winner) return { payment: winner, reused: true };
    }
    throw err;
  }

  // Cartão costuma responder na hora; PIX fica pendente até o webhook.
  if (result.status !== PaymentStatus.PENDING) {
    await applyPaymentStatus({
      provider: provider.name,
      providerPaymentId: result.providerPaymentId,
      status: result.status,
    });
  }

  return { payment, reused: false };
}

/**
 * Aplica um status vindo do gateway (webhook ou retorno síncrono).
 * É o ÚNICO lugar que confirma reserva — e é idempotente: chamar duas
 * vezes com o mesmo status não gera efeito duplicado, porque as
 * transições no repositório são condicionais.
 */
async function applyPaymentStatus({ provider, providerPaymentId, status }) {
  const payment = await paymentRepository.findByProviderPaymentId(
    provider,
    providerPaymentId
  );
  if (!payment) return { applied: false, reason: "PAYMENT_NOT_FOUND" };

  // Atualiza o pagamento só se o status mudou. Mas o efeito na RESERVA
  // é aplicado de qualquer forma: quando o gateway responde de forma
  // síncrona (cartão), o pagamento já nasce APPROVED/REJECTED e um
  // early-return aqui deixaria a reserva presa em PENDING.
  // Reaplicar é seguro porque as transições do bookingRepository são
  // condicionais (WHERE status = ...), então nunca há efeito duplo.
  let current = payment;
  if (payment.status !== status) {
    const updated = await paymentRepository.updateStatus(payment.id, status);
    if (!updated) {
      return { applied: false, reason: "TRANSITION_REJECTED", payment };
    }
    current = updated;
  }

  // Toda mudanca de status de pagamento e' registrada: e' a trilha
  // que permite reconstruir "por que esta reserva esta assim".
  await auditService.log(AuditAction.PAYMENT_STATUS_CHANGED, {
    userId: null,
    metadata: {
      bookingId: payment.booking_id,
      paymentId: payment.id,
      provider,
      de: payment.status,
      para: status,
      valorCentavos: payment.amount_cents,
    },
  });

  if (status === PaymentStatus.APPROVED) {
    await bookingRepository.markConfirmed(payment.booking_id);
    await auditService.log(AuditAction.BOOKING_CONFIRMED, {
      metadata: { bookingId: payment.booking_id, paymentId: payment.id },
    });
  } else if (status === PaymentStatus.REJECTED) {
    // Cartão recusado (CVV digitado errado, limite, banco pedindo
    // autorização) é comum e a pessoa costuma tentar de novo na hora,
    // com outro cartão ou PIX. A reserva continua segurando a vaga até
    // o fim do prazo (expires_at); a rotina de expiração libera depois.
  } else if (
    status === PaymentStatus.CANCELLED ||
    status === PaymentStatus.EXPIRED
  ) {
    // Libera a vaga imediatamente: não faz sentido segurar o horário
    // de um pagamento que já sabemos que não vai acontecer.
    await bookingRepository.markCancelled(payment.booking_id, {
      onlyIfStatus: "PENDING",
    });
  } else if (status === PaymentStatus.REFUNDED) {
    await bookingRepository.markRefunded(payment.booking_id);
    await auditService.log(AuditAction.PAYMENT_REFUNDED, {
      metadata: {
        bookingId: payment.booking_id,
        paymentId: payment.id,
        valorCentavos: payment.amount_cents,
      },
    });
  }

  return { applied: true, payment: current };
}

/* ---------- Cancelamento / estorno ---------- */

async function cancelBooking({ bookingId, user }) {
  const booking = await getBookingForUser(bookingId, user);

  if (booking.status === "PENDING") {
    await bookingRepository.markCancelled(bookingId, { onlyIfStatus: "PENDING" });
    return { status: "CANCELLED", refunded: false };
  }

  if (booking.status === "CONFIRMED") {
    const payment = await paymentRepository.findLatestByBooking(bookingId);
    if (!payment || payment.status !== PaymentStatus.APPROVED) {
      await bookingRepository.markCancelled(bookingId);
      return { status: "CANCELLED", refunded: false };
    }

    const provider = getPaymentProvider();
    await provider.refundPayment(payment.provider_payment_id, await credencialDoPagamento(payment));

    // O estorno também chega por webhook, mas aplicamos já para o
    // usuário ver o resultado na hora. applyPaymentStatus é idempotente,
    // então o webhook depois não duplica nada.
    await applyPaymentStatus({
      provider: provider.name,
      providerPaymentId: payment.provider_payment_id,
      status: PaymentStatus.REFUNDED,
    });
    return { status: "REFUNDED", refunded: true };
  }

  throw new BookingError(
    `Reserva não pode ser cancelada (status: ${booking.status}).`,
    "NOT_CANCELLABLE"
  );
}

/* ---------- Manutenção ---------- */

async function expirePendingBookings() {
  const ids = await bookingRepository.expireStaleBookings();
  if (ids.length) {
    log.info(`${ids.length} reserva(s) pendente(s) expirada(s).`);
    for (const id of ids) {
      await auditService.log(AuditAction.BOOKING_EXPIRED, {
        metadata: { bookingId: id },
      });
    }
  }
  return ids;
}

module.exports = {
  configDoCheckout,
  BookingError,
  HOLD_MINUTES,
  isSimulated,
  listServices,
  getServiceWithSlots,
  createBooking,
  getBookingForUser,
  listUserBookings,
  credencialDoPagamento,
  startPayment,
  applyPaymentStatus,
  cancelBooking,
  expirePendingBookings,
};
