/* ==============================================================
   AquaTrip — Rede social das experiências
   ==============================================================
   Curtidas, comentários, interesse, seguidores, denúncias e perfis.
   Toda contagem sai de COUNT(*) no banco — nada de contador guardado
   que possa descolar da realidade.

   Duplicidade é barrada pela CHAVE PRIMÁRIA (curtir, seguir, ter
   interesse) e por UNIQUE (denunciar): INSERT IGNORE torna a ação
   idempotente, então duplo clique ou corrida não duplica nada.

   Privacidade: nome público no formato "Lia S." (o mesmo das
   avaliações). E-mail, CPF e sobrenome completo nunca saem daqui.
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");
const auditService = require("./auditService");
const { nomeExibido } = require("./reviewService");
const { visivel } = require("../lib/visibilidade");
const { AuditAction } = auditService;

class SocialError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "SocialError";
    this.code = code;
    this.status = status;
  }
}

const MOTIVOS_DENUNCIA = Object.freeze({
  GOLPE: "Parece golpe ou cobrança enganosa",
  INFORMACAO_FALSA: "Informações falsas sobre a viagem",
  CONTEUDO_IMPROPRIO: "Conteúdo impróprio ou ofensivo",
  PERIGOSO: "Atividade perigosa ou sem segurança",
  CONTATO_EXTERNO: "Pede contato ou pagamento fora do AquaTrip",
  OUTRO: "Outro motivo",
});

/** Experiência que o público pode ver. Invisível responde 404. */
async function experienciaVisivel(serviceId) {
  const { rows } = await db.query(
    `SELECT sv.id, sv.creator_user_id, sv.title FROM services sv WHERE sv.id = ? AND ${visivel("sv")}`,
    [serviceId]
  );
  if (!rows[0]) throw new SocialError("Experiência não encontrada.", "NOT_FOUND", 404);
  return rows[0];
}

async function contar(sql, params) {
  const { rows } = await db.query(sql, params);
  return Number(rows[0].n);
}

/* ---------- Curtidas ---------- */

async function curtir({ userId, serviceId, curtir: quer }) {
  await experienciaVisivel(serviceId);
  if (quer) {
    await db.query(`INSERT IGNORE INTO experience_likes (user_id, service_id) VALUES (?, ?)`, [userId, serviceId]);
  } else {
    await db.query(`DELETE FROM experience_likes WHERE user_id = ? AND service_id = ?`, [userId, serviceId]);
  }
  const total = await contar(`SELECT COUNT(*) AS n FROM experience_likes WHERE service_id = ?`, [serviceId]);
  return { curtiu: !!quer, curtidas: total };
}

/* ---------- Interesse ---------- */

async function interesse({ userId, serviceId, quer }) {
  const sv = await experienciaVisivel(serviceId);
  if (sv.creator_user_id === userId) {
    throw new SocialError("Você é quem organiza esta experiência.", "OWN_EXPERIENCE", 409);
  }
  if (quer) {
    await db.query(`INSERT IGNORE INTO experience_interests (user_id, service_id) VALUES (?, ?)`, [userId, serviceId]);
  } else {
    await db.query(`DELETE FROM experience_interests WHERE user_id = ? AND service_id = ?`, [userId, serviceId]);
  }
  const total = await contar(`SELECT COUNT(*) AS n FROM experience_interests WHERE service_id = ?`, [serviceId]);
  return { interesse: !!quer, interessados: total };
}

/* ---------- Comentários ---------- */

function comentarioPublico(r, viewerId, criadorId) {
  return {
    id: r.id,
    texto: r.body,
    criado_em: r.created_at,
    autor: {
      id: r.user_id,
      nome: nomeExibido(r.name),
      avatar: r.avatar_key ? `/media/${r.avatar_key}` : null,
      exemplo: !!Number(r.is_demo),
    },
    // Quem pode apagar: o autor e o criador da experiência (moderar a
    // própria página). O admin oculta pelo painel, com motivo.
    pode_apagar: !!viewerId && (viewerId === r.user_id || viewerId === criadorId),
  };
}

