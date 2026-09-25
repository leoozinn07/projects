/* ==============================================================
   AquaTrip — Conta: ingressos e diário de viagens
   ============================================================== */
const crypto = require("crypto");
const { z } = require("zod");
const accountRepository = require("../repositories/accountRepository");
const log = require("../lib/logger").forModule("conta");
const { rotulo } = require("../lib/categorias");
const fmt = require("../lib/datas");

const TIPOS = {
  aquario: "aquario", mergulho: "expedicao", caiaque: "expedicao",
  pesca: "expedicao", expedicao: "expedicao", praia: "expedicao",
};

/**
 * Código exibido no ingresso. Derivado do id da reserva com HMAC:
 * é estável (o mesmo ingresso sempre mostra o mesmo código), curto
 * o bastante para ser lido em voz alta no local, e não permite
 * chegar ao id da reserva a partir do código.
 */
const { codigoIngresso } = require("../lib/ingresso");

function formatarIngresso(b) {
  const inicio = new Date(b.starts_at);
  const passou = inicio < new Date();
  let status;
  if (b.status === "REFUNDED") status = "estornado";
  else status = passou ? "used" : "valido";

  return {
    id: b.id,
    type: TIPOS[b.category] || "expedicao",
    category: b.category,
    tag: rotulo(b.category),
    title: b.title,
    sub: `${b.quantity} ${b.quantity > 1 ? "pessoas" : "pessoa"}`,
    date: fmt.dataCurta(inicio),
    time: fmt.hora(inicio),
    place: b.location || "",
    code: codigoIngresso(b.id),
    status,
  };
}

async function ingressos(req, res, next) {
  try {
    const lista = await accountRepository.listTickets(req.session.user.id);
    res.json({ ingressos: lista.map(formatarIngresso) });
  } catch (err) {
    next(err);
  }
}

/* ---------- Diário ---------- */

const dataISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
  .optional()
  .nullable()
  .or(z.literal("").transform(() => null));

const viagemSchema = z
  .object({
    place: z.string().trim().min(2, "Informe o lugar.").max(160),
    region: z.string().trim().max(120).optional().nullable(),
    startsOn: dataISO,
    endsOn: dataISO,
    rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(30)).max(8).optional().default([]),
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, {
    message: "A volta não pode ser antes da ida.",
    path: ["endsOn"],
  });

const UUID = z.string().uuid();

function normalizar(d) {
  return {
    place: d.place,
    region: d.region || null,
    startsOn: d.startsOn || null,
    endsOn: d.endsOn || null,
    rating: d.rating || null,
    notes: d.notes || null,
    tags: d.tags || [],
  };
}

async function listarViagens(req, res, next) {
  try {
    res.json({ viagens: await accountRepository.listTrips(req.session.user.id) });
  } catch (err) {
    next(err);
  }
}

async function criarViagem(req, res, next) {
  const parsed = viagemSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({ error: parsed.error.issues[0].message });
  }
  try {
    const v = await accountRepository.createTrip(req.session.user.id, normalizar(parsed.data));
    res.status(201).json({ viagem: v });
  } catch (err) {
    next(err);
  }
}

async function atualizarViagem(req, res, next) {
  if (!UUID.safeParse(req.params.id).success) {
    return res.status(404).json({ error: "Viagem não encontrada." });
  }
  const parsed = viagemSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(422).json({ error: parsed.error.issues[0].message });
  }
  try {
    const v = await accountRepository.updateTrip(
      req.session.user.id,
      req.params.id,
      normalizar(parsed.data)
    );
    // 404 tanto para "não existe" quanto para "é de outra pessoa":
    // responder 403 confirmaria que o id existe.
    if (!v) return res.status(404).json({ error: "Viagem não encontrada." });
    res.json({ viagem: v });
  } catch (err) {
    next(err);
  }
}

async function excluirViagem(req, res, next) {
  if (!UUID.safeParse(req.params.id).success) {
    return res.status(404).json({ error: "Viagem não encontrada." });
  }
  try {
    const ok = await accountRepository.deleteTrip(req.session.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: "Viagem não encontrada." });
    res.status(204).end();
  } catch (err) {
    (req.log || log).error({ err }, "falha ao excluir viagem");
    next(err);
  }
}

module.exports = {
  codigoIngresso,
  ingressos,
  listarViagens,
  criarViagem,
  atualizarViagem,
  excluirViagem,
};
