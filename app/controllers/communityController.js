/* ==============================================================
   AquaTrip — Comunidade, rede social, perfis e feedback
   ==============================================================
   Páginas (EJS) e API JSON. Entrada validada com Zod; posse e
   visibilidade conferidas nos serviços. Toda rota de escrita tem
   login + CSRF + limitador no router.
   ============================================================== */
const { z } = require("zod");
const communityService = require("../services/communityService");
const socialService = require("../services/socialService");
const feedbackService = require("../services/feedbackService");
const mediaService = require("../services/mediaService");
const { CHAVES: CATEGORIAS } = require("../lib/categorias");
const log = require("../lib/logger").forModule("comunidade");

const UUID = z.string().uuid();
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
const HORA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:MM).");

/** "150", "150,50", "1.500,00" ou número -> centavos. Vazio = gratuita. */
const PRECO = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const bruto = typeof v === "number" ? String(v) : String(v).replace(/\s|R\$/g, "");
  if (bruto === "") return 0;
  const n = Number(bruto.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100_000) {
    ctx.addIssue({ code: "custom", message: "Preço inválido (de R$ 0 a R$ 100.000)." });
    return z.NEVER;
  }
  return Math.round(n * 100);
});

const texto = (min, max, msgMin) => z.string().trim().min(min, msgMin).max(max, `Máximo de ${max} caracteres.`);

const experienciaSchema = z.object({
  title: texto(6, 80, "O título precisa ter pelo menos 6 caracteres."),
  description: texto(30, 2000, "Descreva a experiência com pelo menos 30 caracteres."),
  location: texto(3, 100, "Informe o destino."),
  category: z.enum([...CATEGORIAS], { message: "Escolha o tipo de experiência." }),
  date: DATA,
  time: HORA,
  capacity: z.coerce.number({ message: "Informe o número de vagas." }).int("Número de vagas inválido.")
    .min(1, "Pelo menos 1 vaga.").max(100, "No máximo 100 vagas."),
  preco: PRECO.optional().default(0),
  tripInfo: z.string().trim().max(2000, "Máximo de 2000 caracteres.").optional().default(""),
});
const edicaoSchema = experienciaSchema.partial().refine(
  (d) => (d.date === undefined) === (d.time === undefined),
  { message: "Informe data e horário juntos.", path: ["date"] }
);

function erroValidacao(res, parsed) {
  const i = parsed.error.issues?.[0];
  return res.status(422).json({
    error: i?.message || "Dados inválidos.",
    campo: i?.path?.join(".") || null,
    campos: parsed.error.issues.map((x) => ({ campo: x.path.join("."), mensagem: x.message })),
  });
}

/** Erros conhecidos dos serviços viram JSON com o status certo. */
function tratar(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      const conhecido = err instanceof communityService.CommunityError || err instanceof socialService.SocialError
        || err instanceof feedbackService.FeedbackError || err instanceof mediaService.MediaError;
      if (conhecido) {
        return res.status(err.status || 400).json({ error: err.message, codigo: err.code, campo: err.campo || null });
      }
      (req.log || log).error({ err }, "erro na API da comunidade");
      next(err);
    }
  };
}

function idValido(valor, res) {
  if (!UUID.safeParse(valor).success) {
    res.status(400).json({ error: "Identificador inválido." });
    return false;
  }
  return true;
}

const viewer = (req) => (req.session.user ? req.session.user.id : null);

function paraServico(d) {
  const out = {};
  if (d.title !== undefined) out.title = d.title;
  if (d.description !== undefined) out.description = d.description;
  if (d.location !== undefined) out.location = d.location;
  if (d.category !== undefined) out.category = d.category;
  if (d.date !== undefined) { out.date = d.date; out.time = d.time; }
  if (d.capacity !== undefined) out.capacity = d.capacity;
  if (d.preco !== undefined) out.priceCents = d.preco;
  if (d.tripInfo !== undefined) out.tripInfo = d.tripInfo;
  return out;
}

/* ================= Páginas ================= */

async function paginaComunidade(req, res, next) {
  try {
    const ordem = ["recentes", "proximas", "populares"].includes(req.query.ordem) ? req.query.ordem : "recentes";
    const categoria = CATEGORIAS.includes(req.query.categoria) ? req.query.categoria : null;
    const busca = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
    const seguindo = req.query.filtro === "seguindo" && !!req.session.user;
    const experiencias = await communityService.feed({ viewerId: viewer(req), ordem, categoria, busca: busca || null, seguindo });
    res.locals.seo.titulo = res.locals.t("comunidade.seo_titulo");
    res.locals.seo.descricao = res.locals.t("comunidade.seo_desc");
    res.render("pages/comunidade", { experiencias, filtros: { ordem, categoria, busca, seguindo } });
  } catch (err) { next(err); }
}

