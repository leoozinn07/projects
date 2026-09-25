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
         suspended_reason = CASE WHEN ? = 'SUSPENDED' THEN ? ELSE NULL END
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
};
