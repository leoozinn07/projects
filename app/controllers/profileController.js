/* ==============================================================
   AquaTrip — Minha conta (perfil)
   ============================================================== */
const { z } = require("zod");
const accountService = require("../services/accountService");

const nomeSchema = z.object({
  nome: z.string().trim()
    .min(3, "Informe seu nome completo.")
    .max(120, "Nome muito longo.")
    .refine((n) => /[A-Za-zÀ-ÿ]/.test(n), "O nome precisa ter letras."),
});
const senhaSchema = z.object({
  senhaAtual: z.string().min(1, "Informe a senha atual."),
  novaSenha: z.string().min(8, "A nova senha precisa ter pelo menos 8 caracteres.").max(72, "Senha longa demais."),
  confirmaSenha: z.string(),
}).refine((d) => d.novaSenha === d.confirmaSenha, { message: "As senhas não coincidem.", path: ["confirmaSenha"] });
const emailSchema = z.object({
  novoEmail: z.string().trim().email("E-mail inválido.").max(255),
  senhaEmail: z.string().min(1, "Confirme com sua senha."),
});

function invalido(res, parsed) {
  const i = parsed.error.issues[0];
  return res.status(422).json({ error: i.message, campo: i.path[0] });
}

function tratar(fn) {
  return async (req, res, next) => {
    try { await fn(req, res); }
    catch (err) {
      if (err instanceof accountService.AccountError) {
        return res.status(err.status).json({ error: err.message, codigo: err.code, campo: err.campo });
      }
      next(err);
    }
  };
}

/* ---------- Páginas ---------- */

async function paginaEditar(req, res, next) {
  try {
    const conta = await accountService.overview(req.session.user.id);
    res.render("pages/perfil", { conta, horasTroca: accountService.EMAIL_CHANGE_HOURS });
  } catch (err) { next(err); }
}

async function paginaConta(req, res, next) {
  try {
    const conta = await accountService.overview(req.session.user.id);
    res.render("pages/perfil_editado", { conta });
  } catch (err) { next(err); }
}

/* ---------- API ---------- */

const salvarNome = tratar(async (req, res) => {
  const parsed = nomeSchema.safeParse(req.body || {});
  if (!parsed.success) return invalido(res, parsed);
  const user = await accountService.updateName({ userId: req.session.user.id, name: parsed.data.nome, req });
  req.session.user.name = user.name; // o cabeçalho já mostra o nome novo
  res.json({ nome: user.name });
});

const trocarSenha = tratar(async (req, res) => {
  const parsed = senhaSchema.safeParse(req.body || {});
  if (!parsed.success) return invalido(res, parsed);
  await accountService.changePassword({
    userId: req.session.user.id,
    atual: parsed.data.senhaAtual,
    nova: parsed.data.novaSenha,
    req,
  });
  // Novo id de sessão também para ESTA sessão (anti session fixation).
  const user = req.session.user;
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Senha alterada, mas faça login de novo." });
    req.session.user = user;
    res.json({ ok: true, mensagem: "Senha alterada. As outras sessões abertas foram encerradas." });
  });
});

const trocarEmail = tratar(async (req, res) => {
  const parsed = emailSchema.safeParse(req.body || {});
  if (!parsed.success) return invalido(res, parsed);
  await accountService.requestEmailChange({
    userId: req.session.user.id,
    novoEmail: parsed.data.novoEmail,
    senha: parsed.data.senhaEmail,
    req,
  });
  // Mesma resposta exista ou não outra conta com esse e-mail.
  res.json({
    ok: true,
    mensagem: `Enviamos um link de confirmação para ${parsed.data.novoEmail.trim().toLowerCase()}. ` +
              `Seu e-mail só muda depois que você abrir esse link.`,
  });
});

module.exports = { paginaEditar, paginaConta, salvarNome, trocarSenha, trocarEmail };
