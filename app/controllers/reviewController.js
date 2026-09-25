/* ==============================================================
   AquaTrip — Avaliações
   ============================================================== */
const { z } = require("zod");
const reviewService = require("../services/reviewService");

const UUID = z.string().uuid();
const avaliacaoSchema = z.object({
  bookingId: z.string().uuid("Reserva inválida."),
  nota: z.coerce.number().int().min(1, "Escolha de 1 a 5 estrelas.").max(5, "Escolha de 1 a 5 estrelas."),
  titulo: z.string().trim().max(80, "Título: até 80 caracteres.").optional().nullable(),
  texto: z.string().trim().max(800, "Texto: até 800 caracteres.").optional().nullable(),
});

function tratar(fn) {
  return async (req, res, next) => {
    try { await fn(req, res); }
    catch (err) {
      if (err instanceof reviewService.ReviewError) {
        if (req.accepts(["json", "html"]) === "html" && !req.path.startsWith("/api/")) {
          return res.status(err.status).render("pages/erro", {
            statusCode: err.status, title: "Não é possível avaliar", message: err.message, stack: null,
          });
        }
        return res.status(err.status).json({ error: err.message, codigo: err.code });
      }
      next(err);
    }
  };
}

/** /avaliacao/:bookingId — formulário para uma reserva específica. */
const pagina = tratar(async (req, res) => {
  if (!UUID.safeParse(req.params.bookingId).success) {
    return res.status(404).render("pages/erro", { statusCode: 404, title: "Reserva não encontrada", message: "Link inválido.", stack: null });
  }
  const b = await reviewService.elegibilidade(req.session.user.id, req.params.bookingId);
  res.render("pages/avaliacao", { reserva: b });
});

/** /avaliacao — sem reserva: lista o que dá para avaliar. */
const escolher = tratar(async (req, res) => {
  const lista = await reviewService.pendentes(req.session.user.id);
  if (lista.length === 1) return res.redirect(`/avaliacao/${lista[0].booking_id}`);
  res.render("pages/avaliacao_escolher", { lista });
});

const criar = tratar(async (req, res) => {
  const parsed = avaliacaoSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(422).json({ error: parsed.error.issues[0].message });
  const r = await reviewService.criar({
    userId: req.session.user.id,
    bookingId: parsed.data.bookingId,
    rating: parsed.data.nota,
    title: parsed.data.titulo,
    body: parsed.data.texto,
    req,
  });
  res.status(201).json({ avaliacao: r, redirecionar: `/reservar/${r.slug}#avaliacoes` });
});

const excluir = tratar(async (req, res) => {
  if (!UUID.safeParse(req.params.id).success) return res.status(404).json({ error: "Avaliação não encontrada." });
  await reviewService.excluirPropria({ userId: req.session.user.id, reviewId: req.params.id, req });
  res.status(204).end();
});

const moderacaoLista = tratar(async (req, res) => {
  res.json({ avaliacoes: await reviewService.recentesParaModeracao() });
});

const moderar = tratar(async (req, res) => {
  if (!UUID.safeParse(req.params.id).success) return res.status(400).json({ error: "Identificador inválido." });
  const r = await reviewService.moderar({
    adminId: req.session.user.id,
    reviewId: req.params.id,
    ocultar: req.body?.ocultar === true,
    motivo: typeof req.body?.motivo === "string" ? req.body.motivo : null,
    req,
  });
  res.json({ avaliacao: r });
});

const mediaService = require("../services/mediaService");

const enviarFoto = tratar(async (req, res) => {
  if (!UUID.safeParse(req.params.id).success) return res.status(404).json({ error: "Avaliação não encontrada." });
  try {
    const foto = await reviewService.adicionarFoto({
      userId: req.session.user.id, reviewId: req.params.id, buffer: req.file?.buffer, req,
    });
    res.status(201).json({
      foto,
      mensagem: "Foto recebida. Ela aparece na avaliação depois de revisada pela equipe.",
    });
  } catch (err) {
    if (err instanceof mediaService.MediaError) return res.status(err.status).json({ error: err.message, codigo: err.code });
    throw err;
  }
});

const minhasFotos = tratar(async (req, res) => {
  if (!UUID.safeParse(req.params.id).success) return res.status(404).json({ error: "Avaliação não encontrada." });
  res.json({ fotos: await reviewService.fotosDoAutor(req.session.user.id, req.params.id) });
});

const filaFotos = tratar(async (req, res) => {
  const fila = await mediaService.pendentes();
  res.json({ fotos: fila.map((f) => ({ ...f, url: `/media/${f.storage_key}` })), motivos: mediaService.MOTIVOS_RECUSA });
});

const moderarFoto = tratar(async (req, res) => {
  if (!UUID.safeParse(req.params.id).success) return res.status(400).json({ error: "Identificador inválido." });
  try {
    const r = await reviewService.moderarFoto({
      adminId: req.session.user.id,
      mediaId: req.params.id,
      aprovar: req.body?.aprovar === true,
      motivo: typeof req.body?.motivo === "string" ? req.body.motivo : null,
      req,
    });
    res.json({ foto: { id: r.id, status: r.status } });
  } catch (err) {
    if (err instanceof mediaService.MediaError) return res.status(err.status).json({ error: err.message, codigo: err.code });
    throw err;
  }
});

module.exports = { pagina, escolher, criar, excluir, moderacaoLista, moderar, enviarFoto, minhasFotos, filaFotos, moderarFoto };
