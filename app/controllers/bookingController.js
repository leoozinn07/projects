/* ==============================================================
   AquaTrip — Booking Controller
   Só req/res + validação de entrada. Regra vive no bookingService.
   ============================================================== */
const { z } = require("zod");
const log = require("../lib/logger").forModule("reservas");
const bookingService = require("../services/bookingService");
const reviewService = require("../services/reviewService");
const paymentRepository = require("../repositories/paymentRepository");
const { PaymentMethod } = require("../lib/payments/contract");
const auditService = require("../services/auditService");
const { AuditAction } = auditService;

const createBookingSchema = z.object({
  slotId: z.string().uuid("Horário inválido."),
  quantity: z.coerce
    .number({ message: "Informe um número de pessoas." })
    .int("Informe um número inteiro de pessoas.")
    .min(1, "É preciso ao menos 1 pessoa.")
    .max(20, "Máximo de 20 pessoas por reserva."),
});

const startPaymentSchema = z.object({
  method: z.enum(
    [PaymentMethod.PIX, PaymentMethod.CREDIT_CARD, PaymentMethod.DEBIT_CARD],
    { message: "Escolha uma forma de pagamento válida." }
  ),
  installments: z.coerce
    .number()
    .int()
    .min(1, "Número de parcelas inválido.")
    .max(12, "Máximo de 12 parcelas.")
    .default(1),
  // Token gerado NO NAVEGADOR pelo SDK do gateway. O backend nunca vê
  // número de cartão nem CVV.
  cardToken: z.string().max(200).optional().nullable(),
  cardLastFour: z
    .string()
    .regex(/^\d{4}$/, "Informe os 4 últimos dígitos do cartão.")
    .optional()
    .nullable(),
  // Devolvidos pelo formulário do Mercado Pago junto com o token.
  // Nenhum deles é dado sensível de cartão.
  paymentMethodId: z.string().regex(/^[a-z0-9_]{2,30}$/, "Bandeira do cartão inválida.").optional().nullable().or(z.literal("")),
  issuerId: z.string().regex(/^\d{1,12}$/, "Emissor do cartão inválido.").optional().nullable().or(z.literal("")),
  docType: z.enum(["CPF", "CNPJ"]).optional().or(z.literal("")),
  docNumber: z.string().transform((v) => v.replace(/\D/g, "")).pipe(z.string().regex(/^(\d{11}|\d{14})$/, "CPF ou CNPJ inválido.")).optional().or(z.literal("")),
}).superRefine((d, ctx) => {
  const cartao = d.method === PaymentMethod.CREDIT_CARD || d.method === PaymentMethod.DEBIT_CARD;
  // Com gateway real, cartão só existe com o token gerado no navegador.
  if (cartao && !bookingService.isSimulated() && !d.cardToken) {
    ctx.addIssue({ code: "custom", path: ["cardToken"], message: "Preencha os dados do cartão para continuar." });
  }
});

/**
 * Motivo legível para o status_detail do Mercado Pago. Só os códigos
 * que a pessoa consegue resolver sozinha; o resto vira mensagem geral.
 */
const MOTIVOS = {
  cc_rejected_insufficient_amount: "o cartão não tem limite ou saldo suficiente.",
  cc_rejected_bad_filled_security_code: "o código de segurança (CVV) está incorreto.",
  cc_rejected_bad_filled_date: "a data de validade está incorreta.",
  cc_rejected_bad_filled_card_number: "o número do cartão está incorreto.",
  cc_rejected_bad_filled_other: "algum dado do cartão está incorreto.",
  cc_rejected_call_for_authorize: "o banco pediu para você autorizar o pagamento. Ligue para o emissor do cartão e tente de novo.",
  cc_rejected_card_disabled: "o cartão está bloqueado ou inativo. Fale com o emissor.",
  cc_rejected_duplicated_payment: "já existe um pagamento igual. Aguarde alguns minutos.",
  cc_rejected_max_attempts: "o limite de tentativas foi atingido. Use outro cartão.",
  cc_rejected_high_risk: "o pagamento foi recusado pela análise de segurança. Tente outro cartão ou o PIX.",
  cc_rejected_blacklist: "o pagamento foi recusado pela análise de segurança. Tente outro cartão ou o PIX.",
  cc_rejected_card_error: "o cartão não pôde ser processado. Tente outro cartão.",
  pending_contingency: "estamos processando o pagamento. Em até 2 dias úteis você recebe a confirmação.",
  pending_review_manual: "o pagamento está em análise. Em até 2 dias úteis você recebe a confirmação.",
};
function motivoDoPagamento(payment) {
  const codigo = payment && payment.display_data && payment.display_data.statusDetail;
  return (codigo && MOTIVOS[codigo]) || null;
}

