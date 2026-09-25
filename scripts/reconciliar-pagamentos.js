#!/usr/bin/env node
/* ==============================================================
   AquaTrip — Reconciliação de pagamentos
   ==============================================================
   Corrige reservas cujo pagamento foi APROVADO mas que não ficaram
   CONFIRMED — o estado que o bug da Fase 4 deixava para trás.

   Uso:
     npm run pagamentos:reconciliar            # só mostra (padrão)
     npm run pagamentos:reconciliar -- --aplicar

   Por que simula por padrão: alterar estado de reserva paga é
   operação sobre dinheiro de cliente. Primeiro se olha, depois se
   aplica — nunca o contrário.

   Conflito de capacidade: se a vaga dessa reserva já foi vendida a
   outra pessoa enquanto ela estava presa em PENDING, confirmar agora
   causaria overbooking. Esses casos NÃO são confirmados
   automaticamente — são listados para decisão humana (confirmar
   mesmo assim ou estornar). A máquina não decide sozinha quem fica
   sem vaga.
   ============================================================== */
require("dotenv").config({ quiet: true });
const db = require("../app/lib/db");
const auditService = require("../app/services/auditService");

const APLICAR = process.argv.includes("--aplicar");

function brl(c) {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function main() {
  const { rows } = await db.query(
    `SELECT b.id AS booking_id, b.status, b.quantity, b.slot_id,
            p.id AS payment_id, p.amount_cents, p.paid_at,
            u.email, s.capacity, s.starts_at,
            (SELECT COALESCE(SUM(o.quantity), 0) FROM bookings o
              WHERE o.slot_id = b.slot_id AND o.id <> b.id
                AND (o.status = 'CONFIRMED'
                     OR (o.status = 'PENDING' AND o.expires_at > NOW()))) AS ocupado
     FROM payments p
     JOIN bookings b      ON b.id = p.booking_id
     JOIN users u         ON u.id = b.user_id
     JOIN service_slots s ON s.id = b.slot_id
     WHERE p.status = 'APPROVED' AND b.status <> 'CONFIRMED'
     ORDER BY p.paid_at`
  );
  for (const r of rows) r.ocupado = Number(r.ocupado);

  console.log(`\nModo: ${APLICAR ? "APLICAR" : "SIMULAÇÃO (nada será alterado)"}`);
  console.log(`Pagamentos aprovados sem reserva confirmada: ${rows.length}\n`);

  if (!rows.length) {
    console.log("Nada a reconciliar. Banco consistente.\n");
    return;
  }

  let corrigidos = 0;
  const paraDecisao = [];

  for (const r of rows) {
    const cabe = r.ocupado + r.quantity <= r.capacity;
    const linha = `  ${r.booking_id.slice(0, 8)}  ${r.email.padEnd(32)} ${brl(r.amount_cents).padStart(12)}  reserva=${r.status}`;

    if (!cabe) {
      paraDecisao.push({ ...r, linha });
      continue;
    }

    if (APLICAR) {
      // Transição condicional: se outro processo já corrigiu no
      // meio do caminho, o UPDATE simplesmente não afeta nada.
      const { rowCount } = await db.query(
        `UPDATE bookings
         SET status = 'CONFIRMED', confirmed_at = COALESCE(confirmed_at, NOW()), expires_at = NULL
         WHERE id = $1 AND status <> 'CONFIRMED'`,
        [r.booking_id]
      );
      if (rowCount) {
        corrigidos++;
        await auditService.log(auditService.AuditAction.BOOKING_RECONCILED, {
          metadata: {
            bookingId: r.booking_id,
            paymentId: r.payment_id,
            statusAnterior: r.status,
            valorCentavos: r.amount_cents,
            origem: "script de reconciliacao",
          },
        });
        console.log(`${linha}  -> CONFIRMADA`);
      }
    } else {
      console.log(`${linha}  -> seria confirmada`);
    }
  }

  if (paraDecisao.length) {
    console.log(`\nPrecisam de decisão humana (${paraDecisao.length}) — confirmar causaria overbooking:`);
    for (const r of paraDecisao) {
      console.log(`${r.linha}  vagas: ${r.ocupado}/${r.capacity} ocupadas, pede ${r.quantity}`);
    }
    console.log("  Opções: estornar pelo painel do gateway, ou ampliar a capacidade do horário e rodar de novo.");
  }

  console.log(
    APLICAR
      ? `\n${corrigidos} reserva(s) confirmada(s). Cada correção ficou registrada na auditoria.\n`
      : "\nNada foi alterado. Rode com --aplicar para corrigir.\n"
  );
}

main()
  .catch((err) => {
    console.error("Erro na reconciliação:", err);
    process.exitCode = 1;
  })
  .finally(() => db.end());
