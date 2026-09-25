/* ==============================================================
   AquaTrip — Experiências criadas por usuários (comunidade)
   ==============================================================
   Uma experiência da comunidade é uma viagem que alguém vai fazer e
   abre vagas para outras pessoas irem junto. Ela usa o MESMO modelo
   das experiências da equipe e dos parceiros:
     services (a experiência) + 1 service_slot (data, hora e vagas)
     + bookings (participação) + media/service_photos (fotos).

   Regras próprias:
   - Publica na hora (review_status APPROVED). O controle vem depois:
     denúncia de usuários + moderação do admin (suspender/banir).
   - Gratuita: qualquer conta ativa publica.
   - Paga: o dinheiro vai direto para o criador, então ele precisa de
     cadastro de parceiro aprovado com Mercado Pago conectado (a mesma
     regra "sem recebe e repassa" de lib/visibilidade.js).
   - Fotos entram PENDENTES na fila de moderação que já existe; até a
     primeira ser aprovada, a vitrine usa a ilustração da categoria.
   - Só o criador mexe na própria experiência (posse conferida aqui).
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");
const adminService = require("./adminService");
const adminRepository = require("../repositories/adminRepository");
const mediaService = require("./mediaService");
const auditService = require("./auditService");
const { nomeExibido } = require("./reviewService");
const { visivel } = require("../lib/visibilidade");
const { CATEGORIAS } = require("../lib/categorias");
const { AuditAction } = auditService;

const FUSO = process.env.OPERATION_TIMEZONE || "America/Sao_Paulo";
const MAX_FOTOS = 6;

class CommunityError extends Error {
  constructor(message, code, status = 400, campo = null) {
    super(message);
    this.name = "CommunityError";
    this.code = code;
    this.status = status;
    this.campo = campo;
  }
}

/* ---------- Apoio ---------- */

/** Converte data+hora digitadas no fuso de operação para UTC (via banco). */
async function paraUtc(data, hora) {
  const { rows } = await db.query(`SELECT CONVERT_TZ(?, ?, 'UTC') AS utc`, [`${data} ${hora}:00`, FUSO]);
  const utc = rows[0] && rows[0].utc;
  if (!utc) throw new CommunityError("Data ou horário inválido.", "INVALID_DATE", 422, "data");
  return new Date(utc);
}

function validarQuando(startsAt) {
  const agora = Date.now();
  if (startsAt.getTime() <= agora + 60 * 60 * 1000) {
    throw new CommunityError("Escolha uma data e horário a partir de uma hora daqui.", "DATE_IN_PAST", 422, "data");
  }
  if (startsAt.getTime() > agora + 2 * 365 * 86400000) {
    throw new CommunityError("A data pode ser no máximo daqui a dois anos.", "DATE_TOO_FAR", 422, "data");
  }
}

/** Parceiro do criador apto a receber (aprovado + Mercado Pago conectado). */
async function recebedorDo(userId) {
  const { rows } = await db.query(
    `SELECT id FROM partners WHERE user_id = ? AND status = 'APPROVED' AND mp_connected_at IS NOT NULL`,
    [userId]
  );
  return rows[0] ? rows[0].id : null;
}

async function exigirRecebedor(userId) {
  const partnerId = await recebedorDo(userId);
  if (!partnerId) {
    throw new CommunityError(
      "Para cobrar pela experiência, o valor precisa ir direto para você: conclua o cadastro de parceiro " +
        "e conecte o Mercado Pago em /parceiros. Experiências gratuitas podem ser publicadas agora.",
      "PAYOUT_REQUIRED", 422, "preco"
    );
  }
  return partnerId;
}

async function contaAtiva(userId) {
  const { rows } = await db.query(`SELECT id, status FROM users WHERE id = ?`, [userId]);
  if (!rows[0] || rows[0].status !== "ACTIVE") {
    throw new CommunityError("Sua conta não pode publicar experiências no momento.", "ACCOUNT_INACTIVE", 403);
  }
}

