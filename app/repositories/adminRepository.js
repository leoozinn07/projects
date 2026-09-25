/* ==============================================================
   AquaTrip — Admin Repository
   ==============================================================
   Consultas do painel /admin (unificado com o antigo /gestao). Exibia dados
   inventados; agora leem do banco. Tudo parametrizado.

   Dinheiro sempre em centavos (inteiro). A conversão para "R$"
   acontece só na borda, na hora de exibir.
   ============================================================== */
const crypto = require("crypto");
const db = require("../lib/db");

/* ---------- Métricas do painel ---------- */

async function metrics({ platformFeePercent }) {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM users)                                       AS usuarios,
       (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL 30 DAY)
                                                                            AS usuarios_30d,
       (SELECT COUNT(*) FROM services WHERE active)                       AS experiencias_ativas,
       (SELECT COUNT(*) FROM bookings WHERE status = 'CONFIRMED')         AS reservas_confirmadas,
       (SELECT COUNT(*) FROM bookings WHERE status = 'PENDING'
          AND expires_at > NOW())                                         AS reservas_pendentes,
       (SELECT COALESCE(SUM(amount_cents), 0) FROM payments
          WHERE status = 'APPROVED')                                      AS receita_bruta_cents,
       (SELECT COALESCE(SUM(amount_cents), 0) FROM payments
          WHERE status = 'APPROVED' AND paid_at > NOW() - INTERVAL 30 DAY)
                                                                            AS receita_30d_cents,
       (SELECT COALESCE(SUM(amount_cents), 0) FROM payments
          WHERE status = 'REFUNDED')                                      AS estornado_cents`
  );
  const m = rows[0];
  // Agregados podem voltar como string dependendo do driver — normaliza aqui,
  // de uma vez só, pra quem consome não precisar pensar nisso.
  const bruta = Number(m.receita_bruta_cents);
  return {
    usuarios: Number(m.usuarios),
    usuarios_30d: Number(m.usuarios_30d),
    experiencias_ativas: Number(m.experiencias_ativas),
    reservas_confirmadas: Number(m.reservas_confirmadas),
    reservas_pendentes: Number(m.reservas_pendentes),
    receita_bruta_cents: bruta,
    receita_30d_cents: Number(m.receita_30d_cents),
    estornado_cents: Number(m.estornado_cents),
    taxa_plataforma_cents: Math.round((bruta * platformFeePercent) / 100),
  };
}

/**
 * Receita aprovada por mês, últimos N meses (gráfico do painel).
 * O MySQL não tem generate_series: a lista de meses é montada aqui em JS
 * e viram uma tabela derivada (UNION ALL) que o LEFT JOIN usa como base —
 * assim os meses sem nenhum pagamento aprovado continuam aparecendo com 0.
 */
async function revenueByMonth(months = 6) {
  const agora = new Date();
  const meses = [];
  for (let i = months - 1; i >= 0; i--) {
    meses.push(new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - i, 1)));
  }
  const selects = meses.map(() => "SELECT ? AS m").join(" UNION ALL ");

  const { rows } = await db.query(
    `SELECT DATE_FORMAT(mtab.m, '%Y-%m') AS mes,
            COALESCE(SUM(p.amount_cents), 0) AS receita_cents
     FROM (${selects}) AS mtab
     LEFT JOIN payments p
       ON p.status = 'APPROVED'
      AND DATE_FORMAT(p.paid_at, '%Y-%m') = DATE_FORMAT(mtab.m, '%Y-%m')
     GROUP BY mtab.m
     ORDER BY mtab.m`,
    meses
  );
  return rows.map((r) => ({ mes: r.mes, receita_cents: Number(r.receita_cents) }));
}

/* ---------- Usuários ---------- */

async function listUsers({ busca = null, status = null, limit = 100 } = {}) {
  const cond = [];
  const params = [];
  if (busca) {
    // Collation padrão do banco (utf8mb4_0900_ai_ci) já é case-insensitive,
    // então LIKE simples faz o mesmo papel do ILIKE do Postgres aqui.
    params.push(`%${busca}%`, `%${busca}%`);
    cond.push(`(u.name LIKE ? OR u.email LIKE ?)`);
  }
  if (status) {
    params.push(status);
    cond.push(`u.status = ?`);
  }
  params.push(limit);

  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.suspended_until,
            u.email_verified_at, u.last_login_at, u.created_at,
            (u.last_seen_at > NOW() - INTERVAL 5 MINUTE) AS online,
            (u.totp_enabled_at IS NOT NULL) AS mfa,
            COUNT(CASE WHEN b.status IN ('CONFIRMED','REFUNDED') THEN b.id END) AS reservas
     FROM users u
     LEFT JOIN bookings b ON b.user_id = u.id
     ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT ?`,
    params
  );
  return rows;
}

