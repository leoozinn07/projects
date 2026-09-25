/* ==============================================================
   AquaTrip — Auth Controller
   Só lida com req/res e validação de entrada. Regra de negócio
   fica no authService; SQL fica no userRepository.
   ============================================================== */
const { z } = require("zod");
const log = require("../lib/logger").forModule("auth");
const authService = require("../services/authService");
const auditService = require("../services/auditService");
const recoveryService = require("../services/accountRecoveryService");
const twoFactor = require("../services/twoFactorService");
const { AuditAction } = auditService;

const cadastroSchema = z
  .object({
    nome: z.string().trim().min(2, "Informe seu nome completo.").max(120),
    email: z.string().trim().email("Informe um e-mail válido.").max(255),
    senha: z
      .string()
      .min(8, "A senha precisa ter pelo menos 8 caracteres.")
      .max(72), // 72 bytes é o limite prático do argon2/bcrypt para senha
    // Aceite explícito dos Termos de Uso e da Política de Privacidade
    // (caixa desmarcada por padrão: consentimento tem que ser ativo).
    aceite: z.literal("on", { error: "Para criar a conta, aceite os Termos de Uso e a Política de Privacidade." }),
  })
  .transform(({ nome, email, senha }) => ({ name: nome, email, password: senha }));

const loginSchema = z
  .object({
    email: z.string().trim().email("Informe um e-mail válido."),
    senha: z.string().min(1, "Informe sua senha."),
  })
  .transform(({ email, senha }) => ({ email, password: senha }));

function firstZodMessage(error) {
  return error.issues?.[0]?.message || "Dados inválidos.";
}

function safeRedirectPath(candidate) {
  // Só permite redirecionar para caminhos internos (evita open redirect
  // via ?redirect=https://site-malicioso.com).
  if (typeof candidate === "string" && candidate.startsWith("/") && !candidate.startsWith("//")) {
    return candidate;
  }
  return "/";
}

async function showLogin(req, res) {
  res.render("pages/login", {
    // E-mail recém-cadastrado vem da sessão (nunca pela URL) e a senha
    // nunca é guardada: a pessoa só digita a senha.
    emailPreenchido: res.locals.emailCadastro || "",
    error: req.query.error || null,
    cadastro: req.query.cadastro || null,
    senhaAlterada: req.query.senha_alterada === "1",
    redirectTo: safeRedirectPath(req.query.redirect),
  });
}

async function showCadastro(req, res) {
  res.render("pages/cadastro", { error: req.query.error || null });
}

async function cadastro(req, res) {
  const parsed = cadastroSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.redirect(`/cadastro?error=${encodeURIComponent(firstZodMessage(parsed.error))}`);
  }

  try {
    const novoUsuario = await authService.registerUser({
      ...parsed.data,
      termsVersion: require("../lib/termos").VERSAO,
      locale: req.lang || null,
    });
    await auditService.log(AuditAction.USER_REGISTERED, {
      req,
      userId: novoUsuario.id,
      metadata: { email: novoUsuario.email, termos: novoUsuario.terms_version },
    });
    // Dispara a confirmação de e-mail. Falha aqui não impede o
    // cadastro: o usuário pode pedir o reenvio depois.
    recoveryService
      .sendVerificationEmail({ userId: novoUsuario.id, req })
      .catch((err) => (req.log || log).error({ err }, "falha ao enviar verificação"));
  } catch (err) {
    if (err instanceof authService.AuthError) {
      // Mensagem genérica proposital: não confirmar que o e-mail já
      // existe evita enumeração de contas cadastradas.
      return res.redirect(
        `/cadastro?error=${encodeURIComponent("Não foi possível concluir o cadastro. Verifique os dados e tente novamente.")}`
      );
    }
    (req.log || log).error({ err }, "erro inesperado no cadastro");
    return res.redirect(`/cadastro?error=${encodeURIComponent("Erro interno. Tente novamente.")}`);
  }

  req.session.emailCadastro = parsed.data.email.trim().toLowerCase();
  return res.redirect("/login?cadastro=ok");
}

async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  const redirectTo = safeRedirectPath(req.body.redirect);

  if (!parsed.success) {
    return res.redirect(
      `/login?error=${encodeURIComponent(firstZodMessage(parsed.error))}&redirect=${encodeURIComponent(redirectTo)}`
    );
  }

  try {
    const user = await authService.verifyCredentials(parsed.data);

    // Com 2FA ativo, a senha certa NÃO cria a sessão: vai para a
    // segunda etapa (require tardio para evitar dependência circular).
    if ((await twoFactor.statusDe(user.id)).ativo) {
      await auditService.log(AuditAction.MFA_CHALLENGED, { req, userId: user.id });
      return require("./twoFactorController").iniciarPendente(req, res, user, redirectTo);
    }

    // Regeneração de sessão no login: previne session fixation
    // (um atacante que tenha fixado um sessionId antes do login não
    // ganha a sessão autenticada).
    req.session.regenerate((err) => {
      if (err) {
        (req.log || log).error({ err }, "erro ao regenerar sessão");
        return res.redirect("/login?error=" + encodeURIComponent("Erro interno. Tente novamente."));
      }
      req.session.user = { ...user, mfa: false };
      // Tela de boas-vindas (com a onda) na próxima página
      req.session.boasVindas = String(user.name || "").trim().split(/\s+/)[0];
      // Idioma salvo na conta vale a partir de agora neste navegador
      if (user.locale) require("../lib/i18n").gravarCookie(res, user.locale);
      req.session.csrfToken = undefined; // força emitir um novo token na próxima página
      auditService
        .log(AuditAction.LOGIN_SUCCESS, {
          req,
          userId: user.id,
          metadata: { email: user.email, role: user.role },
        })
        .finally(() => res.redirect(redirectTo)); // grava antes de responder
    });
  } catch (err) {
    if (err instanceof authService.AuthError) {
      // Registra a tentativa falha SEM a senha: e' o que permite
      // detectar credential stuffing depois.
      await auditService.log(
        err.code === "ACCOUNT_LOCKED"
          ? AuditAction.ACCOUNT_LOCKED
          : AuditAction.LOGIN_FAILED,
        { req, metadata: { email: parsed.data.email, motivo: err.code } }
      );
      return res.redirect(
        `/login?error=${encodeURIComponent(err.message)}&redirect=${encodeURIComponent(redirectTo)}`
      );
    }
    (req.log || log).error({ err }, "erro inesperado no login");
    return res.redirect("/login?error=" + encodeURIComponent("Erro interno. Tente novamente."));
  }
}

async function logout(req, res) {
  const user = req.session.user;
  if (user) {
    await auditService.log(AuditAction.LOGOUT, { req, userId: user.id });
  }
  req.session.destroy(() => {
    res.clearCookie("aquatrip.sid");
    res.redirect("/");
  });
}

module.exports = { showLogin, showCadastro, cadastro, login, logout };
