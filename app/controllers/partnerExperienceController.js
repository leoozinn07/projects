/* ==============================================================
   AquaTrip — API de experiências do parceiro + revisão do admin
   ============================================================== */
const { z } = require("zod");
const svc = require("../services/partnerExperienceService");
const mediaService = require("../services/mediaService");

const UUID = z.string().uuid();
const base = {
  titulo: z.string().trim().min(5, "Título: mínimo de 5 caracteres.").max(120),
  local: z.string().trim().min(3, "Informe o local (cidade, UF).").max(120),
  categoria: z.string().trim(),
  preco: z.coerce.number().min(1, "Preço mínimo: R$ 1,00.").max(100000, "Preço acima do permitido."),
  descricao: z.string().trim().max(2000, "Descrição: até 2.000 caracteres.").optional().nullable(),
};
const criarSchema = z.object(base);
const editarSchema = z.object(base).partial();
const programacaoSchema = z.object({
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  diasSemana: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Escolha ao menos um dia."),
  horarios: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (HH:MM).")).min(1).max(12),
  capacidade: z.coerce.number().int().min(1).max(500),
}).refine((p) => p.dataFim >= p.dataInicio, { message: "O fim não pode ser antes do início." });

/** Nomes da API (pt) -> colunas (en); centavos calculados no servidor. */
function paraColunas(d) {
  const r = {};
  if (d.titulo !== undefined) r.title = d.titulo;
  if (d.local !== undefined) r.location = d.local;
  if (d.categoria !== undefined) r.category = d.categoria;
  if (d.descricao !== undefined) r.description = d.descricao;
  if (d.preco !== undefined) r.priceCents = Math.round(d.preco * 100);
  return r;
}

function tratar(fn) {
  return async (req, res, next) => {
    try { await fn(req, res); }
    catch (err) {
      if (err instanceof svc.ExperienceError || err instanceof mediaService.MediaError) {
        return res.status(err.status).json({ error: err.message, codigo: err.code, campo: err.campo || null });
      }
      next(err);
    }
  };
}
function invalido(res, parsed) {
  const i = parsed.error.issues[0];
  return res.status(422).json({ error: i.message, campo: i.path[0] || null });
}
const id = (req, res, campo = "id") => {
  if (UUID.safeParse(req.params[campo]).success) return true;
  res.status(404).json({ error: "Não encontrado." });
  return false;
};

const listar = tratar(async (req, res) => res.json(await svc.listarMinhas(req.session.user.id)));

const criar = tratar(async (req, res) => {
  const p = criarSchema.safeParse(req.body || {});
  if (!p.success) return invalido(res, p);
  res.status(201).json({ experiencia: await svc.criar({ userId: req.session.user.id, dados: paraColunas(p.data), req }) });
});

const editar = tratar(async (req, res) => {
  if (!id(req, res)) return;
  const p = editarSchema.safeParse(req.body || {});
  if (!p.success) return invalido(res, p);
  res.json({ experiencia: await svc.editar({ userId: req.session.user.id, serviceId: req.params.id, dados: paraColunas(p.data), req }) });
});

const enviar = tratar(async (req, res) => {
  if (!id(req, res)) return;
  res.json({ experiencia: await svc.enviarParaRevisao({ userId: req.session.user.id, serviceId: req.params.id, req }) });
});

const ativa = tratar(async (req, res) => {
  if (!id(req, res)) return;
  await svc.definirAtiva({ userId: req.session.user.id, serviceId: req.params.id, ativa: req.body?.ativa === true, req });
  res.status(204).end();
});

const horarios = tratar(async (req, res) => {
  if (!id(req, res)) return;
  res.json({ horarios: await svc.horarios({ userId: req.session.user.id, serviceId: req.params.id }) });
});

const criarHorarios = tratar(async (req, res) => {
  if (!id(req, res)) return;
  const p = programacaoSchema.safeParse(req.body || {});
  if (!p.success) return invalido(res, p);
  res.status(201).json(await svc.criarHorarios({
    userId: req.session.user.id, serviceId: req.params.id,
    programacao: { ...p.data, horarios: [...new Set(p.data.horarios)] }, req,
  }));
});

const capacidade = tratar(async (req, res) => {
  if (!id(req, res)) return;
  const c = z.coerce.number().int().min(1).max(500).safeParse(req.body?.capacidade);
  if (!c.success) return res.status(422).json({ error: "Capacidade inválida." });
  res.json({ horario: await svc.capacidadeHorario({ userId: req.session.user.id, slotId: req.params.id, capacidade: c.data }) });
});

const removerHorario = tratar(async (req, res) => {
  if (!id(req, res)) return;
  await svc.removerHorario({ userId: req.session.user.id, slotId: req.params.id });
  res.status(204).end();
});

const capa = tratar(async (req, res) => {
  if (!id(req, res)) return;
  const alt = String(req.body?.alt || "").trim().slice(0, 200);
  if (alt.length < 5) return res.status(422).json({ error: "Descreva a foto (mínimo 5 caracteres).", campo: "alt" });
  const r = await svc.enviarCapa({ userId: req.session.user.id, serviceId: req.params.id, buffer: req.file?.buffer, alt, req });
  res.status(201).json({ capa: r, mensagem: "Foto recebida. Ela substitui a capa depois de revisada; a atual continua no ar." });
});

/* ---------- Admin ---------- */

const fila = tratar(async (req, res) => res.json({ experiencias: await svc.filaRevisao(), motivos: svc.MOTIVOS_REVISAO }));

const decidir = tratar(async (req, res) => {
  if (!id(req, res)) return;
  res.json({ experiencia: await svc.decidirRevisao({
    adminId: req.session.user.id, serviceId: req.params.id,
    aprovar: req.body?.aprovar === true, motivo: req.body?.motivo || null, req,
  }) });
});

module.exports = { listar, criar, editar, enviar, ativa, horarios, criarHorarios, capacidade, removerHorario, capa, fila, decidir };