/** Experiência do criador. De outra pessoa responde 404 (não confirma que existe). */
async function minha(userId, serviceId, client = db) {
  const { rows } = await client.query(
    `SELECT * FROM services WHERE id = ? AND creator_user_id = ?${client === db ? "" : " FOR UPDATE"}`,
    [serviceId, userId]
  );
  if (!rows[0]) throw new CommunityError("Experiência não encontrada.", "NOT_FOUND", 404);
  return rows[0];
}

function exigirNaoModerada(sv) {
  if (sv.moderation_status !== "ACTIVE") {
    throw new CommunityError(
      "Esta experiência foi suspensa pela moderação e não pode ser alterada. Fale com o suporte.",
      "MODERATED", 409
    );
  }
}

async function slugUnico(titulo) {
  const base = adminService.slugify(titulo);
  if (!base) throw new CommunityError("Título inválido.", "INVALID_TITLE", 422, "titulo");
  let slug = base;
  for (let i = 2; await adminRepository.slugExists(slug); i++) slug = `${base}-${i}`;
  return slug;
}

/** Vagas ocupadas (confirmadas + pendentes ainda válidas) de um horário. */
async function ocupadas(slotId, client = db) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(quantity), 0) AS n FROM bookings
     WHERE slot_id = ? AND (status = 'CONFIRMED' OR (status = 'PENDING' AND expires_at > NOW()))`,
    [slotId]
  );
  return Number(rows[0].n);
}

/* ---------- Criar e editar ---------- */

async function criar({ userId, dados, req }) {
  await contaAtiva(userId);
  if (!CATEGORIAS[dados.category]) throw new CommunityError("Categoria inválida.", "INVALID_CATEGORY", 422, "categoria");
  const startsAt = await paraUtc(dados.date, dados.time);
  validarQuando(startsAt);
  const partnerId = dados.priceCents > 0 ? await exigirRecebedor(userId) : null;
  const slug = await slugUnico(dados.title);

  const id = crypto.randomUUID();
  await db.withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO services (id, slug, title, location, category, price_cents, description, trip_info,
                             partner_id, creator_user_id, review_status, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', TRUE)`,
      [id, slug, dados.title, dados.location, dados.category, dados.priceCents, dados.description,
        dados.tripInfo || null, partnerId, userId]
    );
    await tx.query(
      `INSERT INTO service_slots (id, service_id, starts_at, capacity) VALUES (?, ?, ?, ?)`,
      [crypto.randomUUID(), id, startsAt, dados.capacity]
    );
  });

  await auditService.log(AuditAction.COMMUNITY_EXPERIENCE_CREATED, {
    req, userId, metadata: { servicoId: id, pago: dados.priceCents > 0 },
  });
  return { id, slug };
}