function firstZodMessage(error) {
  return error.issues?.[0]?.message || "Dados inválidos.";
}

/* ---------- Catálogo ---------- */

async function showService(req, res, next) {
  try {
    const { service, slots } = await bookingService.getServiceWithSlots(req.params.slug);
    const avaliacoes = await reviewService.publicas(service.id);

    // SEO da experiência: título, descrição, imagem e dados estruturados.
    const { base } = require("../middlewares/seo");
    const preco = (service.price_cents / 100).toFixed(2);
    // Sem descrição cadastrada: título + local, sem repetir a cidade quando
    // ela já está no título ("Mergulho em Noronha em Noronha, PE").
    const cidade = String(service.location || "").split(",")[0].trim().toLowerCase();
    const padrao = cidade && service.title.toLowerCase().includes(cidade)
      ? `${service.title} (${service.location}).`
      : `${service.title} em ${service.location || "Brasil"}.`;
    const descricao = (service.description || padrao)
      .replace(/\s+/g, " ").slice(0, 155);
    const imagem = service.cover_key ? `${base()}/media/${service.cover_key}` : res.locals.seo.imagem;
    const jsonld = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: service.title,
      description: descricao,
      image: imagem,
      url: res.locals.seo.canonica,
      offers: {
        "@type": "Offer",
        price: preco,
        priceCurrency: service.currency || "BRL",
        // Disponibilidade REAL: sem horário com vaga, o Google é informado.
        availability: slots.length ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
        url: res.locals.seo.canonica,
      },
    };
    // Nota só se houver avaliação real. Declarar nota inventada nos dados
    // estruturados viola as regras do Google (e o CDC) do mesmo jeito.
    if (avaliacoes.resumo.total > 0) {
      jsonld.aggregateRating = {
        "@type": "AggregateRating",
        ratingValue: avaliacoes.resumo.media,
        reviewCount: avaliacoes.resumo.total,
        bestRating: 5,
        worstRating: 1,
      };
    }
    Object.assign(res.locals.seo, {
      titulo: `${service.title} | AquaTrip`,
      descricao: `${descricao} A partir de R$ ${preco.replace(".", ",")} por pessoa.`.slice(0, 200),
      imagem,
      tipo: "product",
      jsonld,
    });

    res.render("pages/reservar_servico", {
      service,
      slots,
      avaliacoes,
      holdMinutes: bookingService.HOLD_MINUTES,
      error: req.query.error || null,
    });
  } catch (err) {
    if (err instanceof bookingService.BookingError) {
      return res.status(404).render("pages/erro", {
        statusCode: 404,
        title: "Experiência não encontrada",
        message: err.message,
        stack: null,
      });
    }
    next(err);
  }
}

/* ---------- Reserva ---------- */