async function comentarios(serviceId, viewerId = null, limite = 50) {
  const sv = await experienciaVisivel(serviceId);
  const { rows } = await db.query(
    `SELECT c.id, c.body, c.created_at, c.user_id, u.name, u.is_demo,
            (SELECT storage_key FROM media am WHERE am.id = u.avatar_media_id AND am.status = 'APPROVED') AS avatar_key
     FROM experience_comments c JOIN users u ON u.id = c.user_id
     WHERE c.service_id = ? AND c.status = 'VISIBLE'
     ORDER BY c.created_at DESC
     LIMIT ?`,
    [serviceId, Math.min(Number(limite) || 50, 100)]
  );
  return rows.map((r) => comentarioPublico(r, viewerId, sv.creator_user_id));
}

async function comentar({ userId, serviceId, texto }) {
  const sv = await experienciaVisivel(serviceId);
  const body = String(texto || "").replace(/\s+\n/g, "\n").trim();
  if (body.length < 2 || body.length > 600) {
    throw new SocialError("O comentário precisa ter entre 2 e 600 caracteres.", "INVALID_COMMENT", 422);
  }
  // Freio de spam além do limitador por IP: no máximo 5 por minuto por conta.
  const recentes = await contar(
    `SELECT COUNT(*) AS n FROM experience_comments WHERE user_id = ? AND created_at > NOW() - INTERVAL 1 MINUTE`,
    [userId]
  );
  if (recentes >= 5) throw new SocialError("Muitos comentários seguidos. Espere um minuto.", "TOO_FAST", 429);

  const id = crypto.randomUUID();
  await db.query(`INSERT INTO experience_comments (id, service_id, user_id, body) VALUES (?, ?, ?, ?)`, [id, serviceId, userId, body]);
  const { rows } = await db.query(
    `SELECT c.id, c.body, c.created_at, c.user_id, u.name, u.is_demo,
            (SELECT storage_key FROM media am WHERE am.id = u.avatar_media_id AND am.status = 'APPROVED') AS avatar_key
     FROM experience_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
    [id]
  );
  return comentarioPublico(rows[0], userId, sv.creator_user_id);
}

async function apagarComentario({ userId, commentId }) {
  const { rows } = await db.query(
    `SELECT c.id, c.user_id, s.creator_user_id FROM experience_comments c JOIN services s ON s.id = c.service_id
     WHERE c.id = ?`,
    [commentId]
  );
  const c = rows[0];
  if (!c || (c.user_id !== userId && c.creator_user_id !== userId)) {
    throw new SocialError("Comentário não encontrado.", "NOT_FOUND", 404);
  }
  await db.query(`DELETE FROM experience_comments WHERE id = ?`, [commentId]);
}

/* ---------- Seguidores ---------- */

async function perfilExiste(userId) {
  const { rows } = await db.query(
    `SELECT id FROM users WHERE id = ? AND status = 'ACTIVE' AND anonymized_at IS NULL`,
    [userId]
  );
  return !!rows[0];
}

async function seguir({ userId, alvoId, quer }) {
  if (userId === alvoId) throw new SocialError("Você não pode seguir a si mesmo.", "SELF_FOLLOW", 422);
  if (!(await perfilExiste(alvoId))) throw new SocialError("Perfil não encontrado.", "NOT_FOUND", 404);
  if (quer) {
    await db.query(`INSERT IGNORE INTO user_follows (follower_id, followee_id) VALUES (?, ?)`, [userId, alvoId]);
  } else {
    await db.query(`DELETE FROM user_follows WHERE follower_id = ? AND followee_id = ?`, [userId, alvoId]);
  }
  const seguidores = await contar(`SELECT COUNT(*) AS n FROM user_follows WHERE followee_id = ?`, [alvoId]);
  return { segue: !!quer, seguidores };
}

/** Lista de seguidores ou de quem a pessoa segue (só perfis ativos). */
async function listaDeConexoes(userId, tipo) {
  if (!(await perfilExiste(userId))) throw new SocialError("Perfil não encontrado.", "NOT_FOUND", 404);
  const [colunaAlvo, colunaOutro] = tipo === "seguindo" ? ["follower_id", "followee_id"] : ["followee_id", "follower_id"];
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.is_demo,
            (SELECT storage_key FROM media am WHERE am.id = u.avatar_media_id AND am.status = 'APPROVED') AS avatar_key
     FROM user_follows f JOIN users u ON u.id = f.${colunaOutro}
     WHERE f.${colunaAlvo} = ? AND u.status = 'ACTIVE' AND u.anonymized_at IS NULL
     ORDER BY f.created_at DESC LIMIT 200`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id, nome: nomeExibido(r.name), avatar: r.avatar_key ? `/media/${r.avatar_key}` : null, exemplo: !!Number(r.is_demo),
  }));
}

