/* ==============================================================
   AquaTrip — Admin Service
   ==============================================================
   Regras de negócio das ações administrativas. Toda ação que muda
   estado é auditada — em investigação, "quem suspendeu esta
   conta?" precisa ter resposta.

   Travas que existem de propósito:
   - Admin não suspende a si mesmo nem outro admin: evita que um
     clique errado (ou uma conta de admin comprometida) tranque a
     equipe fora do sistema.
   - Experiência com reserva viva não é desativada: quem já pagou
     ficaria com reserva de um serviço "inexistente".
   ============================================================== */
const adminRepository = require("../repositories/adminRepository");
const userRepository = require("../repositories/userRepository");
const auditService = require("./auditService");
const { AuditAction } = auditService;

const PLATFORM_FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT || 10);

class AdminError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "AdminError";
    this.code = code;
    this.status = status;
  }
}

/* ---------- Painel ---------- */

async function dashboard() {
  const [metricas, receitaMensal, inconsistencias, plataforma] = await Promise.all([
    adminRepository.metrics({ platformFeePercent: PLATFORM_FEE_PERCENT }),
    adminRepository.revenueByMonth(6),
    adminRepository.inconsistencies(),
    adminRepository.platformCounts(),
  ]);
  return {
    metricas,
    plataforma,
    receitaMensal,
    inconsistencias,
    taxaPlataformaPercent: PLATFORM_FEE_PERCENT,
  };
}

/* ---------- Usuários ---------- */

function listUsers(filtros) {
  return adminRepository.listUsers(filtros);
}

async function suspendUser({ adminId, userId, dias, motivo, req }) {
  if (userId === adminId) {
    throw new AdminError("Você não pode suspender a própria conta.", "SELF_SUSPEND");
  }

  const alvo = await userRepository.findById(userId);
  if (!alvo) throw new AdminError("Usuário não encontrado.", "NOT_FOUND", 404);
  if (alvo.role === "ADMIN") {
    throw new AdminError(
      "Administradores não podem ser suspensos pelo painel.",
      "ADMIN_PROTECTED"
    );
  }

  // Date, não .toISOString(): o mysql2 aceita objeto Date nativamente pra
  // coluna DATETIME, mas rejeita a string ISO 8601 (formato com "T"/"Z").
  const ate = dias ? new Date(Date.now() + dias * 86400000) : null;
  const atualizado = await adminRepository.setUserStatus(userId, {
    status: "SUSPENDED",
    suspendedUntil: ate,
    reason: motivo || null,
  });

  // Suspender sem derrubar a sessão seria enganoso: a pessoa
  // continuaria navegando até a sessão expirar sozinha.
  const sessoes = await adminRepository.destroyUserSessions(userId);

  await auditService.log(AuditAction.ADMIN_USER_SUSPENDED, {
    req,
    userId: adminId,
    metadata: { alvo: userId, alvoEmail: alvo.email, dias: dias || "indeterminado", motivo, sessoesEncerradas: sessoes },
  });

  return atualizado;
}

async function reactivateUser({ adminId, userId, req }) {
  const atualizado = await adminRepository.setUserStatus(userId, { status: "ACTIVE" });
  if (!atualizado) throw new AdminError("Usuário não encontrado.", "NOT_FOUND", 404);

  await auditService.log(AuditAction.ADMIN_USER_REACTIVATED, {
    req,
    userId: adminId,
    metadata: { alvo: userId, alvoEmail: atualizado.email },
  });
  return atualizado;
}

/* ---------- Experiências ---------- */

function listServices() {
  return adminRepository.listServices({ incluirInativas: true });
}

