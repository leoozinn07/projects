/* ==============================================================
   AquaTrip — Experiências de parceiros (marketplace, fase 2)
   ==============================================================
   Ciclo: DRAFT -> (enviar) -> PENDING -> APPROVED | REJECTED
          REJECTED -> (corrigir e reenviar) -> PENDING

   Regras de edição de experiência APROVADA:
   - título, descrição, local, categoria: voltam para revisão (PENDING)
     e saem da vitrine até nova aprovação. Texto é onde mora o risco
     de conteúdo proibido ou "isca e troca" depois de aprovado.
   - preço e horários: mudam na hora (operação do dia a dia; o valor
     de cada reserva já feita fica congelado nela).

   Toda operação confere a posse: o parceiro só mexe no que é dele.
   Experiência de outro parceiro responde 404 (não confirma que existe).
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");
const adminRepository = require("../repositories/adminRepository");
const adminService = require("./adminService");
const mediaService = require("./mediaService");
const auditService = require("./auditService");
const mailService = require("./mailService");
const { CATEGORIAS } = require("../lib/categorias");
const log = require("../lib/logger").forModule("parceiro-experiencias");
const { AuditAction } = auditService;

const MOTIVOS_REVISAO = Object.freeze({
  INFORMACAO_ENGANOSA: "Informações enganosas ou incompatíveis com a experiência",
  FORA_DO_ESCOPO: "Não é uma experiência aquática",
  SEGURANCA: "Faltam informações de segurança obrigatórias para esta atividade",
  CONTEUDO_IMPROPRIO: "Texto com conteúdo impróprio ou ofensivo",
  DADOS_DE_CONTATO: "Texto contém telefone, site ou contato para fechar fora da plataforma",
});
const CAMPOS_REVISADOS = ["title", "description", "location", "category"];

class ExperienceError extends Error {
  constructor(message, code, status = 400, campo = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.campo = campo;
  }
}

/** Parceiro APROVADO do usuário, ou erro. Suspenso não edita. */
async function parceiroAtivo(userId) {
  const { rows } = await db.query(
    `SELECT id, status, display_name, mp_connected_at FROM partners WHERE user_id = ?`, [userId]
  );
  if (!rows[0]) throw new ExperienceError("Você ainda não é parceiro.", "NOT_PARTNER", 403);
  if (rows[0].status !== "APPROVED") {
    throw new ExperienceError("Seu cadastro de parceiro não está ativo.", "PARTNER_NOT_ACTIVE", 403);
  }
  return rows[0];
}

/** Experiência do parceiro, travada para escrita quando `client` é dado. */
async function minha(partnerId, serviceId, client = db) {
  const { rows } = await client.query(
    `SELECT * FROM services WHERE id = ? AND partner_id = ?${client === db ? "" : " FOR UPDATE"}`,
    [serviceId, partnerId]
  );
  if (!rows[0]) throw new ExperienceError("Experiência não encontrada.", "NOT_FOUND", 404);
  return rows[0];
}

async function listarMinhas(userId) {
  const p = await parceiroAtivo(userId);
  const { rows } = await db.query(
    `SELECT s.id, s.slug, s.title, s.location, s.category, s.price_cents, s.description, s.active,
            s.review_status, s.review_reason, s.submitted_at, s.reviewed_at,
            (SELECT storage_key FROM media WHERE id = s.cover_media_id) AS cover_key,
            (SELECT storage_key FROM media WHERE id = s.pending_cover_media_id) AS pending_cover_key,
            (SELECT COUNT(*) FROM service_slots sl WHERE sl.service_id = s.id AND sl.starts_at > NOW()) AS horarios_futuros
     FROM services s WHERE s.partner_id = ? ORDER BY s.created_at DESC`,
    [p.id]
  );
  return {
    parceiro: p,
    experiencias: rows.map((e) => ({
      ...e,
      horarios_futuros: Number(e.horarios_futuros),
      motivo: e.review_reason ? MOTIVOS_REVISAO[e.review_reason] : null,
    })),
  };
}

function validarCategoria(cat) {
  if (!CATEGORIAS[cat]) throw new ExperienceError("Categoria inválida.", "INVALID_CATEGORY", 422, "categoria");
}

