/* ==============================================================
   AquaTrip — Seed de serviços e horários de exemplo
   Cria experiências reserváveis com slots nos próximos dias, para
   que o fluxo de reserva possa ser testado de ponta a ponta.
   Uso: npm run db:seed:services
   ============================================================== */
require("dotenv").config({ quiet: true });
const crypto = require("crypto");
const db = require("../app/lib/db");

const SERVICES = [
  { slug: "mergulho-noronha", title: "Batismo de mergulho em Fernando de Noronha", location: "Fernando de Noronha, PE", category: "mergulho", price_cents: 65000 },
  { slug: "aquario-santos",   title: "Visita ao Aquário de Santos",                location: "Santos, SP",               category: "aquario",  price_cents: 6000 },
  { slug: "caiaque-ilhabela", title: "Caiaque ao pôr do sol em Ilhabela",          location: "Ilhabela, SP",             category: "caiaque",  price_cents: 9500 },
  { slug: "pesca-rio-negro",  title: "Pesca esportiva no Rio Negro",               location: "Manaus, AM",               category: "pesca",    price_cents: 42000 },
];

/* Meia-noite de hoje (fuso do servidor) + N dias + H horas, como
   objeto Date — substitui o date_trunc('day', now()) + interval do
   Postgres, que não tem equivalente direto simples no MySQL. */
function dataSlot(diasAFrente, hora) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + diasAFrente);
  d.setHours(hora);
  return d;
}

async function seed() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    for (const s of SERVICES) {
      const novoId = crypto.randomUUID();
      await client.query(
        `INSERT INTO services (id, slug, title, location, category, price_cents)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE title = VALUES(title)`,
        [novoId, s.slug, s.title, s.location, s.category, s.price_cents]
      );
      const { rows } = await client.query(
        `SELECT id, slug FROM services WHERE slug = ?`,
        [s.slug]
      );
      const serviceId = rows[0].id;

      // Slots: próximos 7 dias, às 09h e 14h.
      for (let day = 1; day <= 7; day++) {
        for (const hour of [9, 14]) {
          await client.query(
            `INSERT IGNORE INTO service_slots (id, service_id, starts_at, capacity)
             VALUES (?, ?, ?, ?)`,
            [crypto.randomUUID(), serviceId, dataSlot(day, hour), 10]
          );
        }
      }
      console.log(`[seed] serviço pronto: ${rows[0].slug}`);
    }

    await client.query("COMMIT");
    console.log("[seed] serviços e horários criados.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

seed()
  .catch((err) => { console.error("[seed] erro:", err); process.exit(1); })
  .finally(() => db.pool.end());