async function setUserStatus(userId, { status, suspendedUntil = null, reason = null }) {
  const { rowCount } = await db.query(
    `UPDATE users
     SET status = ?,
         suspended_until = CASE WHEN ? = 'SUSPENDED' THEN ? ELSE NULL END,
         suspended_reason = CASE WHEN ? IN ('SUSPENDED', 'BANNED') THEN ? ELSE NULL END
     WHERE id = ?`,
    [status, status, suspendedUntil, status, reason, userId]
  );
  if (!rowCount) return null;
  const { rows } = await db.query(
    `SELECT id, name, email, role, status, suspended_until FROM users WHERE id = ?`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Encerra todas as sessões ativas de um usuário (após suspensão).
 * A sessão é gravada pelo express-mysql-session como JSON em texto (coluna
 * `data`); JSON_EXTRACT/JSON_UNQUOTE fazem o mesmo papel do `sess->'user'->>'id'`
 * do Postgres (que usava jsonb nativo).
 */
async function destroyUserSessions(userId) {
  const { rowCount } = await db.query(
    `DELETE FROM session WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.user.id')) = ?`,
    [userId]
  );
  return rowCount;
}

/* ---------- Experiências ---------- */

async function listServices({ incluirInativas = true } = {}) {
  const { rows } = await db.query(
    `SELECT s.id, s.slug, s.title, s.location, s.category, s.price_cents,
            s.description, s.active, s.created_at, s.cover_alt, s.review_status,
            (SELECT display_name FROM partners WHERE id = s.partner_id) AS parceiro,
            (SELECT storage_key FROM media WHERE id = s.cover_media_id) AS cover_key,
            COALESCE(SUM(sl.capacity), 0) AS capacidade_total,
            (SELECT COALESCE(SUM(x.capacity), 0) FROM service_slots x
              WHERE x.service_id = s.id) AS capacidade_geral,
            (SELECT COALESCE(SUM(b.quantity), 0)
               FROM bookings b
               JOIN service_slots x ON x.id = b.slot_id
              WHERE x.service_id = s.id AND b.status = 'CONFIRMED') AS vendidos,
            (SELECT COALESCE(SUM(p.amount_cents), 0)
               FROM payments p
               JOIN bookings b ON b.id = p.booking_id
               JOIN service_slots x ON x.id = b.slot_id
              WHERE x.service_id = s.id AND p.status = 'APPROVED') AS receita_cents
     FROM services s
     LEFT JOIN service_slots sl ON sl.service_id = s.id AND sl.starts_at > NOW()
     ${incluirInativas ? "" : "WHERE s.active"}
     GROUP BY s.id
     ORDER BY s.created_at DESC`
  );
  return rows.map((r) => ({ ...r, receita_cents: Number(r.receita_cents) }));
}

async function createService({ slug, title, location, category, priceCents, description }) {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO services (id, slug, title, location, category, price_cents, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, slug, title, location, category, priceCents, description]
  );
  const { rows } = await db.query(`SELECT * FROM services WHERE id = ?`, [id]);
  return rows[0];
}

async function updateService(id, { title, location, category, priceCents, description }) {
  const { rowCount } = await db.query(
    `UPDATE services
     SET title = ?, location = ?, category = ?, price_cents = ?, description = ?
     WHERE id = ?`,
    [title, location, category, priceCents, description, id]
  );
  if (!rowCount) return null;
  const { rows } = await db.query(`SELECT * FROM services WHERE id = ?`, [id]);
  return rows[0] || null;
}

async function setServiceActive(id, active) {
  const { rowCount } = await db.query(`UPDATE services SET active = ? WHERE id = ?`, [active, id]);
  if (!rowCount) return null;
  const { rows } = await db.query(`SELECT id, title, active FROM services WHERE id = ?`, [id]);
  return rows[0] || null;
}

/** Reservas vivas que impedem excluir uma experiência. */
async function countLiveBookings(serviceId) {
  const { rows } = await db.query(
    `SELECT COUNT(*) AS n
     FROM bookings b
     JOIN service_slots s ON s.id = b.slot_id
     WHERE s.service_id = ?
       AND (b.status = 'CONFIRMED' OR (b.status = 'PENDING' AND b.expires_at > NOW()))`,
    [serviceId]
  );
  return rows[0].n;
}

async function slugExists(slug) {
  const { rows } = await db.query(`SELECT 1 FROM services WHERE slug = ?`, [slug]);
  return rows.length > 0;
}

/* ---------- Horários ----------
   Datas e horas chegam como texto no fuso de operação (Brasília) e
   são convertidas pelo PRÓPRIO banco com CONVERT_TZ (equivalente ao
   AT TIME ZONE do Postgres). Banco e servidor rodam em UTC: sem essa
   conversão explícita, a saída das 9h digitada pelo admin viraria 6h
   para o cliente. CONVERT_TZ depende das tabelas de fuso horário do
   MySQL estarem carregadas (mysql_tzinfo_to_sql) — ver README. */
const FUSO = process.env.OPERATION_TIMEZONE || "America/Sao_Paulo";

async function listSlots(serviceId) {
  const { rows } = await db.query(
    `SELECT s.id, s.starts_at, s.capacity,
            DATE_FORMAT(CONVERT_TZ(s.starts_at, 'UTC', ?), '%Y-%m-%d') AS data_local,
            DATE_FORMAT(CONVERT_TZ(s.starts_at, 'UTC', ?), '%H:%i')    AS hora_local,
            COALESCE(SUM(CASE WHEN
              b.status = 'CONFIRMED'
                 OR (b.status = 'PENDING' AND b.expires_at > NOW())
              THEN b.quantity END), 0) AS ocupados
     FROM service_slots s
     LEFT JOIN bookings b ON b.slot_id = s.id
     WHERE s.service_id = ? AND s.starts_at > NOW()
     GROUP BY s.id
     ORDER BY s.starts_at
     LIMIT 500`,
    [FUSO, FUSO, serviceId]
  );
  return rows;
}

/**
 * Cria horários em lote. Recebe combinações (data local, hora local) já
 * expandidas. O Postgres fazia tudo numa única instrução com unnest();
 * o MySQL não tem unnest, então aqui: (1) converte todos os horários
 * locais para UTC numa única consulta (tabela derivada via UNION ALL),
 * e (2) insere um a um com INSERT IGNORE — equivalente ao ON CONFLICT
 * DO NOTHING do Postgres, a UNIQUE (service_id, starts_at) garante que
 * rodar a mesma programação duas vezes não duplica nada. É mais round-trips
 * que o INSERT...SELECT original, mas essa rotina só roda no painel admin,
 * nunca no fluxo de reserva do cliente — não é caminho de performance crítica.
 */
async function createSlots(serviceId, combinacoes, capacidade) {
  if (!combinacoes.length) return [];

  const locais = combinacoes.map((c) => `${c.data} ${c.hora}:00`);
  const selects = locais.map(() => "SELECT ? AS d").join(" UNION ALL ");
  const { rows: convertidos } = await db.query(
    `SELECT t.d AS local_dt, CONVERT_TZ(t.d, ?, 'UTC') AS starts_at
     FROM (${selects}) AS t`,
    [FUSO, ...locais]
  );

  const criados = [];
  for (const { starts_at: startsAt } of convertidos) {
    if (!startsAt || new Date(startsAt) <= new Date()) continue;

    const id = crypto.randomUUID();
    const { rowCount } = await db.query(
      `INSERT IGNORE INTO service_slots (id, service_id, starts_at, capacity)
       VALUES (?, ?, ?, ?)`,
      [id, serviceId, startsAt, capacidade]
    );
    if (rowCount) criados.push({ id, starts_at: startsAt });
  }
  return criados;
}

/** Ocupação de um horário (reservas confirmadas e pendentes vivas). */
async function slotUsage(slotId) {
  const { rows } = await db.query(
    `SELECT s.id, s.service_id, s.capacity, s.starts_at,
            COALESCE(SUM(CASE WHEN
              b.status = 'CONFIRMED'
                 OR (b.status = 'PENDING' AND b.expires_at > NOW())
              THEN b.quantity END), 0) AS ocupados,
            COUNT(b.id) AS reservas_historicas
     FROM service_slots s
     LEFT JOIN bookings b ON b.slot_id = s.id
     WHERE s.id = ?
     GROUP BY s.id`,
    [slotId]
  );
  return rows[0] || null;
}

async function updateSlotCapacity(slotId, capacidade) {
  const { rowCount } = await db.query(`UPDATE service_slots SET capacity = ? WHERE id = ?`, [
    capacidade,
    slotId,
  ]);
  if (!rowCount) return null;
  const { rows } = await db.query(`SELECT id, capacity FROM service_slots WHERE id = ?`, [slotId]);
  return rows[0] || null;
}

async function deleteSlot(slotId) {
  const { rowCount } = await db.query(`DELETE FROM service_slots WHERE id = ?`, [slotId]);
  return rowCount > 0;
}

/* ---------- Integridade ----------
   Estados que nunca deveriam coexistir. Se aparecerem, algum bug
   (atual ou passado) deixou o banco inconsistente — e o painel
   precisa mostrar, não esconder. */
async function inconsistencies() {
  const { rows } = await db.query(
    `SELECT 'PAGO_SEM_CONFIRMACAO' AS tipo, b.id AS booking_id, p.id AS payment_id,
            p.amount_cents, u.email, b.status AS reserva, p.status AS pagamento,
            p.paid_at AS desde
     FROM payments p
     JOIN bookings b ON b.id = p.booking_id
     JOIN users u    ON u.id = b.user_id
     WHERE p.status = 'APPROVED' AND b.status <> 'CONFIRMED'
     UNION ALL
     SELECT 'CONFIRMADA_SEM_PAGAMENTO', b.id, NULL, b.amount_cents, u.email,
            b.status, NULL, b.confirmed_at
     FROM bookings b
     JOIN users u ON u.id = b.user_id
     WHERE b.status = 'CONFIRMED'
       -- Participação gratuita (R$ 0) é confirmada sem pagamento, por definição.
       AND b.amount_cents > 0
       AND NOT EXISTS (SELECT 1 FROM payments p
                       WHERE p.booking_id = b.id AND p.status = 'APPROVED')
     -- MySQL não tem NULLS LAST: (desde IS NULL) empurra os nulos pro fim.
     ORDER BY (desde IS NULL), desde`
  );
  return rows;
}

/* ---------- Transações ---------- */

async function listTransactions({ status = null, dias = null, limit = 200 } = {}) {
  const cond = [];
  const params = [];
  if (status) {
    params.push(status);
    cond.push(`p.status = ?`);
  }
  if (dias) {
    params.push(Number(dias));
    cond.push(`p.created_at > NOW() - INTERVAL ? DAY`);
  }
  params.push(limit);

  const { rows } = await db.query(
    `SELECT p.id, p.status, p.method, p.amount_cents, p.installments,
            p.provider, p.paid_at, p.refunded_at, p.created_at,
            b.id AS booking_id, u.name AS cliente, u.email AS cliente_email,
            sv.title AS experiencia
     FROM payments p
     JOIN bookings b      ON b.id = p.booking_id
     JOIN users u         ON u.id = b.user_id
     JOIN service_slots s ON s.id = b.slot_id
     JOIN services sv     ON sv.id = s.service_id
     ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
     ORDER BY p.created_at DESC
     LIMIT ?`,
    params
  );
  return rows;
}

/* ---------- Comunidade, presença e visão geral ---------- */

/** Números da plataforma que vão além do financeiro. Tudo COUNT real. */
async function platformCounts() {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE last_seen_at > NOW() - INTERVAL 5 MINUTE)          AS online_agora,
       (SELECT COUNT(*) FROM users WHERE last_seen_at > NOW() - INTERVAL 24 HOUR)           AS ativos_24h,
       (SELECT COUNT(*) FROM users WHERE status = 'SUSPENDED')                               AS usuarios_suspensos,
       (SELECT COUNT(*) FROM users WHERE status = 'BANNED')                                  AS usuarios_banidos,
       (SELECT COUNT(*) FROM partners WHERE status = 'APPROVED')                             AS parceiros_aprovados,
       (SELECT COUNT(*) FROM partners WHERE status = 'PENDING')                              AS parceiros_pendentes,
       (SELECT COUNT(*) FROM services)                                                       AS experiencias_total,
       (SELECT COUNT(*) FROM services WHERE creator_user_id IS NOT NULL)                     AS experiencias_comunidade,
       (SELECT COUNT(*) FROM services WHERE moderation_status <> 'ACTIVE')                   AS experiencias_moderadas,
       (SELECT COALESCE(SUM(quantity), 0) FROM bookings WHERE status = 'CONFIRMED')          AS participantes,
       (SELECT COUNT(*) FROM experience_reports WHERE status = 'OPEN')                       AS denuncias_abertas,
       (SELECT COUNT(*) FROM platform_feedback WHERE kind = 'COMPLAINT'
          AND status IN ('OPEN', 'IN_PROGRESS'))                                             AS reclamacoes_abertas,
       (SELECT COUNT(*) FROM reviews WHERE status = 'VISIBLE')                               AS avaliacoes_experiencias,
       (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE status = 'VISIBLE')                  AS nota_media_experiencias,
       (SELECT COUNT(*) FROM platform_feedback WHERE kind = 'RATING')                        AS avaliacoes_plataforma,
       (SELECT ROUND(AVG(rating), 1) FROM platform_feedback WHERE kind = 'RATING')           AS nota_media_plataforma,
       (SELECT COUNT(*) FROM experience_comments WHERE status = 'VISIBLE')                   AS comentarios,
       (SELECT COUNT(*) FROM experience_likes)                                               AS curtidas,
       (SELECT COUNT(*) FROM user_follows)                                                   AS conexoes`
  );
  const r = rows[0];
  const out = {};
  for (const [k, v] of Object.entries(r)) out[k] = v == null ? null : Number(v);
  return out;
}

/** Cadastro completo para moderação. Só o painel admin chama isto. */
async function userDetail(userId) {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.suspended_until, u.suspended_reason,
            u.email_verified_at, u.last_login_at, u.last_seen_at, u.created_at, u.anonymized_at,
            u.bio, u.locale, u.terms_version, u.terms_accepted_at,
            (u.totp_enabled_at IS NOT NULL) AS mfa,
            (u.last_seen_at > NOW() - INTERVAL 5 MINUTE) AS online,
            (SELECT storage_key FROM media WHERE id = u.avatar_media_id) AS avatar_key,
            pa.person_type, pa.document, pa.legal_name, pa.display_name AS parceiro_nome,
            pa.phone, pa.city, pa.state, pa.status AS parceiro_status,
            (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.status = 'CONFIRMED') AS reservas_confirmadas,
            (SELECT COUNT(*) FROM user_follows WHERE followee_id = u.id) AS seguidores,
            (SELECT COUNT(*) FROM user_follows WHERE follower_id = u.id) AS seguindo,
            (SELECT COUNT(*) FROM experience_comments WHERE user_id = u.id) AS comentarios_feitos,
            (SELECT COUNT(*) FROM experience_reports r JOIN services s ON s.id = r.service_id
               WHERE s.creator_user_id = u.id) AS denuncias_recebidas
     FROM users u LEFT JOIN partners pa ON pa.user_id = u.id
     WHERE u.id = ?`,
    [userId]
  );
  if (!rows[0]) return null;
  const { rows: experiencias } = await db.query(
    `SELECT s.id, s.slug, s.title, s.location, s.price_cents, s.active, s.moderation_status, s.created_at,
            (SELECT MIN(starts_at) FROM service_slots WHERE service_id = s.id) AS starts_at
     FROM services s WHERE s.creator_user_id = ? ORDER BY s.created_at DESC`,
    [userId]
  );
  return { ...rows[0], experiencias };
}

