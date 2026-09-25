/* ==============================================================
   AquaTrip — Upload e entrega de imagens
   ============================================================== */
const multer = require("multer");
const { z } = require("zod");
const db = require("../lib/db");
const mediaService = require("../services/mediaService");
const auditService = require("../services/auditService");
const { AuditAction } = auditService;

/* Memória, não disco: o arquivo só chega ao disco DEPOIS de validado
   e reprocessado. limits corta o recebimento no meio se passar. */
const receber = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: mediaService.MAX_BYTES, files: 1, fields: 5, parts: 7, fieldSize: 1024 },
}).single("imagem");

/** Envolve o multer para devolver erro legível em JSON. */
function receberImagem(req, res, next) {
  receber(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === "LIMIT_FILE_SIZE"
      ? `Arquivo grande demais (máximo ${Math.round(mediaService.MAX_BYTES / 1024 / 1024)} MB).`
      : "Envio inválido. Mande uma única imagem no campo 'imagem'.";
    res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: msg, codigo: err.code });
  });
}

const UUID = z.string().uuid();

async function enviarCapa(req, res, next) {
  if (!UUID.safeParse(req.params.id).success) return res.status(400).json({ error: "Identificador inválido." });
  const alt = String(req.body?.alt || "").trim().slice(0, 200);
  if (alt.length < 5) {
    // Texto alternativo obrigatório: é o que o leitor de tela lê (WCAG 1.1.1).
    return res.status(422).json({ error: "Descreva a imagem em poucas palavras (mínimo 5 caracteres).", campo: "alt" });
  }
  try {
    const { rows } = await db.query(`SELECT id, cover_media_id FROM services WHERE id = ?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Experiência não encontrada." });

    const nova = await mediaService.salvarImagem({ buffer: req.file?.buffer, usuarioId: req.session.user.id });
    await db.query(`UPDATE services SET cover_media_id = ?, cover_alt = ? WHERE id = ?`, [nova.id, alt, req.params.id]);
    if (rows[0].cover_media_id) await mediaService.apagar(rows[0].cover_media_id); // não acumula órfãs

    await auditService.log(AuditAction.ADMIN_SERVICE_UPDATED, {
      req, userId: req.session.user.id,
      metadata: { servicoId: req.params.id, capa: nova.storage_key, bytes: nova.bytes },
    });
    res.status(201).json({ capa: { url: `/media/${nova.storage_key}`, alt, largura: nova.width, altura: nova.height } });
  } catch (err) {
    if (err instanceof mediaService.MediaError) return res.status(err.status).json({ error: err.message, codigo: err.code });
    next(err);
  }
}

async function removerCapa(req, res, next) {
  if (!UUID.safeParse(req.params.id).success) return res.status(400).json({ error: "Identificador inválido." });
  try {
    // MySQL não tem UPDATE...FROM...RETURNING: lê o cover_media_id antigo
    // antes de limpar, pra saber o que apagar depois.
    const { rows } = await db.query(`SELECT cover_media_id FROM services WHERE id = ?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Experiência não encontrada." });
    const antigoCoverMediaId = rows[0].cover_media_id;
    await db.query(`UPDATE services SET cover_media_id = NULL, cover_alt = NULL WHERE id = ?`, [req.params.id]);
    if (antigoCoverMediaId) await mediaService.apagar(antigoCoverMediaId);
    res.status(204).end();
  } catch (err) { next(err); }
}

/** GET /media/:chave — entrega com cabeçalhos defensivos. */
async function servir(req, res) {
  const arq = await mediaService.ler(req.params.chave, req.session?.user || null);
  // 404 (e não 403) para pendente de outra pessoa: não confirma que existe.
  if (!arq) return res.status(404).end();
  res.set({
    "Content-Type": arq.contentType,
    "Content-Length": arq.buffer.length,
    // Aprovada: nome aleatório e conteúdo imutável -> cache longo.
    // Pendente: NUNCA em cache compartilhado — um CDN a serviria para
    // todos antes da aprovação.
    "Cache-Control": arq.privada ? "private, no-store" : "public, max-age=31536000, immutable",
    "Content-Disposition": "inline",
    // Mesmo que algo tente abrir como documento, nada executa.
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  res.send(arq.buffer);
}

module.exports = { receberImagem, enviarCapa, removerCapa, servir };