async function editar({ userId, serviceId, dados, req }) {
  const sv = await minha(userId, serviceId);
  exigirNaoModerada(sv);
  if (dados.category && !CATEGORIAS[dados.category]) {
    throw new CommunityError("Categoria inválida.", "INVALID_CATEGORY", 422, "categoria");
  }
  let partnerId = sv.partner_id;
  if (dados.priceCents === 0) partnerId = null;
  else if (dados.priceCents > 0 && !partnerId) partnerId = await exigirRecebedor(userId);

  await db.withTransaction(async (tx) => {
    const { rows: slots } = await tx.query(
      `SELECT id, starts_at, capacity FROM service_slots WHERE service_id = ? ORDER BY starts_at LIMIT 1 FOR UPDATE`,
      [serviceId]
    );
    const slot = slots[0];
    const taken = slot ? await ocupadas(slot.id, tx) : 0;

    if (dados.date && dados.time && slot) {
      const novo = await paraUtc(dados.date, dados.time);
      if (novo.getTime() !== new Date(slot.starts_at).getTime()) {
        // Quem já garantiu vaga se organizou para aquela data.
        if (taken > 0) {
          throw new CommunityError(
            "Já há participantes confirmados: a data não pode mudar. Cancele e crie outra experiência se precisar.",
            "DATE_LOCKED", 409, "data"
          );
        }
        validarQuando(novo);
        await tx.query(`UPDATE service_slots SET starts_at = ? WHERE id = ?`, [novo, slot.id]);
      }
    }
    if (dados.capacity !== undefined && slot) {
      if (dados.capacity < taken) {
        throw new CommunityError(`Já há ${taken} vaga(s) ocupada(s): o total não pode ser menor que isso.`, "CAPACITY_BELOW_TAKEN", 409, "vagas");
      }
      await tx.query(`UPDATE service_slots SET capacity = ? WHERE id = ?`, [dados.capacity, slot.id]);
    }

    await tx.query(
      `UPDATE services SET
         title = COALESCE(?, title), description = COALESCE(?, description),
         location = COALESCE(?, location), category = COALESCE(?, category),
         price_cents = COALESCE(?, price_cents), trip_info = COALESCE(?, trip_info),
         partner_id = ?
       WHERE id = ?`,
      [dados.title ?? null, dados.description ?? null, dados.location ?? null, dados.category ?? null,
        dados.priceCents ?? null, dados.tripInfo ?? null, partnerId, serviceId]
    );
  });

  await auditService.log(AuditAction.COMMUNITY_EXPERIENCE_UPDATED, {
    req, userId, metadata: { servicoId: serviceId, campos: Object.keys(dados) },
  });
  return { id: serviceId, slug: sv.slug };
}

/** Publicar de novo ou pausar (sai da vitrine; reservas feitas continuam valendo). */
async function definirPublicada({ userId, serviceId, publicada, req }) {
  const sv = await minha(userId, serviceId);
  exigirNaoModerada(sv);
  await db.query(`UPDATE services SET active = ? WHERE id = ?`, [!!publicada, serviceId]);
  await auditService.log(AuditAction.COMMUNITY_EXPERIENCE_UPDATED, {
    req, userId, metadata: { servicoId: serviceId, publicada: !!publicada },
  });
  return { id: serviceId, active: !!publicada };
}

/* ---------- Fotos ---------- */

async function adicionarFoto({ userId, serviceId, buffer, req }) {
  const sv = await minha(userId, serviceId);
  exigirNaoModerada(sv);
  const { rows } = await db.query(`SELECT position FROM service_photos WHERE service_id = ? ORDER BY position`, [serviceId]);
  if (rows.length >= MAX_FOTOS) {
    throw new CommunityError(`Cada experiência aceita até ${MAX_FOTOS} fotos.`, "TOO_MANY_PHOTOS", 409);
  }
  const usadas = new Set(rows.map((r) => r.position));
  let posicao = 1;
  while (usadas.has(posicao)) posicao++;

  const media = await mediaService.salvarImagem({ buffer, usuarioId: userId, purpose: "EXPERIENCE", status: "PENDING" });
  await db.query(`INSERT INTO service_photos (service_id, media_id, position) VALUES (?, ?, ?)`, [serviceId, media.id, posicao]);
  await auditService.log(AuditAction.PHOTO_SUBMITTED, { req, userId, metadata: { servicoId: serviceId, mediaId: media.id } });
  return { id: media.id, url: `/media/${media.storage_key}`, status: media.status, posicao };
}

async function removerFoto({ userId, serviceId, mediaId }) {
  await minha(userId, serviceId);
  const { rows } = await db.query(
    `SELECT sp.media_id FROM service_photos sp WHERE sp.service_id = ? AND sp.media_id = ?`,
    [serviceId, mediaId]
  );
  if (!rows[0]) throw new CommunityError("Foto não encontrada.", "NOT_FOUND", 404);
  // A capa aponta para media com SET NULL: apagar a foto limpa a capa sozinho.
  await mediaService.apagar(mediaId);
  await promoverCapa(serviceId);
}