async function paginaCriar(req, res, next) {
  try {
    let editar = null;
    if (typeof req.query.editar === "string") {
      if (!UUID.safeParse(req.query.editar).success) return res.redirect("/criar_experiencia");
      try {
        editar = await communityService.paraEditar(req.session.user.id, req.query.editar);
      } catch (err) {
        if (err instanceof communityService.CommunityError) return res.redirect("/meu-perfil");
        throw err;
      }
    }
    const db = require("../lib/db");
    const { rows } = await db.query(
      `SELECT status, (mp_connected_at IS NOT NULL) AS mp FROM partners WHERE user_id = ?`, [req.session.user.id]
    );
    const podeCobrar = !!(rows[0] && rows[0].status === "APPROVED" && Number(rows[0].mp));
    res.render("pages/criar_experiencia", { editar, podeCobrar, maxFotos: communityService.MAX_FOTOS });
  } catch (err) { next(err); }
}

async function paginaMeuPerfil(req, res, next) {
  try {
    const [perfil, minhas] = await Promise.all([
      socialService.meuPerfil(req.session.user.id),
      communityService.minhas(req.session.user.id),
    ]);
    res.render("pages/meu_perfil", { perfil, minhas, aba: ["experiencias", "comentarios"].includes(req.query.aba) ? req.query.aba : "experiencias" });
  } catch (err) { next(err); }
}

async function paginaPerfilPublico(req, res, next) {
  try {
    if (!UUID.safeParse(req.params.id).success) return next();
    if (req.session.user && req.session.user.id === req.params.id) return res.redirect("/meu-perfil");
    let perfil;
    try {
      perfil = await socialService.perfilPublico(req.params.id, viewer(req));
    } catch (err) {
      if (err instanceof socialService.SocialError) return next();
      throw err;
    }
    if (perfil.exemplo) res.set("X-Robots-Tag", "noindex, nofollow");
    res.locals.seo.titulo = `${perfil.nome} | AquaTrip`;
    res.locals.seo.descricao = perfil.bio || res.locals.t("perfil_social.seo_desc", { nome: perfil.nome });
    res.render("pages/perfil_publico", { perfil });
  } catch (err) { next(err); }
}

async function paginaFeedback(req, res, next) {
  try {
    const meus = await feedbackService.meus(req.session.user.id);
    res.render("pages/feedback", { meus, enviado: req.query.enviado === "1" });
  } catch (err) { next(err); }
}

/* ================= API: experiências da comunidade ================= */

const criar = tratar(async (req, res) => {
  const parsed = experienciaSchema.safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);
  const r = await communityService.criar({ userId: req.session.user.id, dados: paraServico(parsed.data), req });
  res.status(201).json(r);
});

const editar = tratar(async (req, res) => {
  if (!idValido(req.params.id, res)) return;
  const parsed = edicaoSchema.safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);
  res.json(await communityService.editar({ userId: req.session.user.id, serviceId: req.params.id, dados: paraServico(parsed.data), req }));
});

const detalheParaEditar = tratar(async (req, res) => {
  if (!idValido(req.params.id, res)) return;
  res.json(await communityService.paraEditar(req.session.user.id, req.params.id));
});

const publicada = tratar(async (req, res) => {
  if (!idValido(req.params.id, res)) return;
  const parsed = z.object({ publicada: z.boolean() }).safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);
  res.json(await communityService.definirPublicada({ userId: req.session.user.id, serviceId: req.params.id, publicada: parsed.data.publicada, req }));
});

const enviarFoto = tratar(async (req, res) => {
  if (!idValido(req.params.id, res)) return;
  if (!req.file) return res.status(400).json({ error: "Envie uma imagem no campo 'imagem'." });
  res.status(201).json(await communityService.adicionarFoto({ userId: req.session.user.id, serviceId: req.params.id, buffer: req.file.buffer, req }));
});

const removerFoto = tratar(async (req, res) => {
  if (!idValido(req.params.id, res) || !idValido(req.params.mediaId, res)) return;
  await communityService.removerFoto({ userId: req.session.user.id, serviceId: req.params.id, mediaId: req.params.mediaId });
  res.status(204).end();
});

const pessoas = tratar(async (req, res) => {
  if (!idValido(req.params.id, res)) return;
  res.json(await communityService.pessoas(req.session.user.id, req.params.id));
});

const minhas = tratar(async (req, res) => {
  res.json({ experiencias: await communityService.minhas(req.session.user.id) });
});

