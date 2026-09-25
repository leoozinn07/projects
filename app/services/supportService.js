/* ==============================================================
   AquaTrip — Atendimento
   ============================================================== */
const crypto = require("crypto");
const argon2 = require("argon2");
const supportRepository = require("../repositories/supportRepository");
const mailService = require("./mailService");
const auditService = require("./auditService");
const consentService = require("./consentService");
const { KIND_LABELS } = require("./dataRightsService");
const log = require("../lib/logger").forModule("atendimento");
const { AuditAction } = auditService;

class SupportError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* ---------- Contato ---------- */

async function receiveContact({ dados, req }) {
  const registro = await supportRepository.createMessage({
    ...dados,
    ip: consentService.minimizarIp(auditService.clientIp(req)),
  });

  // Notifica a equipe. Falha de e-mail não perde a mensagem: ela já
  // está gravada e aparece no painel de atendimento.
  const destino = process.env.CONTACT_INBOX;
  if (destino) {
    mailService
      .send({
        to: destino,
        template: "contato_recebido",
        subject: `Novo contato de parceiro: ${dados.company || dados.name}`,
        text:
          `Nome: ${dados.name}\nE-mail: ${dados.email}\nEmpresa: ${dados.company || "—"}\n` +
          `Região: ${dados.region || "—"}\n\n${dados.message}\n\n` +
          `Responda direto para ${dados.email} ou veja no painel: /admin (Atendimento).`,
      })
      .catch((err) => log.error({ err }, "falha ao notificar novo contato"));
  }
  return registro;
}

/* ---------- Solicitações LGPD ---------- */

const STATUS_VALIDOS = ["IN_PROGRESS", "DONE", "REJECTED"];

async function answerRequest({ adminId, requestId, status, resposta, anonimizar, req }) {
  if (!STATUS_VALIDOS.includes(status)) {
    throw new SupportError("Situação inválida.", "INVALID_STATUS");
  }
  if ((status === "DONE" || status === "REJECTED") && !resposta) {
    // O titular tem direito de saber o que foi feito — e a recusa
    // precisa ser fundamentada (art. 18, §4º).
    throw new SupportError("Escreva a resposta que será enviada ao titular.", "RESPONSE_REQUIRED");
  }

  const pedido = await supportRepository.getRequest(requestId);
  if (!pedido) throw new SupportError("Solicitação não encontrada.", "NOT_FOUND", 404);
  if (pedido.status === "DONE" || pedido.status === "REJECTED") {
    throw new SupportError("Esta solicitação já foi encerrada.", "ALREADY_CLOSED", 409);
  }

  if (anonimizar) {
    if (!["DELETION", "ANONYMIZATION"].includes(pedido.kind)) {
      throw new SupportError("Anonimização só se aplica a pedidos de eliminação ou anonimização.", "WRONG_KIND");
    }
    if (status !== "DONE") {
      throw new SupportError("Para anonimizar, marque a solicitação como concluída.", "ANON_REQUIRES_DONE");
    }
    if (pedido.user_role === "ADMIN") {
      throw new SupportError("Contas de administrador não são anonimizadas pelo painel.", "ADMIN_PROTECTED");
    }
    // Parceiro aprovado ou suspenso tem experiências e vendas com guarda
    // fiscal: a parceria precisa ser encerrada formalmente antes.
    const { rows: parc } = await require("../lib/db").query(
      `SELECT status FROM partners WHERE user_id = ?`, [pedido.user_id]
    );
    if (parc[0] && ["APPROVED", "SUSPENDED"].includes(parc[0].status)) {
      throw new SupportError(
        "O titular é parceiro ativo. Encerre formalmente a parceria (e as experiências dele) antes de anonimizar.",
        "ACTIVE_PARTNER", 409
      );
    }
    const vivas = await supportRepository.countLiveBookings(pedido.user_id);
    if (vivas > 0) {
      // Anonimizar agora quebraria a viagem que a própria pessoa
      // ainda vai fazer (comprovante, contato, reembolso).
      throw new SupportError(
        `O titular tem ${vivas} reserva(s) futura(s) ou pendente(s). Cancele-as (com estorno, se pagas) antes de anonimizar.`,
        "HAS_LIVE_BOOKINGS",
        409
      );
    }
  }

  const atualizado = await supportRepository.updateRequest(requestId, {
    status,
    response: resposta || null,
    adminId,
  });

  // A resposta vai para o e-mail ANTES de anonimizar — depois disso
  // o endereço deixa de existir no sistema.
  if (status === "DONE" || status === "REJECTED") {
    const titulo = KIND_LABELS[pedido.kind] || "Solicitação de privacidade";
    try {
      await mailService.send({
        to: pedido.user_email,
        template: "lgpd_resposta",
        subject: `Sua solicitação foi ${status === "DONE" ? "atendida" : "respondida"} — AquaTrip`,
        text:
          `Olá, ${pedido.user_name}.\n\nSobre sua solicitação "${titulo}", aberta em ` +
          `${require("../lib/datas").data(pedido.created_at)}:\n\n${resposta}\n\n` +
          (anonimizar
            ? "Sua conta foi anonimizada e este é o último e-mail que você recebe do AquaTrip. " +
              "Registros de pagamento são mantidos sem identificação pelo prazo exigido em lei.\n"
            : "") +
          "\nDúvidas: responda este e-mail.",
      });
    } catch (err) {
      log.error({ err, requestId }, "falha ao enviar resposta da solicitação LGPD");
    }
  }

  if (anonimizar) {
    const hash = await argon2.hash(crypto.randomBytes(32).toString("hex"), { type: argon2.argon2id });
    const r = await supportRepository.anonymizeUser(pedido.user_id, { hashInutilizavel: hash });
    // Arquivos só depois do COMMIT da anonimização.
    await require("./mediaService").apagarArquivos(r.arquivosParaApagar || []);
  }

  // Sem e-mail no registro: se a conta foi anonimizada, a auditoria
  // não pode ser o lugar onde a identidade sobrevive.
  await auditService.log(AuditAction.DATA_REQUEST_ANSWERED, {
    req,
    userId: adminId,
    metadata: { solicitacaoId: requestId, tipo: pedido.kind, status, anonimizou: Boolean(anonimizar) },
  });

  return atualizado;
}

module.exports = {
  SupportError,
  receiveContact,
  answerRequest,
  listMessages: supportRepository.listMessages,
  setMessageStatus: supportRepository.setMessageStatus,
  listRequests: supportRepository.listRequests,
  counters: supportRepository.counters,
  PRAZO_LGPD_DIAS: supportRepository.PRAZO_LGPD_DIAS,
};