/** Gera slug de URL a partir do título: "Mergulho em Noronha" -> "mergulho-em-noronha". */
function slugify(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function createService({ adminId, dados, req }) {
  let base = slugify(dados.title);
  if (!base) throw new AdminError("Título inválido.", "INVALID_TITLE");

  // Garante unicidade sem depender de o admin escolher o slug.
  let slug = base;
  for (let i = 2; await adminRepository.slugExists(slug); i++) slug = `${base}-${i}`;

  const criado = await adminRepository.createService({ ...dados, slug });
  await auditService.log(AuditAction.ADMIN_SERVICE_CREATED, {
    req,
    userId: adminId,
    metadata: { servicoId: criado.id, titulo: criado.title, precoCentavos: criado.price_cents },
  });
  return criado;
}

async function updateService({ adminId, id, dados, req }) {
  const atualizado = await adminRepository.updateService(id, dados);
  if (!atualizado) throw new AdminError("Experiência não encontrada.", "NOT_FOUND", 404);

  await auditService.log(AuditAction.ADMIN_SERVICE_UPDATED, {
    req,
    userId: adminId,
    metadata: { servicoId: id, titulo: atualizado.title, precoCentavos: atualizado.price_cents },
  });
  return atualizado;
}

async function setServiceActive({ adminId, id, active, req }) {
  if (!active) {
    const vivas = await adminRepository.countLiveBookings(id);
    if (vivas > 0) {
      throw new AdminError(
        `Não é possível desativar: há ${vivas} reserva(s) ativa(s) para esta experiência. ` +
          "Cancele ou aguarde a realização antes.",
        "HAS_LIVE_BOOKINGS",
        409
      );
    }
  }

  const r = await adminRepository.setServiceActive(id, active);
  if (!r) throw new AdminError("Experiência não encontrada.", "NOT_FOUND", 404);

  await auditService.log(AuditAction.ADMIN_SERVICE_UPDATED, {
    req,
    userId: adminId,
    metadata: { servicoId: id, ativa: active },
  });
  return r;
}

/* ---------- Horários ---------- */

const MAX_HORARIOS_POR_LOTE = 400;

/**
 * Expande uma programação em combinações (data, hora).
 * Ex.: de 01/10 a 31/10, sábados e domingos, às 09:00 e 14:00.
 * A expansão acontece em datas de calendário puras (sem fuso), e a
 * conversão para instante real fica com o banco.
 */
function expandirProgramacao({ dataInicio, dataFim, diasSemana, horarios }) {
  const combinacoes = [];
  const [ai, mi, di] = dataInicio.split("-").map(Number);
  const [af, mf, df] = dataFim.split("-").map(Number);
  // Date.UTC: aritmética de calendário sem interferência do fuso do servidor.
  const inicio = Date.UTC(ai, mi - 1, di);
  const fim = Date.UTC(af, mf - 1, df);
  const DIA = 86400000;

  for (let t = inicio; t <= fim; t += DIA) {
    const d = new Date(t);
    if (!diasSemana.includes(d.getUTCDay())) continue;
    const data = d.toISOString().slice(0, 10);
    for (const hora of horarios) combinacoes.push({ data, hora });
    if (combinacoes.length > MAX_HORARIOS_POR_LOTE) break;
  }
  return combinacoes;
}

async function listSlots(serviceId) {
  return adminRepository.listSlots(serviceId);
}

async function createSlots({ adminId, serviceId, programacao, req }) {
  const combinacoes = expandirProgramacao(programacao);
  if (!combinacoes.length) {
    throw new AdminError(
      "Nenhum horário gerado: confira o período e os dias da semana escolhidos.",
      "EMPTY_SCHEDULE"
    );
  }
  if (combinacoes.length > MAX_HORARIOS_POR_LOTE) {
    throw new AdminError(
      `A programação geraria mais de ${MAX_HORARIOS_POR_LOTE} horários de uma vez. ` +
        "Divida em períodos menores.",
      "SCHEDULE_TOO_LARGE"
    );
  }

  const criados = await adminRepository.createSlots(serviceId, combinacoes, programacao.capacidade);

  await auditService.log(AuditAction.ADMIN_SLOTS_CREATED, {
    req,
    userId: adminId,
    metadata: {
      servicoId: serviceId,
      solicitados: combinacoes.length,
      criados: criados.length,
      capacidade: programacao.capacidade,
      periodo: `${programacao.dataInicio}..${programacao.dataFim}`,
    },
  });

  return {
    solicitados: combinacoes.length,
    criados: criados.length,
    // Diferença = já existiam (ON CONFLICT) ou caíram no passado.
    ignorados: combinacoes.length - criados.length,
  };
}

async function updateSlotCapacity({ adminId, slotId, capacidade, req }) {
  const uso = await adminRepository.slotUsage(slotId);
  if (!uso) throw new AdminError("Horário não encontrado.", "NOT_FOUND", 404);
  if (capacidade < uso.ocupados) {
    // Reduzir abaixo do vendido deixaria pessoas pagantes sem vaga.
    throw new AdminError(
      `Este horário já tem ${uso.ocupados} vaga(s) ocupada(s). A capacidade não pode ficar abaixo disso.`,
      "BELOW_OCCUPIED",
      409
    );
  }
  const r = await adminRepository.updateSlotCapacity(slotId, capacidade);
  await auditService.log(AuditAction.ADMIN_SLOTS_UPDATED, {
    req,
    userId: adminId,
    metadata: { horarioId: slotId, de: uso.capacity, para: capacidade },
  });
  return r;
}

async function deleteSlot({ adminId, slotId, req }) {
  const uso = await adminRepository.slotUsage(slotId);
  if (!uso) throw new AdminError("Horário não encontrado.", "NOT_FOUND", 404);
  if (uso.reservas_historicas > 0) {
    // Qualquer reserva, mesmo cancelada ou estornada, aponta para este
    // horário e compõe o histórico financeiro. Apagar quebraria esse
    // vínculo — o banco também recusaria (FK com RESTRICT).
    throw new AdminError(
      "Este horário tem reservas no histórico e não pode ser apagado. " +
        "Para impedir novas vendas, reduza a capacidade ao número já ocupado.",
      "HAS_BOOKINGS",
      409
    );
  }
  await adminRepository.deleteSlot(slotId);
  await auditService.log(AuditAction.ADMIN_SLOTS_UPDATED, {
    req,
    userId: adminId,
    metadata: { horarioId: slotId, acao: "removido", inicio: uso.starts_at },
  });
  return true;
}

/* ---------- Transações ---------- */

async function listTransactions(filtros) {
  const lista = await adminRepository.listTransactions(filtros);
  return lista.map((t) => ({
    ...t,
    taxa_cents: t.status === "APPROVED"
      ? Math.round((t.amount_cents * PLATFORM_FEE_PERCENT) / 100)
      : 0,
  }));
}

/* ---------- Banimento, perfil completo e moderação da comunidade ---------- */

const MOTIVO_MIN = 5;

function exigirMotivo(motivo) {
  const m = String(motivo || "").trim();
  if (m.length < MOTIVO_MIN || m.length > 300) {
    throw new AdminError("Informe o motivo (entre 5 e 300 caracteres). Ele fica registrado.", "REASON_REQUIRED", 422);
  }
  return m;
}

/** Banimento: permanente, derruba sessões e tira do ar o que a conta publicou. */
async function banUser({ adminId, userId, motivo, req }) {
  const razao = exigirMotivo(motivo);
  if (userId === adminId) throw new AdminError("Você não pode banir a própria conta.", "SELF_BAN");
  const alvo = await userRepository.findById(userId);
  if (!alvo) throw new AdminError("Usuário não encontrado.", "NOT_FOUND", 404);
  if (alvo.role === "ADMIN") throw new AdminError("Administradores não podem ser banidos pelo painel.", "ADMIN_PROTECTED");

  const atualizado = await adminRepository.setUserStatus(userId, { status: "BANNED", reason: razao });
  const sessoes = await adminRepository.destroyUserSessions(userId);
  const experiencias = await adminRepository.moderateServicesOfCreator(userId, {
    reason: `Conta do criador banida: ${razao}`.slice(0, 300), adminId,
  });
  await auditService.log(AuditAction.ADMIN_USER_BANNED, {
    req, userId: adminId,
    metadata: { alvo: userId, alvoEmail: alvo.email, motivo: razao, sessoesEncerradas: sessoes, experienciasRetiradas: experiencias },
  });
  return atualizado;
}

/**
 * Cadastro completo (inclui CPF/CNPJ do cadastro de parceiro, quando
 * existe). Dado sensível: só admin chega aqui (requireRole no router)
 * e todo acesso fica na trilha de auditoria, com quem viu e quando.
 */
async function userDetail({ adminId, userId, req }) {
  const detalhe = await adminRepository.userDetail(userId);
  if (!detalhe) throw new AdminError("Usuário não encontrado.", "NOT_FOUND", 404);
  await auditService.log(AuditAction.ADMIN_USER_VIEWED, {
    req, userId: adminId, metadata: { alvo: userId, viuDocumento: !!detalhe.document },
  });
  return detalhe;
}

function listCommunityServices(filtros) {
  return adminRepository.listCommunityServices(filtros);
}

const ESTADOS_MODERACAO = ["ACTIVE", "SUSPENDED", "BANNED"];

async function moderateExperience({ adminId, serviceId, status, motivo, req }) {
  if (!ESTADOS_MODERACAO.includes(status)) throw new AdminError("Estado inválido.", "INVALID_STATUS", 422);
  const razao = status === "ACTIVE" ? null : exigirMotivo(motivo);
  const ok = await adminRepository.setServiceModeration(serviceId, { status, reason: razao, adminId });
  if (!ok) throw new AdminError("Experiência não encontrada.", "NOT_FOUND", 404);
  // Decidir sobre a experiência encerra as denúncias abertas dela.
  const denuncias = await adminRepository.closeReports(serviceId, {
    status: status === "ACTIVE" ? "DISMISSED" : "RESOLVED", adminId,
  });
  await auditService.log(AuditAction.ADMIN_EXPERIENCE_MODERATED, {
    req, userId: adminId, metadata: { servicoId: serviceId, status, motivo: razao, denunciasEncerradas: denuncias },
  });
  return { id: serviceId, moderation_status: status, moderation_reason: razao };
}

async function experienceModerationDetail(serviceId) {
  const [denuncias, comentarios] = await Promise.all([
    adminRepository.listReports(serviceId),
    adminRepository.listServiceComments(serviceId),
  ]);
  return { denuncias, comentarios };
}

async function dismissReports({ adminId, serviceId, req }) {
  const n = await adminRepository.closeReports(serviceId, { status: "DISMISSED", adminId });
  await auditService.log(AuditAction.ADMIN_REPORT_HANDLED, { req, userId: adminId, metadata: { servicoId: serviceId, arquivadas: n } });
  return { arquivadas: n };
}

async function moderateComment({ adminId, commentId, ocultar, motivo, req }) {
  const razao = ocultar ? exigirMotivo(motivo) : null;
  const ok = await adminRepository.setCommentStatus(commentId, { hidden: ocultar, reason: razao, adminId });
  if (!ok) throw new AdminError("Comentário não encontrado.", "NOT_FOUND", 404);
  await auditService.log(AuditAction.ADMIN_COMMENT_MODERATED, {
    req, userId: adminId, metadata: { comentarioId: commentId, ocultar, motivo: razao },
  });
  return { id: commentId, status: ocultar ? "HIDDEN" : "VISIBLE" };
}

module.exports = {
  AdminError,
  PLATFORM_FEE_PERCENT,
  slugify,
  dashboard,
  listUsers,
  suspendUser,
  reactivateUser,
  listServices,
  createService,
  updateService,
  setServiceActive,
  listTransactions,
  expandirProgramacao,
  MAX_HORARIOS_POR_LOTE,
  listSlots,
  createSlots,
  updateSlotCapacity,
  deleteSlot,
  banUser,
  userDetail,
  listCommunityServices,
  moderateExperience,
  experienceModerationDetail,
  dismissReports,
  moderateComment,
};