/** Experiências da comunidade e de parceiros (ambas publicam na hora e
    são moderadas depois), com o que a moderação precisa ver. */
async function listCommunityServices({ busca = null, status = null, comDenuncia = false } = {}) {
  const cond = ["(s.creator_user_id IS NOT NULL OR s.partner_id IS NOT NULL)"];
  const params = [FUSO];
  if (busca) {
    cond.push("(s.title LIKE ? OR s.location LIKE ? OR u.name LIKE ? OR u.email LIKE ?)");
    params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`);
  }
  if (status) { cond.push("s.moderation_status = ?"); params.push(status); }
  if (comDenuncia) cond.push("EXISTS (SELECT 1 FROM experience_reports r WHERE r.service_id = s.id AND r.status = 'OPEN')");
  const { rows } = await db.query(
    `SELECT s.id, s.slug, s.title, s.location, s.category, s.price_cents, s.active,
            CASE WHEN s.creator_user_id IS NOT NULL THEN 'comunidade' ELSE 'parceiro' END AS origem,
            pa.display_name AS parceiro_nome,
            s.moderation_status, s.moderation_reason, s.moderated_at, s.created_at,
            u.id AS criador_id, u.name AS criador_nome, u.email AS criador_email, u.status AS criador_status,
            sl.starts_at, CONVERT_TZ(sl.starts_at, 'UTC', ?) AS starts_local, sl.capacity,
            (SELECT COALESCE(SUM(b.quantity), 0) FROM bookings b WHERE b.slot_id = sl.id AND b.status = 'CONFIRMED') AS participantes,
            (SELECT COUNT(*) FROM experience_interests i WHERE i.service_id = s.id) AS interessados,
            (SELECT COUNT(*) FROM experience_likes l WHERE l.service_id = s.id) AS curtidas,
            (SELECT COUNT(*) FROM experience_comments c WHERE c.service_id = s.id) AS comentarios,
            (SELECT COUNT(*) FROM experience_reports r WHERE r.service_id = s.id AND r.status = 'OPEN') AS denuncias_abertas,
            (SELECT COUNT(*) FROM experience_reports r WHERE r.service_id = s.id) AS denuncias_total
     FROM services s
     LEFT JOIN partners pa ON pa.id = s.partner_id
     JOIN users u ON u.id = COALESCE(s.creator_user_id, pa.user_id)
     -- Parceiro tem vários horários: a moderação vê o próximo (ou o último).
     LEFT JOIN service_slots sl ON sl.id = (
       SELECT x.id FROM service_slots x WHERE x.service_id = s.id
       ORDER BY (x.starts_at < NOW()), CASE WHEN x.starts_at >= NOW() THEN x.starts_at END, x.starts_at DESC LIMIT 1)
     WHERE ${cond.join(" AND ")}
     ORDER BY denuncias_abertas DESC, s.created_at DESC
     LIMIT 300`,
    params
  );
  return rows.map((r) => ({
    ...r,
    participantes: Number(r.participantes), interessados: Number(r.interessados),
    curtidas: Number(r.curtidas), comentarios: Number(r.comentarios),
    denuncias_abertas: Number(r.denuncias_abertas), denuncias_total: Number(r.denuncias_total),
  }));
}

async function setServiceModeration(serviceId, { status, reason, adminId }) {
  const { rowCount } = await db.query(
    `UPDATE services
     SET moderation_status = ?, moderation_reason = ?, moderated_by = ?, moderated_at = NOW(6)
     WHERE id = ?`,
    [status, status === "ACTIVE" ? null : reason, adminId, serviceId]
  );
  return rowCount > 0;
}

async function listReports(serviceId) {
  const { rows } = await db.query(
    `SELECT r.id, r.reason, r.details, r.status, r.created_at, r.handled_at,
            u.name AS denunciante
     FROM experience_reports r JOIN users u ON u.id = r.reporter_id
     WHERE r.service_id = ? ORDER BY r.created_at DESC`,
    [serviceId]
  );
  return rows;
}

async function closeReports(serviceId, { status, adminId }) {
  const { rowCount } = await db.query(
    `UPDATE experience_reports SET status = ?, handled_by = ?, handled_at = NOW(6)
     WHERE service_id = ? AND status = 'OPEN'`,
    [status, adminId, serviceId]
  );
  return rowCount;
}

async function listServiceComments(serviceId) {
  const { rows } = await db.query(
    `SELECT c.id, c.body, c.status, c.hidden_reason, c.created_at, u.id AS autor_id, u.name AS autor
     FROM experience_comments c JOIN users u ON u.id = c.user_id
     WHERE c.service_id = ? ORDER BY c.created_at DESC LIMIT 200`,
    [serviceId]
  );
  return rows;
}

async function setCommentStatus(commentId, { hidden, reason, adminId }) {
  const { rowCount } = await db.query(
    `UPDATE experience_comments SET status = ?, hidden_reason = ?, hidden_by = ? WHERE id = ?`,
    [hidden ? "HIDDEN" : "VISIBLE", hidden ? reason : null, hidden ? adminId : null, commentId]
  );
  return rowCount > 0;
}

/** Banir a conta tira do ar o que ela publicou (estado, não exclusão). */
async function moderateServicesOfCreator(userId, { reason, adminId }) {
  const { rowCount } = await db.query(
    `UPDATE services SET moderation_status = 'BANNED', moderation_reason = ?, moderated_by = ?, moderated_at = NOW(6)
     WHERE creator_user_id = ? AND moderation_status <> 'BANNED'`,
    [reason, adminId, userId]
  );
  return rowCount;
}

module.exports = {
  metrics,
  revenueByMonth,
  listUsers,
  setUserStatus,
  destroyUserSessions,
  listServices,
  createService,
  updateService,
  setServiceActive,
  countLiveBookings,
  slugExists,
  listTransactions,
  inconsistencies,
  FUSO,
  listSlots,
  createSlots,
  slotUsage,
  updateSlotCapacity,
  deleteSlot,
  platformCounts,
  userDetail,
  listCommunityServices,
  setServiceModeration,
  listReports,
  closeReports,
  listServiceComments,
  setCommentStatus,
  moderateServicesOfCreator,
};
