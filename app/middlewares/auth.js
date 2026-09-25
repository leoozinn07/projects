/* ==============================================================
   AquaTrip — Middlewares de autenticação/autorização
   Nunca confiar no frontend: toda checagem de sessão/papel
   acontece aqui, no servidor.
   ============================================================== */

const auditService = require("../services/auditService");
const { AuditAction } = auditService;

/** Torna req.session.user disponível em todas as views como `user`. */
function attachUserToLocals(req, res, next) {
  res.locals.user = req.session.user || null;
  next();
}

/** API responde JSON; página responde redirect. Um fetch que recebe
    HTML de login no lugar de JSON quebra de forma confusa. */
function isApi(req) {
  return req.originalUrl.startsWith("/api/");
}

function naoAutenticado(req, res) {
  if (isApi(req)) return res.status(401).json({ error: "Faça login para continuar." });
  const redirectTo = encodeURIComponent(req.originalUrl);
  return res.redirect(`/login?redirect=${redirectTo}`);
}

/** Bloqueia acesso a quem não está autenticado. */
function requireAuth(req, res, next) {
  if (!req.session.user) return naoAutenticado(req, res);
  next();
}

/**
 * Bloqueia acesso a quem não tem o papel exigido.
 * Uso: requireRole("ADMIN")
 */
function requireRole(...allowedRoles) {
  // async: o registro de auditoria termina ANTES da resposta. Sem o
  // await, o 403 saía antes de a linha ser gravada — e, se o processo
  // caísse naquele instante, a tentativa sumia da trilha. (Achado por
  // um teste que falhava de forma intermitente.) auditService.log
  // nunca lança erro, então o await não derruba a requisição.
  return async (req, res, next) => {
    if (!req.session.user) return naoAutenticado(req, res);

    if (!allowedRoles.includes(req.session.user.role)) {
      // Tentativa de acesso a area restrita por quem nao tem o papel:
      // evento de seguranca, precisa ficar registrado.
      await auditService.log(AuditAction.ACCESS_DENIED, {
        req,
        metadata: {
          rota: req.originalUrl,
          papelAtual: req.session.user.role,
          papelExigido: allowedRoles.join(","),
        },
      });
      if (isApi(req)) return res.status(403).json({ error: "Acesso restrito." });
      return res.status(403).render("pages/erro", {
        statusCode: 403,
        title: "Acesso restrito",
        message: "Você não tem permissão para acessar esta página.",
        stack: null,
      });
    }

    // 2FA obrigatório para ADMIN. Lido por requisição (testável e
    // desligável só por configuração explícita). Sem segundo fator na
    // sessão, a área administrativa não abre — com senha vazada, o
    // invasor para aqui.
    if (req.session.user.role === "ADMIN" && process.env.REQUIRE_ADMIN_2FA !== "false" && !req.session.user.mfa) {
      if (isApi(req)) {
        return res.status(403).json({ error: "Ative a verificação em duas etapas para usar o painel.", codigo: "MFA_REQUIRED" });
      }
      return res.redirect("/conta/2fa?aviso=obrigatorio");
    }

    // Acesso legitimo a area administrativa tambem e' auditado:
    // em investigacao, saber quem ENTROU importa tanto quanto quem
    // tentou e falhou.
    if (allowedRoles.includes("ADMIN") && !isApi(req)) {
      await auditService.log(AuditAction.ADMIN_ACCESS, {
        req,
        metadata: { rota: req.originalUrl },
      });
    }

    next();
  };
}

module.exports = { attachUserToLocals, requireAuth, requireRole };
