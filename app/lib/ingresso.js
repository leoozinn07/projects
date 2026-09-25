/* ==============================================================
   AquaTrip — Código do ingresso
   Derivado da reserva por HMAC: estável (o mesmo ingresso sempre
   mostra o mesmo código), curto para ser lido em voz alta no local,
   e não permite chegar ao id da reserva a partir do código.
   Compartilhado entre o cliente (Ingressos) e o parceiro (conferência
   na chegada) — as duas pontas precisam ver o MESMO código.
   ============================================================== */
const crypto = require("crypto");

function codigoIngresso(bookingId) {
  const segredo = process.env.SESSION_SECRET || "aquatrip";
  const h = crypto.createHmac("sha256", segredo).update(String(bookingId)).digest("hex").toUpperCase();
  return `${h.slice(0, 3)}-${h.slice(3, 7)}`;
}

module.exports = { codigoIngresso };
