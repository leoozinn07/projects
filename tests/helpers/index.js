/* ==============================================================
   AquaTrip — Helpers de teste
   Evita repetir setup em toda suíte: limpar banco, criar usuário,
   logar e extrair token CSRF.
   ============================================================== */
const crypto = require("crypto");
const request = require("supertest");
const argon2 = require("argon2");
const db = require("../../app/lib/db");
const app = require("../../app");

/**
 * Limpa as tabelas transacionais entre testes.
 * TRUNCATE deixa o banco no mesmo estado de um banco recém-migrado,
 * sem precisar recriar o schema. Diferente do Postgres, o MySQL não
 * tem "TRUNCATE ... CASCADE" nem TRUNCATE de várias tabelas numa
 * instrução só — por isso truncamos uma a uma, com as checagens de
 * chave estrangeira desligadas durante o processo (senão a ordem das
 * tabelas com FK entre si bloquearia o TRUNCATE).
 *
 * A lista é filtrada pelas tabelas que realmente existem: `session`
 * é criada pelo express-mysql-session no primeiro boot, então pode
 * ainda não estar lá quando a suíte roda pela primeira vez.
 */
async function resetDatabase() {
  const candidates = [
    "webhook_events",
    "payments",
    "bookings",
    "service_slots",
    "services",
    "audit_log",
    "email_log",
    "users",
    "session",
    "media",
    "review_photos",
    "reviews",
    "recovery_codes",
    "password_reset_tokens",
    "email_verification_tokens",
    "trips",
    "consent_records",
    "data_requests",
    "contact_messages",
    "partners",
    "service_photos",
    "experience_likes",
    "experience_comments",
    "user_follows",
    "experience_interests",
    "experience_reports",
    "platform_feedback",
    "chat_usage",
  ];

  const placeholders = candidates.map(() => "?").join(", ");
  const { rows } = await db.query(
    `SELECT table_name AS tablename FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name IN (${placeholders})`,
    candidates
  );
  if (!rows.length) return;

  await db.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const { tablename } of rows) {
      await db.query(`TRUNCATE TABLE \`${tablename}\``);
    }
  } finally {
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
  }
}

/**
 * Limpa tabelas extras que testes específicos usam além das cobertas por
 * resetDatabase() (ex.: partners, trips, consent_records). Substitui o
 * antigo `TRUNCATE a, b RESTART IDENTITY CASCADE` do Postgres: no MySQL
 * truncamos uma tabela por vez, com FK checks desligados.
 */
async function truncateTables(...tables) {
  await db.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const t of tables) {
      await db.query(`TRUNCATE TABLE \`${t}\``);
    }
  } finally {
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
  }
}

async function createUser({
  name = "Usuário Teste",
  email = "teste@aquatrip.local",
  password = "SenhaForte123!",
  role = "USER",
} = {}) {
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const id = crypto.randomUUID();
  const normalizedEmail = email.toLowerCase();
  await db.query(
    `INSERT INTO users (id, name, email, password_hash, role)
     VALUES (?, ?, ?, ?, ?)`,
    [id, name, normalizedEmail, hash, role]
  );
  return { id, name, email: normalizedEmail, role, password };
}

/** Cria um serviço com um slot futuro disponível. */
async function createServiceWithSlot({
  slug = "teste-experiencia",
  title = "Experiência de Teste",
  priceCents = 10000,
  capacity = 5,
  hoursFromNow = 48,
} = {}) {
  const serviceId = crypto.randomUUID();
  await db.query(
    `INSERT INTO services (id, slug, title, location, category, price_cents)
     VALUES (?, ?, ?, 'Local Teste', 'mergulho', ?)`,
    [serviceId, slug, title, priceCents]
  );
  const { rows: sRows } = await db.query(`SELECT * FROM services WHERE id = ?`, [serviceId]);
  const service = sRows[0];

  const slotId = crypto.randomUUID();
  const startsAt = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO service_slots (id, service_id, starts_at, capacity)
     VALUES (?, ?, ?, ?)`,
    [slotId, service.id, startsAt, capacity]
  );
  const { rows: slotRows } = await db.query(`SELECT * FROM service_slots WHERE id = ?`, [slotId]);

  return { service, slot: slotRows[0] };
}

/** Extrai o token CSRF de uma página HTML renderizada. */
function extractCsrf(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Devolve um agente do Supertest já autenticado (cookie de sessão
 * preservado entre requisições) junto do token CSRF atual.
 */
async function loginAs(user) {
  const agent = request.agent(app);

  const loginPage = await agent.get("/login");
  const csrf = extractCsrf(loginPage.text);

  await agent
    .post("/login")
    .type("form")
    .send({ email: user.email, senha: user.password, redirect: "/", _csrf: csrf });

  // O login regenera a sessão (anti session fixation), então o token
  // CSRF anterior morre junto. Pegamos um novo depois de autenticar.
  const home = await agent.get("/");
  return { agent, csrf: extractCsrf(home.text) };
}

/** Busca um token CSRF fresco para um agente já logado. */
async function freshCsrf(agent, path = "/minhas-reservas") {
  const page = await agent.get(path);
  return extractCsrf(page.text);
}

module.exports = {
  app,
  db,
  resetDatabase,
  truncateTables,
  createUser,
  createServiceWithSlot,
  extractCsrf,
  loginAs,
  freshCsrf,
};
