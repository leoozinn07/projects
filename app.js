require("dotenv").config({ quiet: true });

const express = require("express");
const helmet = require("helmet");
const logger = require("./app/lib/logger");
const { requestId, httpLogger } = require("./app/middlewares/observability");
const healthController = require("./app/controllers/healthController");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);

const db = require("./app/lib/db");
const { attachUserToLocals } = require("./app/middlewares/auth");
const { issueCsrfToken } = require("./app/middlewares/csrf");

const app = express();

/* requestId antes de tudo: qualquer log, erro ou resposta daqui em
   diante já carrega o id de correlação. */
app.use(requestId);

/* SEO: páginas privadas nunca indexadas. */
const seo = require("./app/middlewares/seo");
app.use(seo.robotsPrivados);
app.locals.urlAbsoluta = (caminho) => seo.base() + caminho;

/* Rótulo de categoria disponível em qualquer view (categoriaRotulo). */
app.locals.categoriaRotulo = require("./app/lib/categorias").rotulo;
/* Formatação de datas no fuso de operação (ver app/lib/datas.js). */
app.locals.fmt = require("./app/lib/datas");
// Cartão de experiência: capa (foto do parceiro ou ilustração da categoria) e Aqua Score.
app.locals.capaDe = (e) => require("./app/controllers/homeController").capa(e);
app.locals.aquaScore = (slug) => require("./app/controllers/homeController").AQUA_SCORE[slug] || null;
const port = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

if (!process.env.SESSION_SECRET) {
  throw new Error(
    "[app] SESSION_SECRET não definido. Configure o arquivo .env (veja .env.example)."
  );
}

/* ------------------------------------------------------------------
   SEGURANÇA — headers HTTP + CSP (Fase 3.4)
   Todo <script> inline e atributo onXXX= foram extraídos para
   arquivos externos (ver commit da Fase 3.4) especificamente para
   permitir esta CSP sem 'unsafe-inline' em script-src — isso é o
   que de fato mitiga XSS (uma CSP com 'unsafe-inline' em script-src
   não protege contra nada, é segurança de fachada).
   style-src mantém 'unsafe-inline': ainda há alguns estilos inline
   estáticos (ex.: largura de barras de gráfico no admin) sem risco
   de execução de código — CSS injection é uma categoria de ameaça
   bem menor que XSS, e não há dado de usuário nesses estilos.
   ------------------------------------------------------------------ */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Nenhum script de terceiro: os ícones passaram a ser
        // servidos do próprio domínio (app/public/vendor/). Além de
        // fechar o vetor de supply chain, isso cumpre a promessa do
        // banner de consentimento de não acionar terceiros.
        scriptSrc: ["'self'"],
        // Fontes auto-hospedadas (app/public/fonts): nenhum domínio
        // externo precisa ser liberado para estilo ou fonte.
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", "https:", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
  })
);

/* Log HTTP estruturado (pino). Em teste o nível é "silent". */
app.use(httpLogger);

/* Health checks ANTES da sessão: são chamados a cada poucos segundos
   pelo orquestrador e não devem criar sessão nem tocar em cookie. */
app.get("/healthz", healthController.liveness);
app.get("/readyz", healthController.readiness);

app.use(express.static("app/public"));

app.set("view engine", "ejs");
app.set("views", "./app/views");
app.set("trust proxy", 1); // necessário para cookie "secure" funcionar atrás de proxy/load balancer

// rawBody é necessário para validar a assinatura HMAC dos webhooks:
// a assinatura é calculada sobre os bytes exatos recebidos, então o
// corpo já parseado (e re-serializado) não serve.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);
app.use(express.urlencoded({ extended: true }));

/* ------------------------------------------------------------------
   SESSÃO — persistida no próprio MySQL (express-mysql-session), sem
   depender de Redis/serviço extra. A tabela "session" é criada
   automaticamente por essa lib na primeira execução. Reaproveita o
   pool mysql2 já aberto em app/lib/db.js (db.pool) em vez de abrir
   uma segunda conexão com o banco.
   Cookie: httpOnly sempre; secure apenas quando NODE_ENV=production
   (em dev, sem HTTPS, "secure" faria o cookie nunca ser enviado).
   ------------------------------------------------------------------ */
const sessionStore = new MySQLStore(
  { createDatabaseTable: true, schema: { tableName: "session" } },
  db.pool
);
sessionStore.onReady().catch((err) => {
  logger.error({ err }, "[app] falha ao inicializar a tabela de sessão no MySQL");
});

app.use(
  session({
    store: sessionStore,
    name: "aquatrip.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8, // 8 horas
    },
  })
);

app.use(attachUserToLocals);
app.use(issueCsrfToken);