/** Primeira foto APROVADA vira a capa, se ainda não houver capa. */
async function promoverCapa(serviceId) {
  await db.query(
    `UPDATE services s
     SET s.cover_media_id = (
       SELECT sp.media_id FROM service_photos sp JOIN media m ON m.id = sp.media_id
       WHERE sp.service_id = s.id AND m.status = 'APPROVED' ORDER BY sp.position LIMIT 1)
     WHERE s.id = ? AND s.creator_user_id IS NOT NULL AND s.cover_media_id IS NULL`,
    [serviceId]
  );
}

/** Chamado pela moderação quando uma foto de experiência é aprovada. */
async function aoAprovarFoto(mediaId) {
  const { rows } = await db.query(`SELECT service_id FROM service_photos WHERE media_id = ?`, [mediaId]);
  if (rows[0]) await promoverCapa(rows[0].service_id);
}

/* ---------- Leitura ---------- */

const COLUNAS_CARTAO = `
  s.id, s.slug, s.title, s.location, s.category, s.price_cents, s.currency, s.description,
  s.cover_alt, s.created_at, s.creator_user_id,
  (SELECT storage_key FROM media WHERE id = s.cover_media_id) AS cover_key,
  sl.starts_at, sl.capacity,
  (SELECT COALESCE(SUM(b.quantity), 0) FROM bookings b WHERE b.slot_id = sl.id
     AND (b.status = 'CONFIRMED' OR (b.status = 'PENDING' AND b.expires_at > NOW()))) AS ocupadas,
  (SELECT COUNT(*) FROM experience_likes l WHERE l.service_id = s.id) AS curtidas,
  (SELECT COUNT(*) FROM experience_comments c WHERE c.service_id = s.id AND c.status = 'VISIBLE') AS comentarios`;

function cartao(r) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    location: r.location,
    category: r.category,
    price_cents: Number(r.price_cents),
    currency: r.currency,
    description: r.description,
    cover_key: r.cover_key,
    cover_alt: r.cover_alt,
    starts_at: r.starts_at,
    capacity: r.capacity == null ? null : Number(r.capacity),
    vagas_restantes: r.capacity == null ? null : Math.max(0, Number(r.capacity) - Number(r.ocupadas)),
    curtidas: Number(r.curtidas),
    comentarios: Number(r.comentarios),
    created_at: r.created_at,
  };
}

/**
 * Feed público: experiências da comunidade visíveis e com data futura.
 * `ordem`: recentes | proximas | populares. `seguindo`: só de quem o
 * leitor segue.
 */
async function feed({ viewerId = null, ordem = "recentes", categoria = null, busca = null, seguindo = false, limite = 24, pagina = 1 } = {}) {
  const cond = [visivel("s"), "s.creator_user_id IS NOT NULL", "sl.starts_at > NOW()", "u.status = 'ACTIVE'"];
  const params = [];
  if (categoria && CATEGORIAS[categoria]) { cond.push("s.category = ?"); params.push(categoria); }
  if (busca) {
    cond.push("(s.title LIKE ? OR s.location LIKE ?)");
    params.push(`%${busca}%`, `%${busca}%`);
  }
  if (seguindo && viewerId) {
    cond.push("EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_id = ? AND f.followee_id = s.creator_user_id)");
    params.push(viewerId);
  }
  const ordenar = {
    proximas: "sl.starts_at ASC",
    populares: "curtidas DESC, s.created_at DESC",
    recentes: "s.created_at DESC",
  }[ordem] || "s.created_at DESC";
  const lim = Math.min(Math.max(Number(limite) || 24, 1), 48);
  const off = (Math.max(Number(pagina) || 1, 1) - 1) * lim;

  const { rows } = await db.query(
    `SELECT ${COLUNAS_CARTAO}, u.name AS criador_nome,
            (SELECT storage_key FROM media am WHERE am.id = u.avatar_media_id AND am.status = 'APPROVED') AS criador_avatar,
            ${viewerId ? "EXISTS (SELECT 1 FROM experience_likes ml WHERE ml.service_id = s.id AND ml.user_id = ?)" : "FALSE"} AS curtida_por_mim
     FROM services s
     JOIN service_slots sl ON sl.service_id = s.id
     JOIN users u ON u.id = s.creator_user_id
     WHERE ${cond.join(" AND ")}
     ORDER BY ${ordenar}
     LIMIT ${lim} OFFSET ${off}`,
    viewerId ? [viewerId, ...params] : params
  );
  return rows.map((r) => ({
    ...cartao(r),
    criador: { id: r.creator_user_id, nome: nomeExibido(r.criador_nome), avatar: r.criador_avatar ? `/media/${r.criador_avatar}` : null },
    curtida_por_mim: !!Number(r.curtida_por_mim),
  }));
}

