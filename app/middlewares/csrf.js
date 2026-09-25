/* ==============================================================
   AquaTrip — Proteção CSRF
   Implementação própria e simples (o pacote `csurf`, mais comum
   para isso, está descontinuado/sem manutenção — evitamos
   depender dele). Estratégia: token aleatório armazenado na
   sessão do servidor + campo oculto no formulário. Toda rota POST
   que muda estado deve validar com csrfProtect.
   ============================================================== */
const crypto = require("crypto");

/** Garante que a sessão tenha um token CSRF e o expõe às views. */
function issueCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

/** Valida o token enviado pelo formulário contra o da sessão. */
function csrfProtect(req, res, next) {
  // Formulário manda no corpo (_csrf); chamadas fetch da API mandam
  // no header. Header customizado tem uma vantagem extra: navegador
  // não o envia em requisição cross-site sem preflight de CORS, que
  // aqui não é liberado.
  const sent = (req.body && req.body._csrf) || req.get("x-csrf-token");
  const expected = req.session.csrfToken;

  const valido =
    typeof sent === "string" &&
    typeof expected === "string" &&
    sent.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));

  if (!valido) {
    // API responde JSON; formulário responde página.
    if (req.path.startsWith("/api/") || req.is("application/json")) {
      return res.status(403).json({ error: "token CSRF ausente ou inválido" });
    }
    return res.status(403).render("pages/erro", {
      statusCode: 403,
      title: "Formulário expirado ou inválido",
      message:
        "Não foi possível validar sua solicitação por segurança (token CSRF ausente ou inválido). Volte e tente novamente.",
      stack: null,
    });
  }

  next();
}

module.exports = { issueCsrfToken, csrfProtect };
