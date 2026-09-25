#!/usr/bin/env node
/* ==============================================================
   AquaTrip — Dados de demonstração do SIMULADOR
   ==============================================================
   Cria um marketplace pronto para explorar: parceiro aprovado e
   conectado (simulador de Mercado Pago), experiências publicadas com
   horários e um cliente com uma reserva paga.

   Idempotente: rodar de novo não duplica nada.
   Recusa rodar em produção.
   ============================================================== */
require("dotenv").config({ quiet: true });
if (process.env.NODE_ENV === "production") {
  console.error("seed_demo recusado: NODE_ENV=production.");
  process.exit(1);
}
const crypto = require("crypto");
const argon2 = require("argon2");
const db = require("../app/lib/db");
const cofre = require("../app/lib/cofre");
const bookingService = require("../app/services/bookingService");

const SENHA = "Demo12345!";

async function usuario(email, nome) {
  const hash = await argon2.hash(SENHA, { type: argon2.argon2id });
  const novoId = crypto.randomUUID();
  await db.query(
    `INSERT INTO users (id, name, email, password_hash, email_verified_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [novoId, nome, email, hash]
  );
  const { rows } = await db.query(`SELECT id FROM users WHERE email = ?`, [email]);
  return rows[0].id;
}

/* Próximos N dias a partir de amanhã que caem em sábado (6) ou
   domingo (0), às 09h no fuso de Brasília — substitui o
   generate_series() + extract(dow) + AT TIME ZONE do Postgres, que
   não tem equivalente direto no MySQL. O deslocamento de Brasília
   (UTC-3, sem horário de verão desde 2019) é aplicado na mão para
   não depender de tabelas de fuso horário na hora de montar a data. */
function proximosFinsDeSemana(diasAFrente) {
  const datas = [];
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  for (let i = 1; i <= diasAFrente; i++) {
    const d = new Date(hoje);
    d.setDate(d.getDate() + i);
    const diaSemana = d.getDay(); // 0 = domingo, 6 = sábado
    if (diaSemana === 0 || diaSemana === 6) {
      // 09:00 em Brasília = 12:00 UTC (UTC-3 fixo).
      const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
      datas.push(utc);
    }
  }
  return datas;
}

async function main() {
  const parceiroUser = await usuario("parceiro@demo.aquatrip", "Rafael Mendes");
  const clienteUser = await usuario("cliente@demo.aquatrip", "Maria Clara Souza");

  // Parceiro aprovado, conectado ao Mercado Pago SIMULADO.
  let { rows: [p] } = await db.query(`SELECT id FROM partners WHERE user_id = ?`, [parceiroUser]);
  if (!p) {
    const partnerId = crypto.randomUUID();
    await db.query(
      `INSERT INTO partners (id, user_id, person_type, document, legal_name, display_name, phone, city, state,
                             description, status, decided_at, commission_pct)
       VALUES (?, ?, 'PJ', 'DEMOAQUATRIP76', 'Mar de Dentro Turismo Ltda', 'Mar de Dentro', '(12) 99999-0000',
               'Ubatuba', 'SP', 'Passeios de barco e mergulho no litoral norte.', 'APPROVED', CURRENT_TIMESTAMP, 15)`,
      [partnerId, parceiroUser]
    );
    p = { id: partnerId };
  }
  await db.query(
    `UPDATE partners SET mp_user_id = 'demo-9001', mp_connected_at = COALESCE(mp_connected_at, CURRENT_TIMESTAMP),
            mp_access_token_enc = ?, mp_refresh_token_enc = ?, mp_token_expires_at = NOW() + INTERVAL 170 DAY,
            mp_public_key = 'TEST-PUB-demo', mp_live_mode = false
     WHERE id = ?`,
    [
      cofre.cifrar("TEST-SIM-demo-access", { finalidade: "mp-oauth-token", dono: p.id }),
      cofre.cifrar("TG-SIM-demo-refresh", { finalidade: "mp-oauth-token", dono: p.id }),
      p.id,
    ]
  );

  const experiencias = [
    ["mergulho-ilha-anchieta", "Mergulho na Ilha Anchieta", "Ubatuba, SP", "mergulho", 28000,
     "Saída de barco às 8h com instrutor, equipamento completo e dois mergulhos rasos. Duração de 5 horas, lanche incluso."],
    ["caiaque-praia-do-felix", "Caiaque na Praia do Félix", "Ubatuba, SP", "caiaque", 12000,
     "Remada guiada de 2 horas pela costeira, com parada para snorkel. Caiaque, colete e remo inclusos."],
  ];
  for (const [slug, titulo, local, cat, preco, desc] of experiencias) {
    const novoServiceId = crypto.randomUUID();
    await db.query(
      `INSERT INTO services (id, slug, title, location, category, price_cents, description, partner_id, review_status, active)
       VALUES (?,?,?,?,?,?,?,?,'APPROVED',TRUE)
       ON DUPLICATE KEY UPDATE partner_id = VALUES(partner_id)`,
      [novoServiceId, slug, titulo, local, cat, preco, desc, p.id]
    );
    const { rows: [s] } = await db.query(`SELECT id FROM services WHERE slug = ?`, [slug]);

    // Horários: próximos 4 sábados e domingos, 9h (Brasília).
    for (const dataUtc of proximosFinsDeSemana(28)) {
      await db.query(
        `INSERT IGNORE INTO service_slots (id, service_id, starts_at, capacity)
         VALUES (?, ?, ?, 10)`,
        [crypto.randomUUID(), s.id, dataUtc]
      );
    }
  }

  // Uma reserva paga do cliente (divisão simulada: comissão de 15%).
  const { rows: ja } = await db.query(`SELECT 1 FROM bookings WHERE user_id = ? LIMIT 1`, [clienteUser]);
  if (!ja.length) {
    const { rows: [slot] } = await db.query(
      `SELECT sl.id FROM service_slots sl JOIN services s ON s.id = sl.service_id
       WHERE s.slug = 'mergulho-ilha-anchieta' AND sl.starts_at > NOW() ORDER BY sl.starts_at LIMIT 1`
    );
    const b = await bookingService.createBooking({ userId: clienteUser, slotId: slot.id, quantity: 2 });
    await bookingService.startPayment({
      bookingId: b.id, user: { id: clienteUser, role: "USER", email: "cliente@demo.aquatrip", name: "Maria Clara Souza" },
      method: "CREDIT_CARD", cardLastFour: "4242",
    });
  }

  console.log("\nDados de demonstração prontos (senha de todos: " + SENHA + "):");
  console.log("  Parceiro: parceiro@demo.aquatrip  -> /parceiro (experiências, reservas, vendas)");
  console.log("  Cliente:  cliente@demo.aquatrip   -> /minhas-reservas, /ingressos\n");
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.pool.end());
