/* ==============================================================
   AquaTrip — Atendimento: contato público e caixa do admin
   ============================================================== */
const { z } = require("zod");
const supportService = require("../services/supportService");
const log = require("../lib/logger").forModule("atendimento");

const contatoSchema = z.object({
  nome: z.string().trim().min(2, "Informe seu nome.").max(120),
  email: z.string().trim().email("E-mail inválido.").max(255),
  empresa: z.string().trim().max(160).optional().default(""),
  regiao: z.string().trim().max(120).optional().default(""),
  descricao: z.string().trim().min(10, "Conte um pouco mais (mínimo de 10 caracteres).").max(1000),
  // Honeypot: campo invisível para pessoas. Robô preenche tudo.
  site: z.string().optional().default(""),
});

/** Formulário de contato. Responde no formato que contato.js já espera. */
async function receberContato(req, res, next) {
  const tm = req.tm || ((m) => m);
  const parsed = contatoSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const erros = {};
    parsed.error.issues.forEach((i) => { erros[i.path[0]] = erros[i.path[0]] || tm(i.message); });
    return res.status(422).json({ sucesso: false, mensagem: tm("Revise os campos destacados."), erros });
  }

  const d = parsed.data;
  if (d.site) {
    // Robô: responde sucesso (para não ensinar a contornar) e descarta.
    (req.log || log).warn("contato descartado pelo honeypot");
    return res.json({ sucesso: true, mensagem: tm("Mensagem enviada! Retornaremos em breve.") });
  }

  try {
    await supportService.receiveContact({
      dados: {
        name: d.nome,
        email: d.email.toLowerCase(),
        company: d.empresa || null,
        region: d.regiao || null,
        message: d.descricao,
      },
      req,
    });
    res.json({
      sucesso: true,
      mensagem: tm("Mensagem enviada! Nossa equipe responde pelo e-mail informado em até 2 dias úteis."),
    });
  } catch (err) {
    next(err);
  }
}

/* ---------- Painel ---------- */

function tratar(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof supportService.SupportError) {
        return res.status(err.status).json({ error: err.message, codigo: err.code });
      }
      next(err);
    }
  };
}

const UUID = z.string().uuid();

const caixa = tratar(async (req, res) => {
  const [contatos, solicitacoes, contadores] = await Promise.all([
    supportService.listMessages(),
    supportService.listRequests(),
    supportService.counters(),
  ]);
  res.json({ contatos, solicitacoes, contadores, prazoDias: supportService.PRAZO_LGPD_DIAS });
});

const statusContato = tratar(async (req, res) => {
  if (!UUID.safeParse(req.params.id).success) return res.status(400).json({ error: "Identificador inválido." });
  const status = ["NEW", "READ", "ARCHIVED"].includes(req.body?.status) ? req.body.status : null;
  if (!status) return res.status(422).json({ error: "Situação inválida." });
  const r = await supportService.setMessageStatus(req.params.id, status);
  if (!r) return res.status(404).json({ error: "Mensagem não encontrada." });
  res.json({ contato: r });
});

const respostaSchema = z.object({
  status: z.enum(["IN_PROGRESS", "DONE", "REJECTED"]),
  resposta: z.string().trim().max(4000).optional().nullable(),
  anonimizar: z.boolean().optional().default(false),
});

const responderSolicitacao = tratar(async (req, res) => {
  if (!UUID.safeParse(req.params.id).success) return res.status(400).json({ error: "Identificador inválido." });
  const parsed = respostaSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(422).json({ error: parsed.error.issues[0].message });

  const r = await supportService.answerRequest({
    adminId: req.session.user.id,
    requestId: req.params.id,
    status: parsed.data.status,
    resposta: parsed.data.resposta || null,
    anonimizar: parsed.data.anonimizar,
    req,
  });
  res.json({ solicitacao: r });
});

module.exports = { receberContato, caixa, statusContato, responderSolicitacao };
