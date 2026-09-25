/* ==============================================================
   AquaTrip — Recovery Controller
   ============================================================== */
const { z } = require("zod");
const log = require("../lib/logger").forModule("recuperacao");
const recoveryService = require("../services/accountRecoveryService");
const mailService = require("../services/mailService");

const emailSchema = z.object({
  email: z.string().trim().email("Informe um e-mail válido.").max(255),
});

const resetSchema = z
  .object({
    senha: z
      .string()
      .min(8, "A senha precisa ter pelo menos 8 caracteres.")
      .max(72, "Senha longa demais."),
    "confirma-senha": z.string(),
  })
  .refine((d) => d.senha === d["confirma-senha"], {
    message: "As senhas não coincidem.",
    path: ["confirma-senha"],
  });

function firstZodMessage(error) {
  return error.issues?.[0]?.message || "Dados inválidos.";
}

/* ---------- Esqueci a senha ---------- */

function showForgotPassword(req, res) {
  res.render("pages/esqueci_senha", {
    error: req.query.error || null,
    enviado: req.query.enviado === "1",
  });
}

async function requestPasswordReset(req, res, next) {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.redirect(
      `/esqueci-senha?error=${encodeURIComponent(firstZodMessage(parsed.error))}`
    );
  }

  try {
    await recoveryService.requestPasswordReset({ email: parsed.data.email, req });
  } catch (err) {
    // Mesmo em erro interno, não mudamos a resposta ao usuário: uma
    // resposta diferente já seria sinal de que o e-mail existe.
    (req.log || log).error({ err }, "erro ao processar pedido de reset");
  }

  // Resposta SEMPRE idêntica, exista ou não a conta.
  return res.redirect("/esqueci-senha?enviado=1");
}

/* ---------- Redefinir senha ---------- */

async function showResetPassword(req, res, next) {
  try {
    const valido = await recoveryService.checkResetToken(req.params.token);
    if (!valido) {
      return res.status(400).render("pages/redefinir_senha", {
        tokenValido: false,
        token: null,
        error: null,
      });
    }
    res.render("pages/redefinir_senha", {
      tokenValido: true,
      token: req.params.token,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.redirect(
      `/redefinir-senha/${req.params.token}?error=${encodeURIComponent(firstZodMessage(parsed.error))}`
    );
  }

  try {
    await recoveryService.resetPassword({
      token: req.params.token,
      newPassword: parsed.data.senha,
      req,
    });

    // Derruba qualquer sessão ativa: se a conta estava tomada, o
    // invasor perde o acesso no momento em que o dono troca a senha.
    req.session.regenerate((err) => {
      if (err) (req.log || log).error({ err }, "erro ao regenerar sessão");
      res.redirect("/login?senha_alterada=1");
    });
  } catch (err) {
    if (err instanceof recoveryService.RecoveryError) {
      if (err.code === "INVALID_TOKEN") {
        return res.status(400).render("pages/redefinir_senha", {
          tokenValido: false,
          token: null,
          error: err.message,
        });
      }
      return res.redirect(
        `/redefinir-senha/${req.params.token}?error=${encodeURIComponent(err.message)}`
      );
    }
    next(err);
  }
}

/* ---------- Verificação de e-mail ---------- */

async function verifyEmail(req, res, next) {
  try {
    const r = await recoveryService.verifyEmail({ token: req.params.token, req });
    // Se quem confirma é a própria sessão logada, a sessão passa a ter o e-mail novo.
    if (r && r.emailTrocado && req.session.user && req.session.user.id === r.id) {
      req.session.user.email = r.email;
    }
    res.render("pages/verificar_email", {
      sucesso: true, error: null, reenviado: false,
      emailTrocado: Boolean(r && r.emailTrocado), novoEmail: r ? r.email : null,
    });
  } catch (err) {
    if (err instanceof recoveryService.RecoveryError) {
      return res
        .status(400)
        .render("pages/verificar_email", { sucesso: false, error: err.message, reenviado: false });
    }
    next(err);
  }
}

async function resendVerification(req, res, next) {
  try {
    await recoveryService.sendVerificationEmail({ userId: req.session.user.id, req });
    res.render("pages/verificar_email", { sucesso: false, error: null, reenviado: true });
  } catch (err) {
    next(err);
  }
}

/* ---------- Caixa de e-mails do modo dev ---------- */

/**
 * Sem SMTP configurado, os e-mails são escritos em disco. Esta rota
 * lista os últimos para facilitar o teste do fluxo. Só existe fora de
 * produção (ver router.js) e ainda checa o transporte aqui.
 */
async function devMailbox(req, res) {
  if (process.env.NODE_ENV === "production" || mailService.transportName() !== "dev") {
    return res.status(404).render("pages/erro", {
      statusCode: 404,
      title: "Página não encontrada",
      message: "Esta funcionalidade não está disponível.",
      stack: null,
    });
  }

  const fs = require("fs");
  const path = require("path");
  let emails = [];

  try {
    emails = fs
      .readdirSync(mailService.MAIL_DIR)
      .filter((f) => f.endsWith(".txt"))
      .sort()
      .reverse()
      .slice(0, 20)
      .map((f) => ({
        nome: f,
        conteudo: fs.readFileSync(path.join(mailService.MAIL_DIR, f), "utf8"),
      }));
  } catch {
    emails = [];
  }

  res.render("pages/dev_emails", { emails });
}

module.exports = {
  showForgotPassword,
  requestPasswordReset,
  showResetPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  devMailbox,
};