async function criar({ userId, dados, req }) {
  const p = await parceiroAtivo(userId);
  validarCategoria(dados.category);
  const base = adminService.slugify(dados.title);
  if (!base) throw new ExperienceError("Título inválido.", "INVALID_TITLE", 422, "titulo");
  let slug = base;
  for (let i = 2; await adminRepository.slugExists(slug); i++) slug = `${base}-${i}`;

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO services (id, slug, title, location, category, price_cents, description, partner_id, review_status, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', TRUE)`,
    [id, slug, dados.title, dados.location, dados.category, dados.priceCents, dados.description || null, p.id]
  );
  const { rows } = await db.query(
    `SELECT id, slug, review_status FROM services WHERE id = ?`,
    [id]
  );
  await auditService.log(AuditAction.PARTNER_SERVICE_CREATED, { req, userId, metadata: { servicoId: id, parceiroId: p.id } });
  return rows[0];
}

async function editar({ userId, serviceId, dados, req }) {
  const p = await parceiroAtivo(userId);
  if (dados.category) validarCategoria(dados.category);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const atual = await minha(p.id, serviceId, client);
    if (atual.review_status === "PENDING") {
      throw new ExperienceError("A experiência está em revisão. Aguarde a resposta para editar.", "UNDER_REVIEW", 409);
    }
    const mudaTexto = CAMPOS_REVISADOS.some((c) => dados[c] !== undefined && dados[c] !== atual[c]);
    // Aprovada + mudança de texto => volta para revisão (sai da vitrine).
    const novoStatus = atual.review_status === "APPROVED" && mudaTexto ? "PENDING" : atual.review_status;

    // status ANTIGO como parâmetro (atual.review_status), não lido da
    // coluna dentro do próprio UPDATE: o MySQL avalia um SET de várias
    // colunas da esquerda pra direita, então "review_status" já estaria
    // com o valor NOVO por causa da atribuição anterior nesta mesma
    // instrução — diferente do Postgres, que avalia tudo contra a linha
    // de antes. Usar o valor que já temos em JS evita depender da ordem.
    await client.query(
      `UPDATE services SET
         title = COALESCE(?, title), description = COALESCE(?, description),
         location = COALESCE(?, location), category = COALESCE(?, category),
         price_cents = COALESCE(?, price_cents),
         review_status = ?,
         submitted_at = CASE WHEN ? = 'PENDING' AND ? <> 'PENDING' THEN NOW() ELSE submitted_at END
       WHERE id = ?`,
      [dados.title ?? null, dados.description ?? null, dados.location ?? null,
       dados.category ?? null, dados.priceCents ?? null, novoStatus, novoStatus, atual.review_status, serviceId]
    );
    const { rows } = await client.query(
      `SELECT id, review_status, price_cents FROM services WHERE id = ?`,
      [serviceId]
    );
    await client.query("COMMIT");
    await auditService.log(AuditAction.PARTNER_SERVICE_UPDATED, {
      req, userId, metadata: { servicoId: serviceId, voltouParaRevisao: novoStatus !== atual.review_status },
    });
    return { ...rows[0], voltouParaRevisao: novoStatus !== atual.review_status };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** DRAFT ou REJECTED -> PENDING. */
async function enviarParaRevisao({ userId, serviceId, req }) {
  const p = await parceiroAtivo(userId);
  const atual = await minha(p.id, serviceId);
  if (!["DRAFT", "REJECTED"].includes(atual.review_status)) {
    throw new ExperienceError("Só rascunhos ou experiências recusadas podem ser enviados.", "INVALID_STATE", 409);
  }
  if (!atual.description || atual.description.trim().length < 40) {
    throw new ExperienceError("Descreva a experiência (mínimo de 40 caracteres) antes de enviar.", "DESCRIPTION_REQUIRED", 422, "descricao");
  }
  const { rowCount } = await db.query(
    `UPDATE services SET review_status = 'PENDING', review_reason = NULL, submitted_at = NOW()
     WHERE id = ? AND review_status IN ('DRAFT', 'REJECTED')`,
    [serviceId]
  );
  if (!rowCount) throw new ExperienceError("A experiência mudou de situação. Recarregue a página.", "INVALID_STATE", 409);
  const { rows } = await db.query(`SELECT id, review_status FROM services WHERE id = ?`, [serviceId]);
  await auditService.log(AuditAction.PARTNER_SERVICE_SUBMITTED, { req, userId, metadata: { servicoId: serviceId } });
  return rows[0];
}

/** Pausar/retomar vendas (não passa por revisão). */
async function definirAtiva({ userId, serviceId, ativa, req }) {
  const p = await parceiroAtivo(userId);
  await minha(p.id, serviceId);
  await db.query(`UPDATE services SET active = ? WHERE id = ?`, [ativa, serviceId]);
  await auditService.log(AuditAction.PARTNER_SERVICE_UPDATED, { req, userId, metadata: { servicoId: serviceId, ativa } });
}

/* ---------- Horários (mesmas regras e consultas do admin) ---------- */

async function horarios({ userId, serviceId }) {
  const p = await parceiroAtivo(userId);
  await minha(p.id, serviceId);
  return adminRepository.listSlots(serviceId);
}

async function criarHorarios({ userId, serviceId, programacao, req }) {
  const p = await parceiroAtivo(userId);
  await minha(p.id, serviceId);
  const combinacoes = adminService.expandirProgramacao(programacao);
  if (!combinacoes.length) throw new ExperienceError("Nenhum horário gerado: confira período e dias.", "EMPTY_SCHEDULE", 422);
  if (combinacoes.length > adminService.MAX_HORARIOS_POR_LOTE) {
    throw new ExperienceError(`Mais de ${adminService.MAX_HORARIOS_POR_LOTE} horários de uma vez. Divida o período.`, "SCHEDULE_TOO_LARGE", 422);
  }
  const criados = await adminRepository.createSlots(serviceId, combinacoes, programacao.capacidade);
  await auditService.log(AuditAction.PARTNER_SERVICE_UPDATED, { req, userId, metadata: { servicoId: serviceId, horariosCriados: criados.length } });
  return { solicitados: combinacoes.length, criados: criados.length, ignorados: combinacoes.length - criados.length };
}

async function horarioDoParceiro(partnerId, slotId) {
  const uso = await adminRepository.slotUsage(slotId);
  if (!uso) throw new ExperienceError("Horário não encontrado.", "NOT_FOUND", 404);
  await minha(partnerId, uso.service_id); // 404 se o horário for de outro
  return uso;
}

async function capacidadeHorario({ userId, slotId, capacidade }) {
  const p = await parceiroAtivo(userId);
  const uso = await horarioDoParceiro(p.id, slotId);
  if (capacidade < uso.ocupados) {
    throw new ExperienceError(`Já há ${uso.ocupados} vaga(s) ocupada(s); a capacidade não pode ficar abaixo disso.`, "BELOW_OCCUPIED", 409);
  }
  return adminRepository.updateSlotCapacity(slotId, capacidade);
}

async function removerHorario({ userId, slotId }) {
  const p = await parceiroAtivo(userId);
  const uso = await horarioDoParceiro(p.id, slotId);
  if (uso.reservas_historicas > 0) {
    throw new ExperienceError("Horário com reservas no histórico não pode ser apagado. Reduza a capacidade ao já ocupado.", "HAS_BOOKINGS", 409);
  }
  await adminRepository.deleteSlot(slotId);
}

/* ---------- Capa: nova foto fica pendente sem derrubar a atual ---------- */

async function enviarCapa({ userId, serviceId, buffer, alt, req }) {
  const p = await parceiroAtivo(userId);
  const atual = await minha(p.id, serviceId);
  const media = await mediaService.salvarImagem({ buffer, usuarioId: userId, purpose: "COVER", status: "PENDING" });
  await db.query(
    `UPDATE services SET pending_cover_media_id = ?, pending_cover_alt = ? WHERE id = ?`,
    [media.id, alt, serviceId]
  );
  // Troca de pendente: a anterior, ainda não moderada, não faz mais sentido.
  if (atual.pending_cover_media_id) await mediaService.apagar(atual.pending_cover_media_id);
  await auditService.log(AuditAction.PHOTO_SUBMITTED, { req, userId, metadata: { servicoId: serviceId, midiaId: media.id, capa: true } });
  return { id: media.id, status: "PENDING" };
}

/**
 * Chamado pela moderação quando uma CAPA pendente é decidida.
 * Aprovada: vira a capa (a antiga é apagada). Recusada: sai da espera.
 */
async function aoModerarCapa({ mediaId, aprovada, motivoTexto }) {
  const { rows } = await db.query(
    `SELECT s.id, s.title, s.cover_media_id, s.pending_cover_alt, u.email, u.name
     FROM services s JOIN partners p ON p.id = s.partner_id JOIN users u ON u.id = p.user_id
     WHERE s.pending_cover_media_id = ?`,
    [mediaId]
  );
  const s = rows[0];
  if (!s) return;
  if (aprovada) {
    await db.query(
      `UPDATE services SET cover_media_id = ?, cover_alt = pending_cover_alt,
              pending_cover_media_id = NULL, pending_cover_alt = NULL WHERE id = ?`,
      [mediaId, s.id]
    );
    if (s.cover_media_id) await mediaService.apagar(s.cover_media_id);
  } else {
    await db.query(`UPDATE services SET pending_cover_media_id = NULL, pending_cover_alt = NULL WHERE id = ?`, [s.id]);
  }
  mailService.send({
    to: s.email,
    template: aprovada ? "capa_aprovada" : "capa_recusada",
    subject: `Foto de capa ${aprovada ? "aprovada" : "não aprovada"} — AquaTrip`,
    text: aprovada
      ? `${s.name.split(" ")[0]}, a nova foto de capa de "${s.title}" foi aprovada e já está no ar.`
      : `${s.name.split(" ")[0]}, a nova foto de capa de "${s.title}" não foi aprovada. Motivo: ${motivoTexto}. A capa anterior continua no ar.`,
  }).catch((err) => log.error({ err }, "falha ao avisar moderação de capa"));
}

/* ---------- Revisão pelo admin ---------- */

async function filaRevisao() {
  const { rows } = await db.query(
    `SELECT s.id, s.slug, s.title, s.location, s.category, s.price_cents, s.description, s.submitted_at,
            p.display_name AS parceiro, p.id AS parceiro_id,
            (SELECT storage_key FROM media WHERE id = s.cover_media_id) AS cover_key
     FROM services s JOIN partners p ON p.id = s.partner_id
     WHERE s.review_status = 'PENDING'
     ORDER BY s.submitted_at`
  );
  return rows;
}

async function decidirRevisao({ adminId, serviceId, aprovar, motivo, req }) {
  if (!aprovar && !MOTIVOS_REVISAO[motivo]) {
    throw new ExperienceError("Escolha um motivo da lista.", "INVALID_REASON", 422);
  }
  const { rowCount } = await db.query(
    `UPDATE services SET review_status = ?, review_reason = ?, reviewed_by = ?, reviewed_at = NOW()
     WHERE id = ? AND review_status = 'PENDING' AND partner_id IS NOT NULL`,
    [aprovar ? "APPROVED" : "REJECTED", aprovar ? null : motivo, adminId, serviceId]
  );
  if (!rowCount) throw new ExperienceError("Experiência não encontrada ou já revisada.", "NOT_PENDING", 409);
  const { rows } = await db.query(
    `SELECT id, title, review_status, partner_id FROM services WHERE id = ?`,
    [serviceId]
  );
  await auditService.log(AuditAction.PARTNER_SERVICE_REVIEWED, {
    req, userId: adminId, metadata: { servicoId: serviceId, aprovada: aprovar, motivo: motivo || null },
  });
  const { rows: u } = await db.query(
    `SELECT u.email, u.name, p.mp_connected_at FROM partners p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
    [rows[0].partner_id]
  );
  if (u[0]) {
    const semMp = !u[0].mp_connected_at;
    mailService.send({
      to: u[0].email,
      template: aprovar ? "experiencia_aprovada" : "experiencia_recusada",
      subject: `"${rows[0].title}" ${aprovar ? "foi aprovada" : "precisa de ajustes"} — AquaTrip`,
      text: aprovar
        ? `${u[0].name.split(" ")[0]}, a experiência "${rows[0].title}" foi aprovada.` +
          (semMp ? " Ela aparece na vitrine assim que você conectar sua conta do Mercado Pago na área do parceiro." : " Ela já está na vitrine.")
        : `${u[0].name.split(" ")[0]}, a experiência "${rows[0].title}" não foi aprovada. Motivo: ${MOTIVOS_REVISAO[motivo]}. Ajuste e envie de novo.`,
    }).catch((err) => log.error({ err }, "falha ao avisar revisão"));
  }
  return rows[0];
}

module.exports = {
  ExperienceError, MOTIVOS_REVISAO,
  listarMinhas, criar, editar, enviarParaRevisao, definirAtiva,
  horarios, criarHorarios, capacidadeHorario, removerHorario,
  enviarCapa, aoModerarCapa, filaRevisao, decidirRevisao,
};