/* ---------- Denúncias ---------- */

async function denunciar({ userId, serviceId, motivo, detalhes, req }) {
  const sv = await experienciaVisivel(serviceId);
  if (!MOTIVOS_DENUNCIA[motivo]) throw new SocialError("Escolha um motivo da lista.", "INVALID_REASON", 422);
  if (sv.creator_user_id === userId) throw new SocialError("Você não pode denunciar a própria experiência.", "OWN_EXPERIENCE", 409);
  const { rowCount } = await db.query(
    `INSERT IGNORE INTO experience_reports (id, service_id, reporter_id, reason, details) VALUES (?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), serviceId, userId, motivo, String(detalhes || "").trim().slice(0, 500) || null]
  );
  if (rowCount) {
    await auditService.log(AuditAction.COMMUNITY_EXPERIENCE_REPORTED, { req, userId, metadata: { servicoId: serviceId, motivo } });
  }
  return { denunciado: true, nova: !!rowCount };
}

/* ---------- Perfis ---------- */

async function estatisticas(userId) {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM user_follows WHERE followee_id = ?) AS seguidores,
       (SELECT COUNT(*) FROM user_follows WHERE follower_id = ?) AS seguindo,
       (SELECT COUNT(*) FROM experience_likes l JOIN services s ON s.id = l.service_id
          WHERE s.creator_user_id = ?) AS curtidas_recebidas,
       (SELECT COUNT(*) FROM experience_comments c JOIN services s ON s.id = c.service_id
          WHERE s.creator_user_id = ? AND c.status = 'VISIBLE' AND c.user_id <> ?) AS comentarios_recebidos`,
    [userId, userId, userId, userId, userId]
  );
  const r = rows[0];
  return {
    seguidores: Number(r.seguidores),
    seguindo: Number(r.seguindo),
    curtidas_recebidas: Number(r.curtidas_recebidas),
    comentarios_recebidos: Number(r.comentarios_recebidos),
  };
}

/** Experiências publicadas de alguém, com curtidas e comentários de cada uma. */
async function experienciasDe(userId, { soVisiveis }) {
  const { rows } = await db.query(
    `SELECT s.id, s.slug, s.title, s.location, s.category, s.price_cents, s.active, s.moderation_status,
            (SELECT storage_key FROM media WHERE id = s.cover_media_id) AS cover_key,
            (SELECT MIN(sl.starts_at) FROM service_slots sl WHERE sl.service_id = s.id) AS starts_at,
            (SELECT COUNT(*) FROM experience_likes l WHERE l.service_id = s.id) AS curtidas,
            (SELECT COUNT(*) FROM experience_comments c WHERE c.service_id = s.id AND c.status = 'VISIBLE') AS comentarios
     FROM services s
     WHERE s.creator_user_id = ? ${soVisiveis ? `AND ${visivel("s")}` : ""}
     ORDER BY s.created_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id, slug: r.slug, title: r.title, location: r.location, category: r.category,
    price_cents: Number(r.price_cents), cover_key: r.cover_key, starts_at: r.starts_at,
    curtidas: Number(r.curtidas), comentarios: Number(r.comentarios),
    active: !!r.active, moderation_status: r.moderation_status,
  }));
}

/** Perfil público: o que qualquer visitante pode ver. */
async function perfilPublico(userId, viewerId = null) {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.bio, u.created_at, u.is_demo,
            (SELECT storage_key FROM media am WHERE am.id = u.avatar_media_id AND am.status = 'APPROVED') AS avatar_key
     FROM users u WHERE u.id = ? AND u.status = 'ACTIVE' AND u.anonymized_at IS NULL`,
    [userId]
  );
  const u = rows[0];
  if (!u) throw new SocialError("Perfil não encontrado.", "NOT_FOUND", 404);
  const [stats, experiencias, segue] = await Promise.all([
    estatisticas(userId),
    experienciasDe(userId, { soVisiveis: true }),
    viewerId && viewerId !== userId
      ? contar(`SELECT COUNT(*) AS n FROM user_follows WHERE follower_id = ? AND followee_id = ?`, [viewerId, userId])
      : Promise.resolve(0),
  ]);
  return {
    id: u.id,
    nome: nomeExibido(u.name),
    bio: u.bio,
    avatar: u.avatar_key ? `/media/${u.avatar_key}` : null,
    membro_desde: u.created_at,
    exemplo: !!Number(u.is_demo),
    ...stats,
    experiencias: experiencias.map((e) => ({ ...e, exemplo: !!Number(u.is_demo) })),
    segue: !!segue,
    eu: viewerId === userId,
  };
}

