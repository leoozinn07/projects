/* ==============================================================
   AquaTrip — Logger estruturado
   ==============================================================
   Substitui console.log/error. Por que isso importa:

   - console.error("falhou", err) vira uma linha solta que ninguém
     encontra às 3h da manhã. Log estruturado (JSON) pode ser
     filtrado: "todos os erros do webhook de pagamento na última
     hora", "tudo que aconteceu na requisição X".
   - Cada linha carrega o requestId: dá para seguir uma requisição
     do começo ao fim, mesmo com várias acontecendo ao mesmo tempo.
   - Redação automática: senha, token, cookie e dado de cartão são
     substituídos por [REDACTED] ANTES de chegar ao log, mesmo que
     alguém passe o objeto inteiro por descuido.

   Em desenvolvimento, sai colorido e legível (pino-pretty).
   Em produção, sai JSON puro — o formato que agregadores de log
   (Datadog, Loki, CloudWatch, Grafana) consomem direto.
   ============================================================== */
const pino = require("pino");

const isProd = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

/* Caminhos que nunca podem aparecer em log. O pino substitui o valor
   antes de serializar — não depende de disciplina de quem escreve o
   log. */
const REDACT = [
  "password",
  "senha",
  "*.password",
  "*.senha",
  "*.password_hash",
  "*.passwordHash",
  "*.token",
  "*.cardToken",
  "*.card_number",
  "*.cvv",
  "*.securityCode",
  "*._csrf",
  "req.headers.cookie",
  "req.headers.authorization",
  'req.headers["x-signature"]',
  'req.headers["x-aquatrip-signature"]',
  'res.headers["set-cookie"]',
  "body.senha",
  "body.password",
  "body._csrf",
  'body["confirma-senha"]',
];

function buildTransport() {
  if (isProd || isTest) return undefined;
  try {
    require.resolve("pino-pretty");
    return {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
    };
  } catch {
    return undefined; // sem pino-pretty instalado, cai no JSON
  }
}

const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? "silent" : isProd ? "info" : "debug"),
  base: { app: "aquatrip", env: process.env.NODE_ENV || "development" },
  redact: { paths: REDACT, censor: "[REDACTED]" },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: buildTransport(),
});

/** Logger filho com contexto fixo, ex.: logger.child({ modulo: "pagamentos" }). */
function forModule(modulo) {
  return logger.child({ modulo });
}

module.exports = logger;
module.exports.forModule = forModule;
module.exports.REDACT = REDACT;
