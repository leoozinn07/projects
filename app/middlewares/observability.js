/* ==============================================================
   AquaTrip — Observabilidade HTTP
   ==============================================================
   1) requestId: cada requisição ganha um id único, devolvido no
      header X-Request-Id e anexado a toda linha de log daquela
      requisição. Quando um usuário relata "deu erro", ele vê esse
      id na página de erro, você procura no log e acha exatamente
      o que aconteceu — sem adivinhar pelo horário.

   2) Se quem chama já manda X-Request-Id (um load balancer, outro
      serviço), reaproveitamos: o rastro atravessa sistemas. Mas só
      se o formato for seguro — senão alguém injetaria texto
      arbitrário no log.
   ============================================================== */
const crypto = require("crypto");
const pinoHttp = require("pino-http");
const logger = require("../lib/logger");

const ID_SEGURO = /^[A-Za-z0-9_-]{8,64}$/;

function requestId(req, res, next) {
  const recebido = req.headers["x-request-id"];
  const id = typeof recebido === "string" && ID_SEGURO.test(recebido)
    ? recebido
    : crypto.randomUUID();

  req.id = id;
  res.setHeader("X-Request-Id", id);
  res.locals.requestId = id; // exibido na página de erro
  next();
}

const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.id,

  // Nível conforme o resultado: 5xx é erro, 4xx é aviso. Assim um
  // alerta configurado em "level >= error" dispara só no que importa.
  customLogLevel(req, res, err) {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },

  // Não vale poluir o log com cada .css e .png.
  autoLogging: {
    ignore: (req) =>
      /^\/(css|js|img|fonts|vendor)\//.test(req.url) ||
      req.url === "/favicon.ico" ||
      req.url === "/healthz",
  },

  // Só o essencial da requisição. Headers inteiros (com cookie) e
  // corpo não entram — a redação do logger é a segunda linha de
  // defesa, não a primeira.
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },

  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) => `${req.method} ${req.url} falhou: ${err.message}`,
});

module.exports = { requestId, httpLogger };