/** Painel do próprio perfil: nome completo, tudo que publicou e comentários recebidos. */
async function meuPerfil(userId) {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.bio, u.created_at,
            m.storage_key AS avatar_key, m.status AS avatar_status
     FROM users u LEFT JOIN media m ON m.id = u.avatar_media_id WHERE u.id = ?`,
    [userId]
  );
  const u = rows[0];
  if (!u) throw new SocialError("Perfil não encontrado.", "NOT_FOUND", 404);
  const [stats, experiencias, recebidos] = await Promise.all([
    estatisticas(userId),
    experienciasDe(userId, { soVisiveis: false }),
    db.query(
      `SELECT c.id, c.body, c.created_at, c.user_id, u.name, u.is_demo, s.title AS experiencia, s.slug,
              (SELECT storage_key FROM media am WHERE am.id = u.avatar_media_id AND am.status = 'APPROVED') AS avatar_key
       FROM experience_comments c
       JOIN services s ON s.id = c.service_id
       JOIN users u ON u.id = c.user_id
       WHERE s.creator_user_id = ? AND c.status = 'VISIBLE' AND c.user_id <> ?
       ORDER BY c.created_at DESC LIMIT 30`,
      [userId, userId]
    ),
  ]);
  return {
    id: u.id,
    nome: u.name,
    nome_publico: nomeExibido(u.name),
    bio: u.bio,
    // O dono vê a própria foto mesmo pendente (mediaService.ler libera ao autor).
    avatar: u.avatar_key ? `/media/${u.avatar_key}` : null,
    avatar_status: u.avatar_status || null,
    membro_desde: u.created_at,
    ...stats,
    experiencias,
    comentarios_recebidos_lista: recebidos.rows.map((r) => ({
      id: r.id, texto: r.body, criado_em: r.created_at,
      experiencia: r.experiencia, slug: r.slug,
      autor: { id: r.user_id, nome: nomeExibido(r.name), avatar: r.avatar_key ? `/media/${r.avatar_key}` : null, exemplo: !!Number(r.is_demo) },
    })),
  };
}

/* ---------- Foto e bio do perfil ---------- */

async function salvarBio({ userId, bio }) {
  const texto = String(bio || "").replace(/\s+/g, " ").trim();
  if (texto.length > 280) throw new SocialError("A bio pode ter até 280 caracteres.", "BIO_TOO_LONG", 422);
  await db.query(`UPDATE users SET bio = ? WHERE id = ?`, [texto || null, userId]);
  return { bio: texto || null };
}

async function trocarAvatar({ userId, buffer, req }) {
  const mediaService = require("./mediaService");
  const { rows } = await db.query(`SELECT avatar_media_id FROM users WHERE id = ?`, [userId]);
  const anterior = rows[0] && rows[0].avatar_media_id;
  // Foto enviada por usuário é pública só depois de aprovada (regra do
  // projeto para toda imagem de cliente). O dono já vê a pendente.
  const media = await mediaService.salvarImagem({
    buffer, usuarioId: userId, purpose: "AVATAR", status: "PENDING", minimo: { w: 200, h: 200 },
  });
  await db.query(`UPDATE users SET avatar_media_id = ? WHERE id = ?`, [media.id, userId]);
  if (anterior) await mediaService.apagar(anterior);
  await auditService.log(AuditAction.PHOTO_SUBMITTED, { req, userId, metadata: { mediaId: media.id, tipo: "avatar" } });
  return { url: `/media/${media.storage_key}`, status: media.status };
}

async function removerAvatar({ userId }) {
  const { rows } = await db.query(`SELECT avatar_media_id FROM users WHERE id = ?`, [userId]);
  if (rows[0] && rows[0].avatar_media_id) {
    await require("./mediaService").apagar(rows[0].avatar_media_id);
  }
}

module.exports = {
  SocialError, MOTIVOS_DENUNCIA,
  curtir, interesse, comentarios, comentar, apagarComentario,
  seguir, listaDeConexoes, denunciar,
  estatisticas, perfilPublico, meuPerfil, salvarBio, trocarAvatar, removerAvatar,
};
