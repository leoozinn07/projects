/* ==============================================================
   AquaTrip — Presença (usuários online)
   ==============================================================
   Marca users.last_seen_at a cada requisição autenticada, no máximo
   uma vez por minuto por sessão (o carimbo da última gravação fica
   na própria sessão). "Online" no painel = visto nos últimos 5 min.
   Falha aqui nunca derruba a requisição: presença é informativa.
   ============================================================== */
const db = require("../lib/db");
const log = require("../lib/logger").forModule("presenca");

const INTERVALO_MS = 60 * 1000;
const JANELA_ONLINE_MIN = 5;

function registrarPresenca(req, res, next) {
  const user = req.session && req.session.user;
  if (!user) return next();
  const agora = Date.now();
  if (req.session.presencaEm && agora - req.session.presencaEm < INTERVALO_MS) return next();
  req.session.presencaEm = agora;
  db.query(`UPDATE users SET last_seen_at = NOW(6) WHERE id = ?`, [user.id])
    .catch((err) => log.warn({ err }, "falha ao registrar presença"));
  next();
}

module.exports = { registrarPresenca, JANELA_ONLINE_MIN };