/* Idioma (pt, en, es): t(), tm() e formatadores por requisição.
   Mensagens de uma vez só (boas-vindas depois do login, e-mail
   recém-cadastrado) saem da sessão aqui, só em páginas HTML. */
const i18n = require("./app/lib/i18n");
i18n.locaisPadrao(app);
app.use(i18n.middleware);
/* Valores padrão de SEO para toda view (depende de req.t já estar
   disponível para os títulos/descrições traduzíveis). Controllers
   sobrescrevem res.locals.seo quando a página tem título/descrição
   próprios. */
app.use(require("./app/middlewares/seo").seoPadrao);
app.use(require("./app/middlewares/flash").umaVez);
app.use(require("./app/controllers/settingsController").exigirAceite);

let rotas = require("./app/routes/router");
app.use("/", rotas);

/* ------------------------------------------------------------------
   TRATAMENTO DE ERROS (Fase 3) — 404 e 500 centralizados.
   Nunca expor stack trace em produção.
   ------------------------------------------------------------------ */
/* A página de erro precisa desenhar mesmo quando a requisição quebrou
   ANTES dos middlewares que preenchem estes valores (ex.: falha do
   banco ao ler a sessão). Sem isto, o erro real fica escondido atrás
   de um "user is not defined" no cabeçalho. */
function locaisSeguros(res) {
  res.locals.user = res.locals.user || null;
  res.locals.csrfToken = res.locals.csrfToken || "";
  res.locals.seo = res.locals.seo || {
    titulo: "AquaTrip", descricao: "", canonica: "", imagem: "", tipo: "website",
  };
  i18n.completar(res.locals);
  if (!res.locals.fmt) res.locals.fmt = require("./app/lib/datas");
}

/**
 * Erro de conexão com o banco (servidor fora, senha errada, banco
 * inexistente). ECONNREFUSED/ENOTFOUND/ETIMEDOUT são erros de rede do
 * próprio Node (continuam os mesmos em qualquer banco); os demais são
 * códigos do driver mysql2 — ER_ACCESS_DENIED_ERROR (senha errada),
 * ER_DBACCESS_DENIED_ERROR (usuário sem permissão no banco) e
 * ER_BAD_DB_ERROR (banco inexistente) — substituindo os antigos códigos
 * SQLSTATE do Postgres (28P01/3D000/28000).
 */
function ehFalhaDeBanco(err) {
  return [
    "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT",
    "ER_ACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR",
  ].includes(err && err.code);
}

function handler404(req, res) {
  locaisSeguros(res);
  res.status(404).render("pages/erro", {
    statusCode: 404,
    title: "Página não encontrada",
    message: "O endereço que você tentou acessar não existe ou foi movido.",
    stack: null,
  });
}
app.use(handler404);

function handlerErro(err, req, res, next) {
  const status = err.status || 500;
  // Log com o requestId (via req.log do pino-http) e o erro completo.
  // O usuário vê só o id — nunca o stack em produção.
  (req.log || logger).error(
    { err, requestId: req.id, userId: req.session?.user?.id },
    "erro não tratado"
  );
  // Lido na hora (não no boot) para o comportamento ser verificável
  // em teste. Fora de produção o stack aparece — ajuda a depurar.
  const emProducao = process.env.NODE_ENV === "production";
  locaisSeguros(res);

  // Falha de banco em desenvolvimento: diz a causa e o que fazer, em vez
  // de "erro inesperado" — é o tropeço nº 1 de quem roda pela 1ª vez.
  const bancoFora = ehFalhaDeBanco(err);
  const mensagem = bancoFora && !emProducao
    ? "O site não conseguiu falar com o banco de dados. Verifique se o MySQL está " +
      "rodando e se a DATABASE_URL do arquivo .env está correta; se ainda não criou as " +
      "tabelas, rode: npm run db:migrate"
    : bancoFora
      ? "Estamos com uma instabilidade momentânea. Tente de novo em instantes."
      : "Ocorreu um erro inesperado. Se precisar falar com o suporte, informe o código abaixo.";

  res.status(bancoFora ? 503 : status).render("pages/erro", {
    statusCode: bancoFora ? 503 : status,
    title: bancoFora ? "Banco de dados indisponível" : "Algo deu errado",
    message: mensagem,
    stack: emProducao ? null : err.stack,
  });
}
app.use(handlerErro);

// Exportados para o teste de regressão exercitar os handlers REAIS.
app._handler404 = handler404;
app._handlerErro = handlerErro;

/* ------------------------------------------------------------------
   Exporta a aplicação SEM subir servidor nem iniciar jobs.
   Quem escuta na porta é o server.js — essa separação é o que permite
   os testes importarem o app direto (Supertest), sem abrir porta e
   sem deixar timers pendurados ao fim da suíte.
   ------------------------------------------------------------------ */
module.exports = app;