async function createBooking(req, res, next) {
  const parsed = createBookingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.redirect(
      `/reservar?error=${encodeURIComponent(firstZodMessage(parsed.error))}`
    );
  }

  try {
    const booking = await bookingService.createBooking({
      userId: req.session.user.id,
      slotId: parsed.data.slotId,
      quantity: parsed.data.quantity,
    });
    await auditService.log(AuditAction.BOOKING_CREATED, {
      req,
      metadata: {
        bookingId: booking.id,
        slotId: parsed.data.slotId,
        quantidade: booking.quantity,
        valorCentavos: booking.amount_cents,
      },
    });
    res.redirect(`/reservas/${booking.id}/checkout`);
  } catch (err) {
    if (err instanceof bookingService.BookingError) {
      const back = req.body.serviceSlug ? `/reservar/${req.body.serviceSlug}` : "/reservar";
      return res.redirect(`${back}?error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
}

/* ---------- Checkout ---------- */

async function showCheckout(req, res, next) {
  try {
    const booking = await bookingService.getBookingForUser(
      req.params.id,
      req.session.user
    );
    const payment = await paymentRepository.findLatestByBooking(booking.id);
    const mp = await bookingService.configDoCheckout(booking.id);

    res.render("pages/checkout", {
      booking,
      payment,
      motivo: motivoDoPagamento(payment),
      simulated: bookingService.isSimulated(),
      // Dados públicos para o formulário de cartão do Mercado Pago.
      mp: mp && {
        publicKey: mp.publicKey,
        email: req.session.user.email,
        amount: Number((booking.amount_cents / 100).toFixed(2)),
      },
      error: req.query.error || null,
    });
  } catch (err) {
    if (err instanceof bookingService.BookingError) {
      return res.status(404).render("pages/erro", {
        statusCode: 404,
        title: "Reserva não encontrada",
        message: err.message,
        stack: null,
      });
    }
    next(err);
  }
}

async function startPayment(req, res, next) {
  const parsed = startPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.redirect(
      `/reservas/${req.params.id}/checkout?error=${encodeURIComponent(firstZodMessage(parsed.error))}`
    );
  }

  try {
    const { payment, reused } = await bookingService.startPayment({
      bookingId: req.params.id,
      user: req.session.user,
      method: parsed.data.method,
      // Débito não parcela.
      installments: parsed.data.method === PaymentMethod.DEBIT_CARD ? 1 : parsed.data.installments,
      cardToken: parsed.data.cardToken || null,
      cardLastFour: parsed.data.cardLastFour || null,
      paymentMethodId: parsed.data.paymentMethodId || null,
      issuerId: parsed.data.issuerId || null,
      identification: parsed.data.docNumber
        ? { type: parsed.data.docType || (parsed.data.docNumber.length === 14 ? "CNPJ" : "CPF"), number: parsed.data.docNumber }
        : null,
    });
    if (!reused) {
      await auditService.log(AuditAction.PAYMENT_STARTED, {
        req,
        metadata: {
          bookingId: req.params.id,
          paymentId: payment.id,
          metodo: parsed.data.method,
          parcelas: parsed.data.installments,
          valorCentavos: payment.amount_cents,
        },
      });
    }
    res.redirect(`/reservas/${req.params.id}/checkout`);
  } catch (err) {
    if (err instanceof bookingService.BookingError) {
      return res.redirect(
        `/reservas/${req.params.id}/checkout?error=${encodeURIComponent(err.message)}`
      );
    }
    if (err.name === "PaymentError") {
      (req.log || log).error({ err, codigo: err.code }, "falha ao criar cobrança");
      return res.redirect(
        `/reservas/${req.params.id}/checkout?error=${encodeURIComponent("Não foi possível iniciar o pagamento. Tente novamente.")}`
      );
    }
    next(err);
  }
}

/**
 * Status leve para o checkout consultar enquanto espera o PIX ou a
 * análise do cartão, sem recarregar a página inteira (o que apagava
 * a seleção do código copia e cola).
 */
async function paymentStatus(req, res, next) {
  try {
    const booking = await bookingService.getBookingForUser(req.params.id, req.session.user);
    const payment = await paymentRepository.findLatestByBooking(booking.id);
    res.set("Cache-Control", "no-store");
    res.json({ booking: booking.status, payment: payment ? payment.status : null });
  } catch (err) {
    if (err instanceof bookingService.BookingError) return res.status(404).json({ error: "not_found" });
    next(err);
  }
}

/* ---------- Pós-pagamento ---------- */

async function showReceipt(req, res, next) {
  try {
    const booking = await bookingService.getBookingForUser(
      req.params.id,
      req.session.user
    );
    if (booking.status !== "CONFIRMED" && booking.status !== "REFUNDED") {
      return res.redirect(`/reservas/${booking.id}/checkout`);
    }
    const payment = await paymentRepository.findLatestByBooking(booking.id);
    res.render("pages/comprovante", { booking, payment });
  } catch (err) {
    if (err instanceof bookingService.BookingError) {
      return res.status(404).render("pages/erro", {
        statusCode: 404,
        title: "Reserva não encontrada",
        message: err.message,
        stack: null,
      });
    }
    next(err);
  }
}

async function listMyBookings(req, res, next) {
  try {
    const bookings = await bookingService.listUserBookings(req.session.user.id);
    res.render("pages/minhas_reservas", {
      bookings,
      notice: req.query.notice || null,
    });
  } catch (err) {
    next(err);
  }
}

async function cancelBooking(req, res, next) {
  try {
    const result = await bookingService.cancelBooking({
      bookingId: req.params.id,
      user: req.session.user,
    });
    await auditService.log(AuditAction.BOOKING_CANCELLED, {
      req,
      metadata: {
        bookingId: req.params.id,
        resultado: result.status,
        estornado: result.refunded,
      },
    });
    const notice = result.refunded
      ? "Reserva cancelada e estorno solicitado."
      : "Reserva cancelada.";
    res.redirect(`/minhas-reservas?notice=${encodeURIComponent(notice)}`);
  } catch (err) {
    if (err instanceof bookingService.BookingError) {
      return res.redirect(`/minhas-reservas?notice=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
}

module.exports = {
  MOTIVOS,
  showService,
  createBooking,
  showCheckout,
  startPayment,
  paymentStatus,
  showReceipt,
  listMyBookings,
  cancelBooking,
};
