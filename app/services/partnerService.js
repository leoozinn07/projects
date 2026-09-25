/* ==============================================================
   AquaTrip — Parceiros (marketplace, fase 1)
   ==============================================================
   Fluxo: a pessoa (já com conta) se cadastra e o cadastro já nasce
   APROVADO (decisão do dono do produto, set/2026): a área do parceiro
   abre na hora para cadastrar experiências e conectar o Mercado Pago.
   O controle passou a ser depois: o admin suspende/reativa e ajusta a
   comissão. As validações de entrada continuam (CPF/CNPJ com dígito
   verificador, documento único, aceite dos termos). Candidaturas
   PENDING antigas foram aprovadas pela migration 020.
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");
const documentos = require("../lib/documentos");
const auditService = require("./auditService");
const mailService = require("./mailService");
const log = require("../lib/logger").forModule("parceiros");
const { AuditAction } = auditService;

const COMISSAO_PADRAO = Number(process.env.PARTNER_COMMISSION_PCT || 15);
const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

/* Lista FECHADA de motivos: decisões auditáveis e explicação clara. */
const MOTIVOS_RECUSA = Object.freeze({
  IDENTIDADE_NAO_CONFIRMADA: "Não conseguimos confirmar os dados da pessoa ou da empresa",
  FORA_DO_ESCOPO: "A atividade não é uma experiência aquática",
  DADOS_INCOMPLETOS: "Informações insuficientes para análise",
  SEM_AUTORIZACAO: "Atividade exige licença ou autorização que não foi comprovada",
});
const MOTIVOS_SUSPENSAO = Object.freeze({
  RECLAMACOES: "Reclamações recorrentes de clientes",
  DESCUMPRIMENTO: "Descumprimento dos termos de parceria",
  PEDIDO_DO_PARCEIRO: "A pedido do próprio parceiro",
});

class PartnerError extends Error {
  constructor(message, code, status = 400, campo = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.campo = campo;
  }
}

async function meu(userId) {
  const { rows } = await db.query(
    `SELECT id, person_type, document, legal_name, display_name, phone, city, state, description,
            status, rejection_reason, decided_at, commission_pct, mp_connected_at, mp_live_mode, created_at
     FROM partners WHERE user_id = ?`,
    [userId]
  );
  const p = rows[0];
  if (!p) return null;
  return {
    ...p,
    documento_exibicao: documentos.mascarar(p.document),
    motivo: p.rejection_reason ? (MOTIVOS_RECUSA[p.rejection_reason] || MOTIVOS_SUSPENSAO[p.rejection_reason]) : null,
  };
}

