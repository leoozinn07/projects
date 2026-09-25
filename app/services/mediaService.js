/* ==============================================================
   AquaTrip — Imagens enviadas
   ==============================================================
   Todo upload passa por aqui. Cada etapa fecha um ataque:

   1. TAMANHO: limite no recebimento (multer) — um arquivo de 2 GB
      não chega nem a ser lido inteiro.
   2. TIPO REAL: pela assinatura dos primeiros bytes. Extensão e
      Content-Type são enviados pelo cliente, logo forjáveis.
   3. DIMENSÕES: recusa imagens gigantes antes de decodificar —
      uma "bomba de descompressão" de 50.000 × 50.000 px cabe em
      poucos KB e explode a memória ao abrir.
   4. REPROCESSAMENTO: a imagem é decodificada e codificada de novo
      em WebP. Isso (a) REMOVE METADADOS — inclusive o GPS que
      celulares gravam na foto, que pode revelar a casa de quem a
      tirou; (b) destrói arquivos "poliglotas" (imagem válida que
      também é script/HTML); (c) padroniza o formato servido.
   5. NOME: gerado pelo servidor (UUID). O nome original nunca vira
      caminho de arquivo — é o vetor clássico de path traversal.
   6. LOCAL: fora da pasta pública; servido por rota controlada.
   ============================================================== */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const db = require("../lib/db");
const log = require("../lib/logger").forModule("midia");

const MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES || 5 * 1024 * 1024);
const MAX_LADO_ENTRADA = 8000;   // px; acima disso, recusa antes de decodificar
const MAX_LADO_SAIDA = 1600;     // px; guardado já redimensionado
const QUALIDADE = 82;