/** Experiências do próprio criador (todas, inclusive pausadas e moderadas). */
async function minhas(userId) {
  const { rows } = await db.query(
    `SELECT ${COLUNAS_CARTAO}, s.active, s.moderation_status, s.moderation_reason, s.trip_info, s.partner_id,
            (SELECT COUNT(*) FROM experience_interests i WHERE i.service_id = s.id) AS interessados,
            (SELECT COUNT(*) FROM service_photos sp WHERE sp.service_id = s.id) AS fotos
     FROM services s
     LEFT JOIN service_slots sl ON sl.service_id = s.id
     WHERE s.creator_user_id = ?
     ORDER BY s.created_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    ...cartao(r),
    active: !!r.active,
    moderation_status: r.moderation_status,
    moderation_reason: r.moderation_reason,
    trip_info: r.trip_info,
    interessados: Number(r.interessados),
    fotos: Number(r.fotos),
    participantes: r.capacity == null ? 0 : Number(r.ocupadas),
    // Paga sem recebimento ativo não aparece para ninguém: o criador precisa saber.
    aguardando_recebimento: Number(r.price_cents) > 0 && !r.partner_id,
  }));
}

/** Dados completos para o criador editar (inclui fotos pendentes). */
async function paraEditar(userId, serviceId) {
  const sv = await minha(userId, serviceId);
  const { rows: slots } = await db.query(
    `SELECT id, capacity,
            DATE_FORMAT(CONVERT_TZ(starts_at, 'UTC', ?), '%Y-%m-%d') AS data,
            DATE_FORMAT(CONVERT_TZ(starts_at, 'UTC', ?), '%H:%i') AS hora
     FROM service_slots WHERE service_id = ? ORDER BY starts_at LIMIT 1`,
    [FUSO, FUSO, serviceId]
  );
  const { rows: fotos } = await db.query(
    `SELECT m.id, m.storage_key, m.status, m.rejection_reason, sp.position
     FROM service_photos sp JOIN media m ON m.id = sp.media_id
     WHERE sp.service_id = ? ORDER BY sp.position`,
    [serviceId]
  );
  return {
    id: sv.id, slug: sv.slug, title: sv.title, description: sv.description, location: sv.location,
    category: sv.category, price_cents: sv.price_cents, trip_info: sv.trip_info,
    active: !!sv.active, moderation_status: sv.moderation_status, moderation_reason: sv.moderation_reason,
    data: slots[0] ? slots[0].data : null, hora: slots[0] ? slots[0].hora : null,
    capacity: slots[0] ? slots[0].capacity : null,
    fotos: fotos.map((f) => ({ id: f.id, url: `/media/${f.storage_key}`, status: f.status, posicao: f.position })),
  };
}

/**
 * Participantes e interessados — só para o criador (e o admin, pelo
 * painel). Nome no formato público ("Lia S."): e-mail e telefone de
 * quem vai junto nunca saem daqui.
 */
async function pessoas(userId, serviceId) {
  await minha(userId, serviceId);
  const [part, inter] = await Promise.all([
    db.query(
      `SELECT b.user_id, u.name, SUM(b.quantity) AS vagas, MIN(b.created_at) AS desde
       FROM bookings b JOIN service_slots sl ON sl.id = b.slot_id JOIN users u ON u.id = b.user_id
       WHERE sl.service_id = ? AND b.status = 'CONFIRMED'
       GROUP BY b.user_id, u.name ORDER BY desde`,
      [serviceId]
    ),
    db.query(
      `SELECT i.user_id, u.name, i.created_at
       FROM experience_interests i JOIN users u ON u.id = i.user_id
       WHERE i.service_id = ? ORDER BY i.created_at DESC`,
      [serviceId]
    ),
  ]);
  return {
    participantes: part.rows.map((r) => ({ id: r.user_id, nome: nomeExibido(r.name), vagas: Number(r.vagas), desde: r.desde })),
    interessados: inter.rows.map((r) => ({ id: r.user_id, nome: nomeExibido(r.name), desde: r.created_at })),
  };
}

/** Bloco social da página da experiência (/reservar/:slug). */
async function blocoSocial(serviceId, viewerId = null) {
  const { rows } = await db.query(
    `SELECT s.creator_user_id, s.trip_info, u.name AS criador_nome, u.created_at AS criador_desde,
            (SELECT storage_key FROM media am WHERE am.id = u.avatar_media_id AND am.status = 'APPROVED') AS criador_avatar,
            (SELECT COUNT(*) FROM experience_likes l WHERE l.service_id = s.id) AS curtidas,
            (SELECT COUNT(*) FROM experience_interests i WHERE i.service_id = s.id) AS interessados,
            (SELECT COUNT(*) FROM user_follows f WHERE f.followee_id = s.creator_user_id) AS seguidores
     FROM services s LEFT JOIN users u ON u.id = s.creator_user_id
     WHERE s.id = ?`,
    [serviceId]
  );
  const r = rows[0];
  if (!r) return null;
  let meu = { curtiu: false, interesse: false, segue: false, denunciou: false };
  if (viewerId) {
    const { rows: m } = await db.query(
      `SELECT
         EXISTS (SELECT 1 FROM experience_likes WHERE user_id = ? AND service_id = ?) AS curtiu,
         EXISTS (SELECT 1 FROM experience_interests WHERE user_id = ? AND service_id = ?) AS interesse,
         EXISTS (SELECT 1 FROM user_follows WHERE follower_id = ? AND followee_id = ?) AS segue,
         EXISTS (SELECT 1 FROM experience_reports WHERE reporter_id = ? AND service_id = ?) AS denunciou`,
      [viewerId, serviceId, viewerId, serviceId, viewerId, r.creator_user_id || "", viewerId, serviceId]
    );
    meu = { curtiu: !!Number(m[0].curtiu), interesse: !!Number(m[0].interesse), segue: !!Number(m[0].segue), denunciou: !!Number(m[0].denunciou) };
  }
  return {
    serviceId,
    comunidade: !!r.creator_user_id,
    criador: r.creator_user_id ? {
      id: r.creator_user_id,
      nome: nomeExibido(r.criador_nome),
      avatar: r.criador_avatar ? `/media/${r.criador_avatar}` : null,
      desde: r.criador_desde,
      seguidores: Number(r.seguidores),
    } : null,
    trip_info: r.trip_info,
    curtidas: Number(r.curtidas),
    interessados: Number(r.interessados),
    eDoViewer: !!viewerId && viewerId === r.creator_user_id,
    meu,
  };
}

/** Fotos aprovadas (galeria pública da experiência). */
async function galeria(serviceId) {
  const { rows } = await db.query(
    `SELECT m.storage_key FROM service_photos sp JOIN media m ON m.id = sp.media_id
     WHERE sp.service_id = ? AND m.status = 'APPROVED' ORDER BY sp.position`,
    [serviceId]
  );
  return rows.map((r) => `/media/${r.storage_key}`);
}

module.exports = {
  CommunityError, MAX_FOTOS,
  criar, editar, definirPublicada, adicionarFoto, removerFoto, aoAprovarFoto,
  feed, minhas, paraEditar, pessoas, blocoSocial, galeria,
};