async function candidatar({ userId, dados, req }) {
  const doc = documentos.normalizar(dados.documento);
  const tipo = documentos.identificar(doc);
  if (!tipo) throw new PartnerError("CPF ou CNPJ inválido. Confira os números (CNPJ pode ter letras).", "INVALID_DOCUMENT", 422, "documento");
  if (!UFS.includes(dados.uf)) throw new PartnerError("Estado inválido.", "INVALID_STATE", 422, "uf");

  if (await meu(userId)) {
    throw new PartnerError("Você já tem um cadastro de parceiro.", "ALREADY_PARTNER", 409);
  }
  try {
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO partners (id, user_id, person_type, document, legal_name, display_name, phone,
                             city, state, description, commission_pct, status, decided_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'APPROVED', NOW())`,
      [id, userId, tipo, doc, dados.nomeLegal, dados.nomeExibicao, dados.telefone,
       dados.cidade, dados.uf, dados.descricao || null, COMISSAO_PADRAO]
    );
    const { rows } = await db.query(
      `SELECT id, status, created_at FROM partners WHERE id = ?`,
      [id]
    );
    // Documento NUNCA vai para a auditoria (CPF é dado pessoal).
    await auditService.log(AuditAction.PARTNER_APPLIED, { req, userId, metadata: { parceiroId: id, tipo, aprovadoNaHora: true } });
    const { rows: u } = await db.query(`SELECT email, name FROM users WHERE id = ?`, [userId]);
    if (u[0]) {
      mailService.send({
        to: u[0].email,
        template: "parceiro_cadastrado",
        subject: "Sua área de parceiro está liberada — AquaTrip",
        text: `${u[0].name.split(" ")[0]}, seu cadastro de parceiro "${dados.nomeExibicao}" está ativo. ` +
          `Próximos passos em /parceiro: conecte sua conta do Mercado Pago para receber e cadastre suas experiências ` +
          `(elas vão ao ar na hora). A comissão do AquaTrip é de ${COMISSAO_PADRAO}% por venda paga.`,
      }).catch((err) => log.error({ err }, "falha ao avisar cadastro de parceiro"));
    }
    return rows[0];
  } catch (err) {
    // ER_DUP_ENTRY (errno 1062) é o equivalente MySQL do 23505 do Postgres.
    if (err.code === "ER_DUP_ENTRY") {
      // Documento já usado por outro cadastro. Mensagem GENÉRICA: dizer
      // "CPF já cadastrado" revelaria que aquela pessoa é parceira.
      throw new PartnerError(
        "Não foi possível concluir o cadastro com este documento. Fale com o suporte.",
        "DOCUMENT_UNAVAILABLE", 409, "documento"
      );
    }
    throw err;
  }
}

async function listar({ status = null } = {}) {
  const { rows } = await db.query(
    `SELECT p.*, u.email, u.name AS nome_conta,
            (SELECT COUNT(*) FROM services s WHERE s.partner_id = p.id) AS experiencias
     FROM partners p JOIN users u ON u.id = p.user_id
     ${status ? "WHERE p.status = ?" : ""}
     ORDER BY (p.status = 'PENDING') DESC, p.created_at`,
    status ? [status] : []
  );
  // O admin vê o documento INTEIRO só aqui, na análise.
  return rows.map((p) => ({
    ...p,
    experiencias: Number(p.experiencias),
    documento_formatado: documentos.formatar(p.document),
  }));
}

const TRANSICOES = {
  aprovar:   { de: ["PENDING"], para: "APPROVED" },
  recusar:   { de: ["PENDING"], para: "REJECTED", motivos: MOTIVOS_RECUSA },
  suspender: { de: ["APPROVED"], para: "SUSPENDED", motivos: MOTIVOS_SUSPENSAO },
  reativar:  { de: ["SUSPENDED"], para: "APPROVED" },
  // Sem aprovação manual, a comissão é ajustada depois, em parceiro ativo.
  comissao:  { de: ["APPROVED"], para: "APPROVED", exigeComissao: true },
};

async function decidir({ adminId, partnerId, acao, motivo, comissao, req }) {
  const t = TRANSICOES[acao];
  if (!t) throw new PartnerError("Ação inválida.", "INVALID_ACTION", 422);
  if (t.motivos && !t.motivos[motivo]) throw new PartnerError("Escolha um motivo da lista.", "INVALID_REASON", 422);
  if (t.exigeComissao && (comissao === undefined || comissao === null || comissao === "")) {
    throw new PartnerError("Informe a nova comissão.", "INVALID_COMMISSION", 422);
  }
  if (comissao !== undefined && comissao !== null && !(Number(comissao) >= 0 && Number(comissao) <= 50)) {
    throw new PartnerError("Comissão deve ficar entre 0% e 50%.", "INVALID_COMMISSION", 422);
  }

  // status = ANY($N) (array) do Postgres → IN (?, ?, ...) montado a partir
  // do tamanho de t.de (lista fixa definida em TRANSICOES, nunca vinda do cliente).
  const statusPlaceholders = t.de.map(() => "?").join(", ");
  const { rowCount } = await db.query(
    `UPDATE partners
     SET status = ?, rejection_reason = ?, decided_by = ?, decided_at = NOW(),
         commission_pct = COALESCE(?, commission_pct)
     WHERE id = ? AND status IN (${statusPlaceholders})`,
    [t.para, t.motivos ? motivo : null, adminId, comissao ?? null, partnerId, ...t.de]
  );
  // Só transiciona a partir do estado esperado: duas decisões
  // simultâneas não se atropelam.
  if (!rowCount) throw new PartnerError("Cadastro não encontrado ou em outra situação.", "INVALID_STATE_TRANSITION", 409);
  const { rows } = await db.query(
    `SELECT id, user_id, status, display_name, commission_pct FROM partners WHERE id = ?`,
    [partnerId]
  );
  const p = rows[0];

  await auditService.log(AuditAction.PARTNER_DECIDED, {
    req, userId: adminId,
    metadata: { parceiroId: partnerId, acao, novoStatus: p.status, motivo: motivo || null, comissao: Number(p.commission_pct) },
  });

  const { rows: u } = await db.query(`SELECT email, name FROM users WHERE id = ?`, [p.user_id]);
  if (u[0]) {
    const textos = {
      aprovar: `Seu cadastro de parceiro "${p.display_name}" foi aprovado. Próximo passo: cadastrar suas experiências em /parceiro. A comissão do AquaTrip é de ${Number(p.commission_pct)}% por venda.`,
      recusar: `Seu cadastro de parceiro não foi aprovado. Motivo: ${MOTIVOS_RECUSA[motivo]}. Se quiser, responda este e-mail com mais informações.`,
      suspender: `Seu cadastro de parceiro "${p.display_name}" foi suspenso. Motivo: ${MOTIVOS_SUSPENSAO[motivo]}. Suas experiências saem da vitrine enquanto durar a suspensão; reservas já confirmadas continuam válidas.`,
      reativar: `Seu cadastro de parceiro "${p.display_name}" foi reativado.`,
      comissao: `A comissão do AquaTrip sobre as vendas de "${p.display_name}" passa a ser de ${Number(p.commission_pct)}%. Vale para as próximas vendas; as já feitas mantêm a comissão da época.`,
    };
    mailService.send({
      to: u[0].email,
      template: `parceiro_${acao}`,
      subject: `Cadastro de parceiro — AquaTrip`,
      text: `${u[0].name.split(" ")[0]}, ${textos[acao]}`,
    }).catch((err) => log.error({ err }, "falha ao avisar decisão de parceiro"));
  }
  return p;
}

module.exports = {
  PartnerError, MOTIVOS_RECUSA, MOTIVOS_SUSPENSAO, COMISSAO_PADRAO, UFS,
  meu, candidatar, listar, decidir,
};
