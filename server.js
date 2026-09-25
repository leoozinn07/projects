/* ==============================================================
   AquaTrip — Ponto de entrada do servidor
   app.js monta a aplicação; este arquivo é o único que abre porta
   e liga jobs. Isso mantém o app importável pelos testes.
   ============================================================== */
require("dotenv").config({ quiet: true });

const app = require("./app");
const logger = require("./app/lib/logger");
const db = require("./app/lib/db");
const bookingService = require("./app/services/bookingService");

const port = process.env.PORT || 3000;

/* Falha cedo: configuração de segurança inválida impede a subida,
   em vez de estourar no primeiro login de um administrador. */
try {
  require("./app/services/twoFactorService").validarConfiguracao();
} catch (err) {
  logger.fatal({ err }, "configuração de 2FA inválida — o servidor não vai subir");
  process.exit(1);
}

/* JOB — expiração de reservas pendentes.
   Libera a vaga de quem criou a reserva e não pagou dentro do prazo.
   A disponibilidade já ignora pendências vencidas na própria consulta,
   então este job é a limpeza durável do status, não a única defesa. */
const EXPIRE_INTERVAL_MS = 60 * 1000;
const expireTimer = setInterval(() => {
  bookingService
    .expirePendingBookings()
    .catch((err) => logger.error({ err, job: "expirar-reservas" }, "falha ao expirar reservas"));
}, EXPIRE_INTERVAL_MS);

const server = app.listen(port, () => {
  logger.info({ port }, `servidor ouvindo em http://localhost:${port}`);
});

/* Shutdown gracioso: para de aceitar conexões novas, termina as em
   andamento e fecha o pool do banco. Sem isso, um deploy no meio de
   uma transação de pagamento pode deixar estado inconsistente. */
function shutdown(signal) {
  logger.info({ signal }, "encerrando");
  clearInterval(expireTimer);
  server.close(async () => {
    try {
      await db.end();
    } catch (err) {
      logger.error({ err }, "erro ao fechar pool");
    }
    process.exit(0);
  });
  // Rede de segurança: não travar para sempre se alguma conexão pendurar.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/* Falha que escapou de todo tratamento: registra com contexto antes
   de encerrar. Continuar rodando depois de uma exceção não tratada
   deixa o processo em estado desconhecido — o certo é cair e deixar
   o orquestrador subir outro. */
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "exceção não tratada — encerrando");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "promise rejeitada sem tratamento — encerrando");
  process.exit(1);
});