class MediaError extends Error {
  constructor(message, code, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* ---------- 2. Tipo real pela assinatura ---------- */
function tipoPorAssinatura(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "webp";
  return null; // SVG, GIF, HTML, PDF, executável... tudo recusado
}

/* ---------- Armazenamento plugável ----------
   Em produção com mais de uma instância, disco local não serve
   (cada instância teria seus arquivos). A interface é pequena de
   propósito para trocar por S3/R2/GCS sem mexer no resto. */
const DIR_LOCAL = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

const armazenamentoLocal = {
  async gravar(chave, buffer) {
    await fs.promises.mkdir(DIR_LOCAL, { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(path.join(DIR_LOCAL, chave), buffer, { mode: 0o600 });
  },
  async ler(chave) {
    return fs.promises.readFile(path.join(DIR_LOCAL, chave));
  },
  async apagar(chave) {
    await fs.promises.rm(path.join(DIR_LOCAL, chave), { force: true });
  },
};
const armazenamento = armazenamentoLocal;

/** Chave aceita pela rota de leitura: só o formato que nós geramos. */
const CHAVE_VALIDA = /^[0-9a-f-]{36}\.webp$/;

/**
 * Processa e guarda uma imagem. Devolve o registro em `media`.
 * `buffer` vem do multer (memória), já limitado em tamanho.
 */
async function salvarImagem({ buffer, usuarioId, purpose = "COVER", status = "APPROVED" }) {
  if (!buffer || !buffer.length) throw new MediaError("Nenhum arquivo recebido.", "EMPTY");
  if (buffer.length > MAX_BYTES) {
    throw new MediaError(`Arquivo grande demais (máximo ${Math.round(MAX_BYTES / 1024 / 1024)} MB).`, "TOO_LARGE", 413);
  }
  if (!tipoPorAssinatura(buffer)) {
    throw new MediaError("Formato não aceito. Envie uma foto JPEG, PNG ou WebP.", "BAD_TYPE", 415);
  }

  let meta;
  try {
    // limitInputPixels: o próprio sharp recusa bombas de descompressão.
    meta = await sharp(buffer, { limitInputPixels: MAX_LADO_ENTRADA * MAX_LADO_ENTRADA }).metadata();
  } catch (err) {
    // A trava de pixels do sharp dispara aqui: é imagem grande demais,
    // não arquivo corrompido — a mensagem precisa dizer isso.
    if (/pixel limit/i.test(err.message)) {
      throw new MediaError(`Imagem grande demais (máximo ${MAX_LADO_ENTRADA} px de lado). Reduza e envie de novo.`, "TOO_BIG_DIMENSIONS");
    }
    throw new MediaError("O arquivo está corrompido ou não é uma imagem válida.", "CORRUPT");
  }
  if (!meta.width || !meta.height || meta.width > MAX_LADO_ENTRADA || meta.height > MAX_LADO_ENTRADA) {
    throw new MediaError(`Imagem grande demais (máximo ${MAX_LADO_ENTRADA} px de lado).`, "TOO_BIG_DIMENSIONS");
  }
  if (meta.width < 400 || meta.height < 250) {
    throw new MediaError("Imagem pequena demais para a vitrine (mínimo 400 × 250 px).", "TOO_SMALL");
  }

  let saida;
  try {
    const { data, info } = await sharp(buffer, { limitInputPixels: MAX_LADO_ENTRADA * MAX_LADO_ENTRADA })
      .rotate() // aplica a orientação do EXIF antes de descartá-lo
      .resize({ width: MAX_LADO_SAIDA, height: MAX_LADO_SAIDA, fit: "inside", withoutEnlargement: true })
      .webp({ quality: QUALIDADE })
      // SEM .withMetadata(): o padrão do sharp é descartar EXIF, GPS,
      // ICC e XMP. É exatamente o que queremos.
      .toBuffer({ resolveWithObject: true });
    saida = { data, info };
  } catch (err) {
    log.warn({ err }, "falha ao reprocessar imagem");
    throw new MediaError("Não foi possível processar a imagem.", "PROCESS_FAILED");
  }

  const chave = `${crypto.randomUUID()}.webp`;
  await armazenamento.gravar(chave, saida.data);

  const id = crypto.randomUUID();
  try {
    await db.query(
      `INSERT INTO media (id, storage_key, content_type, width, height, bytes, uploaded_by, purpose, status)
       VALUES (?, ?, 'image/webp', ?, ?, ?, ?, ?, ?)`,
      [id, chave, saida.info.width, saida.info.height, saida.data.length, usuarioId, purpose, status]
    );
    const { rows } = await db.query(
      `SELECT id, storage_key, width, height, bytes, status FROM media WHERE id = ?`,
      [id]
    );
    return rows[0];
  } catch (err) {
    await armazenamento.apagar(chave); // não deixa arquivo órfão
    throw err;
  }
}

/**
 * Lê para entregar. Aprovada: qualquer um. Pendente: só quem enviou e
 * admin (o autor precisa ver o que mandou; o moderador precisa avaliar).
 * Recusada: ninguém — o arquivo já foi apagado.
 */
async function ler(chave, viewer = null) {
  if (!CHAVE_VALIDA.test(chave)) return null;
  const { rows } = await db.query(
    `SELECT storage_key, content_type, status, uploaded_by FROM media WHERE storage_key = ?`, [chave]
  );
  const m = rows[0];
  if (!m || m.status === "REJECTED") return null;
  const privada = m.status !== "APPROVED";
  if (privada && !(viewer && (viewer.role === "ADMIN" || viewer.id === m.uploaded_by))) return null;
  try {
    return { buffer: await armazenamento.ler(chave), contentType: m.content_type, privada };
  } catch {
    return null;
  }
}

/* ---------- Moderação ----------
   Lista FECHADA de motivos: permite auditar a coerência das decisões
   e dar ao autor uma explicação clara, em vez de texto livre. */
const MOTIVOS_RECUSA = Object.freeze({
  PESSOAS_IDENTIFICAVEIS: "Mostra o rosto de outras pessoas ou de crianças",
  DADOS_PESSOAIS: "Mostra documento, placa de carro ou outro dado pessoal",
  CONTEUDO_IMPROPRIO: "Conteúdo impróprio ou ofensivo",
  FORA_DO_TEMA: "Não mostra a experiência avaliada",
  QUALIDADE: "Imagem sem condições de visualização",
  DIREITOS: "Parece ser imagem de terceiros (sem direito de uso)",
});

async function pendentes(limite = 100) {
  const { rows } = await db.query(
    `SELECT m.id, m.storage_key, m.width, m.height, m.purpose, m.created_at,
            u.name AS autor, u.email AS autor_email,
            r.id AS review_id, r.rating, r.title AS review_title,
            COALESCE(sv.title, sc.title) AS experiencia,
            CASE WHEN sc.id IS NOT NULL THEN 'capa de parceiro' ELSE 'foto de avaliação' END AS origem
     FROM media m
     LEFT JOIN users u         ON u.id = m.uploaded_by
     LEFT JOIN review_photos rp ON rp.media_id = m.id
     LEFT JOIN reviews r        ON r.id = rp.review_id
     LEFT JOIN services sv      ON sv.id = r.service_id
     LEFT JOIN services sc      ON sc.pending_cover_media_id = m.id
     WHERE m.status = 'PENDING'
     ORDER BY m.created_at
     LIMIT ?`,
    [limite]
  );
  return rows;
}

/** Aprova ou recusa. Só age sobre PENDING: duas decisões simultâneas não se atropelam. */
async function moderar({ mediaId, adminId, aprovar, motivo }) {
  if (!aprovar && !MOTIVOS_RECUSA[motivo]) {
    throw new MediaError("Escolha um motivo de recusa da lista.", "INVALID_REASON");
  }
  const { rowCount } = await db.query(
    `UPDATE media
     SET status = ?, moderated_by = ?, moderated_at = NOW(), rejection_reason = ?
     WHERE id = ? AND status = 'PENDING'`,
    [aprovar ? "APPROVED" : "REJECTED", adminId, aprovar ? null : motivo, mediaId]
  );
  if (!rowCount) throw new MediaError("Foto não encontrada ou já moderada.", "NOT_PENDING", 409);
  const { rows } = await db.query(
    `SELECT id, storage_key, status, uploaded_by, purpose FROM media WHERE id = ?`,
    [mediaId]
  );
  // Recusada: o arquivo sai do disco. Não guardamos imagem que
  // decidimos não publicar; o registro (quem, quando, motivo) fica.
  if (!aprovar) await armazenamento.apagar(rows[0].storage_key);
  return rows[0];
}

/** Apaga arquivos cujas linhas já foram removidas numa transação. */
async function apagarArquivos(chaves) {
  for (const c of chaves) {
    if (CHAVE_VALIDA.test(c)) await armazenamento.apagar(c);
  }
}

async function apagar(mediaId) {
  const { rows } = await db.query(`SELECT storage_key FROM media WHERE id = ?`, [mediaId]);
  if (!rows[0]) return;
  await db.query(`DELETE FROM media WHERE id = ?`, [mediaId]);
  await armazenamento.apagar(rows[0].storage_key);
}

module.exports = {
  MediaError, MAX_BYTES, MOTIVOS_RECUSA, CHAVE_VALIDA,
  tipoPorAssinatura, salvarImagem, ler, apagar, apagarArquivos, pendentes, moderar,
};