const feed = tratar(async (req, res) => {
  res.json({
    experiencias: await communityService.feed({
      viewerId: viewer(req),
      ordem: req.query.ordem,
      categoria: CATEGORIAS.includes(req.query.categoria) ? req.query.categoria : null,
      busca: typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) || null : null,
      seguindo: req.query.filtro === "seguindo",
      pagina: Number(req.query.pagina) || 1,
    }),
  });
});

/* ================= API: social ================= */

const curtir = tratar(async (req, res) => {
  if (!idValido(req.params.id, res)) return;
  const parsed = z.object({ curtir: z.boolean() }).safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);
  res.json(await socialService.curtir({ userId: req.session.user.id, serviceId: req.params.id, curtir: parsed.data.curtir }));
});

const interesse = tratar(async (req, res) => {
  if (!idValido(req.params.id, res)) return;
  const parsed = z.object({ quer: z.boolean() }).safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);
  res.json(await socialService.interesse({ userId: req.session.user.id, serviceId: req.params.id, quer: parsed.data.quer }));
});

const listarComentarios = tratar(async (req, res) => {
  if (!idValido(req.params.id, res)) return;
  res.json({ comentarios: await socialService.comentarios(req.params.id, viewer(req)) });
});

const comentar = tratar(async (req, res) => {
  if (!idValido(req.params.id, res)) return;
  const parsed = z.object({ texto: z.string().max(2000) }).safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);
  res.status(201).json({ comentario: await socialService.comentar({ userId: req.session.user.id, serviceId: req.params.id, texto: parsed.data.texto }) });
});

const apagarComentario = tratar(async (req, res) => {
  if (!idValido(req.params.id, res)) return;
  await socialService.apagarComentario({ userId: req.session.user.id, commentId: req.params.id });
  res.status(204).end();
});

const denunciar = tratar(async (req, res) => {
  if (!idValido(req.params.id, res)) return;
  const parsed = z.object({
    motivo: z.enum(Object.keys(socialService.MOTIVOS_DENUNCIA), { message: "Escolha um motivo da lista." }),
    detalhes: z.string().trim().max(500).optional(),
  }).safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);
  res.json(await socialService.denunciar({ userId: req.session.user.id, serviceId: req.params.id, ...parsed.data, req }));
});

const seguir = tratar(async (req, res) => {
  if (!idValido(req.params.id, res)) return;
  const parsed = z.object({ seguir: z.boolean() }).safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);
  res.json(await socialService.seguir({ userId: req.session.user.id, alvoId: req.params.id, quer: parsed.data.seguir }));
});

const conexoes = (tipo) => tratar(async (req, res) => {
  if (!idValido(req.params.id, res)) return;
  res.json({ usuarios: await socialService.listaDeConexoes(req.params.id, tipo) });
});

const salvarBio = tratar(async (req, res) => {
  const parsed = z.object({ bio: z.string().max(400) }).safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);
  res.json(await socialService.salvarBio({ userId: req.session.user.id, bio: parsed.data.bio }));
});

const enviarAvatar = tratar(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Envie uma imagem no campo 'imagem'." });
  res.status(201).json(await socialService.trocarAvatar({ userId: req.session.user.id, buffer: req.file.buffer, req }));
});

const removerAvatar = tratar(async (req, res) => {
  await socialService.removerAvatar({ userId: req.session.user.id });
  res.status(204).end();
});

/* ================= API: feedback ================= */

const feedbackSchema = z.object({
  kind: z.enum(["COMPLAINT", "RATING", "SUGGESTION"], { message: "Escolha o tipo." }),
  rating: z.coerce.number().int().min(1, "Escolha uma nota de 1 a 5.").max(5).optional().nullable(),
  subject: texto(4, 120, "O assunto precisa ter pelo menos 4 caracteres."),
  message: texto(10, 2000, "Conte com um pouco mais de detalhe (mínimo 10 caracteres)."),
}).refine((d) => d.kind !== "RATING" || d.rating, { message: "Escolha uma nota de 1 a 5.", path: ["rating"] });

const enviarFeedback = tratar(async (req, res) => {
  const parsed = feedbackSchema.safeParse(req.body || {});
  if (!parsed.success) return erroValidacao(res, parsed);
  res.status(201).json(await feedbackService.criar({ userId: req.session.user.id, dados: parsed.data, req }));
});

module.exports = {
  paginaComunidade, paginaCriar, paginaMeuPerfil, paginaPerfilPublico, paginaFeedback,
  criar, editar, detalheParaEditar, publicada, enviarFoto, removerFoto, pessoas, minhas, feed,
  curtir, interesse, listarComentarios, comentar, apagarComentario, denunciar,
  seguir, seguidores: conexoes("seguidores"), seguindo: conexoes("seguindo"),
  salvarBio, enviarAvatar, removerAvatar, enviarFeedback,
};
