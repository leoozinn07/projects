/* ==============================================================
   AquaTrip — Admin API
   ==============================================================
   JSON consumido pelo painel /admin (que absorveu o antigo /gestao). Uma API só para
   os dois: antes, cada painel tinha seus próprios dados inventados.

   Toda entrada é validada com Zod. Preço entra em REAIS na tela e
   é convertido para centavos aqui — o banco nunca vê float.
   ============================================================== */
const { z } = require("zod");
const adminService = require("../services/adminService");
const log = require("../lib/logger").forModule("admin");

const { CHAVES: CATEGORIAS } = require("../lib/categorias");

const servicoSchema = z.object({
  title: z.string().trim().min(3, "Título muito curto.").max(200),
  location: z.string().trim().min(2, "Informe o local.").max(200),
  category: z.enum([...CATEGORIAS], { message: "Categoria inválida." }),
  // Aceita "1.890,50", "1890.5" ou número. Converte para centavos.
  preco: z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = typeof v === "number"
      ? v
      : Number(String(v).replace(/\s|R\$/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
      ctx.addIssue({ code: "custom", message: "Preço inválido." });
      return z.NEVER;
    }
    return Math.round(n * 100);
  }),
  description: z.string().trim().max(2000).optional().nullable(),
});

const suspensaoSchema = z.object({
  dias: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  motivo: z.string().trim().max(300).optional().nullable(),
});

const statusServicoSchema = z.object({ ativa: z.boolean() });

const UUID = z.string().uuid();

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
const HORA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:MM).");

const programacaoSchema = z
  .object({
    dataInicio: DATA,
    dataFim: DATA,
    diasSemana: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Escolha ao menos um dia da semana."),
    horarios: z.array(HORA).min(1, "Informe ao menos um horário.").max(12),
    capacidade: z.coerce.number().int().min(1, "Capacidade mínima: 1.").max(500),
  })
  .refine((p) => p.dataFim >= p.dataInicio, { message: "O fim não pode ser antes do início.", path: ["dataFim"] })
  .refine((p) => {
    const dias = (Date.parse(p.dataFim) - Date.parse(p.dataInicio)) / 86400000;
    return dias <= 366;
  }, { message: "Período máximo de um ano por vez.", path: ["dataFim"] });

const capacidadeSchema = z.object({
  capacidade: z.coerce.number().int().min(1, "Capacidade mínima: 1.").max(500),
});

/* ---------- utilitários ---------- */

function erroValidacao(res, parsed) {
  return res.status(422).json({
    error: parsed.error.issues?.[0]?.message || "Dados inválidos.",
    campos: parsed.error.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message })),
  });
}

/** Erros conhecidos viram resposta clara; o resto sobe para o handler global. */
function tratar(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      if (err instanceof adminService.AdminError) {
        return res.status(err.status).json({ error: err.message, codigo: err.code });
      }
      (req.log || log).error({ err }, "erro na API administrativa");
      next(err);
    }
  };
}

function idValido(req, res) {
  if (!UUID.safeParse(req.params.id).success) {
    res.status(400).json({ error: "Identificador inválido." });
    return false;
  }
  return true;
}

/* ---------- endpoints ---------- */

const painel = tratar(async (req, res) => {
  res.json(await adminService.dashboard());
});

const usuarios = tratar(async (req, res) => {
  const busca = typeof req.query.busca === "string" ? req.query.busca.slice(0, 120) : null;
  const status = ["ACTIVE", "SUSPENDED"].includes(req.query.status) ? req.query.status : null;
  res.json({ usuarios: await adminService.listUsers({ busca, status }) });
});

const suspender = tratar(async (req, res) => {
  if (!idValido(req, res)) return;
  const parsed = suspensaoSchema.safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);

  const usuario = await adminService.suspendUser({
    adminId: req.session.user.id,
    userId: req.params.id,
    dias: parsed.data.dias || null,
    motivo: parsed.data.motivo || null,
    req,
  });
  res.json({ usuario });
});

const reativar = tratar(async (req, res) => {
  if (!idValido(req, res)) return;
  const usuario = await adminService.reactivateUser({
    adminId: req.session.user.id,
    userId: req.params.id,
    req,
  });
  res.json({ usuario });
});

const experiencias = tratar(async (req, res) => {
  res.json({ experiencias: await adminService.listServices() });
});

const criarExperiencia = tratar(async (req, res) => {
  const parsed = servicoSchema.safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);

  const { preco, ...resto } = parsed.data;
  const criada = await adminService.createService({
    adminId: req.session.user.id,
    dados: { ...resto, priceCents: preco, description: resto.description || null },
    req,
  });
  res.status(201).json({ experiencia: criada });
});

const atualizarExperiencia = tratar(async (req, res) => {
  if (!idValido(req, res)) return;
  const parsed = servicoSchema.safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);

  const { preco, ...resto } = parsed.data;
  const atualizada = await adminService.updateService({
    adminId: req.session.user.id,
    id: req.params.id,
    dados: { ...resto, priceCents: preco, description: resto.description || null },
    req,
  });
  res.json({ experiencia: atualizada });
});

const statusExperiencia = tratar(async (req, res) => {
  if (!idValido(req, res)) return;
  const parsed = statusServicoSchema.safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);

  const r = await adminService.setServiceActive({
    adminId: req.session.user.id,
    id: req.params.id,
    active: parsed.data.ativa,
    req,
  });
  res.json({ experiencia: r });
});

const horarios = tratar(async (req, res) => {
  if (!idValido(req, res)) return;
  res.json({ horarios: await adminService.listSlots(req.params.id) });
});

const criarHorarios = tratar(async (req, res) => {
  if (!idValido(req, res)) return;
  const parsed = programacaoSchema.safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);
  const resultado = await adminService.createSlots({
    adminId: req.session.user.id,
    serviceId: req.params.id,
    programacao: { ...parsed.data, horarios: [...new Set(parsed.data.horarios)] },
    req,
  });
  res.status(201).json(resultado);
});

const capacidadeHorario = tratar(async (req, res) => {
  if (!idValido(req, res)) return;
  const parsed = capacidadeSchema.safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);
  const horario = await adminService.updateSlotCapacity({
    adminId: req.session.user.id,
    slotId: req.params.id,
    capacidade: parsed.data.capacidade,
    req,
  });
  res.json({ horario });
});

const removerHorario = tratar(async (req, res) => {
  if (!idValido(req, res)) return;
  await adminService.deleteSlot({ adminId: req.session.user.id, slotId: req.params.id, req });
  res.status(204).end();
});

const transacoes = tratar(async (req, res) => {
  const permitidos = ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "REFUNDED", "EXPIRED"];
  const status = permitidos.includes(req.query.status) ? req.query.status : null;
  const dias = [7, 30, 90].includes(Number(req.query.dias)) ? Number(req.query.dias) : null;
  res.json({
    transacoes: await adminService.listTransactions({ status, dias }),
    taxaPlataformaPercent: adminService.PLATFORM_FEE_PERCENT,
  });
});

module.exports = {
  CATEGORIAS,
  painel,
  usuarios,
  suspender,
  reativar,
  experiencias,
  criarExperiencia,
  atualizarExperiencia,
  statusExperiencia,
  transacoes,
  horarios,
  criarHorarios,
  capacidadeHorario,
  removerHorario,
};
