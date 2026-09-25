/* ==============================================================
   AquaTrip — Verificação em duas etapas
   ============================================================== */
const argon2 = require("argon2");
const db = require("../lib/db");
const twoFactor = require("../services/twoFactorService");
const auditService = require("../services/auditService");
const mailService = require("../services/mailService");
const userRepository = require("../repositories/userRepository");
const log = require("../lib/logger").forModule("2fa");
const { AuditAction } = auditService;

const PRAZO_PENDENTE_MS = 5 * 60 * 1000;
const MAX_TENTATIVAS = 5;

const exigeParaAdmin = () => process.env.REQUIRE_ADMIN_2FA !== "false";

async function senhaConfere(userId, senha) {
  const { rows } = await db.query(`SELECT password_hash FROM users WHERE id = ?`, [userId]);
  try { return Boolean(rows[0] && senha && (await argon2.verify(rows[0].password_hash, senha))); }
  catch { return false; }
}

/** Monta o objeto de sessão no mesmo formato do login normal. */
function primeiroNome(nome) {
  return String(nome || "").trim().split(/\s+/)[0] || "";
}

async function usuarioDaSessao(userId, mfa) {
  const u = await userRepository.findById(userId);
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, mfa,
    locale: u.locale || null, termsOk: require("../lib/termos").aceitouVigente(u),
  };
}

/* ==============================================================
   SEGUNDA ETAPA DO LOGIN
   ============================================================== */

/**
 * Chamado pelo login DEPOIS da senha correta, quando o usuário tem
 * 2FA ativo. Não cria sessão autenticada: guarda só um "pendente"
 * com prazo e contador de tentativas.
 */
function iniciarPendente(req, res, user, redirectTo) {
  req.session.regenerate((err) => {
    if (err) return res.redirect("/login?error=" + encodeURIComponent("Erro interno. Tente novamente."));
    req.session.pending2fa = { userId: user.id, redirectTo, expira: Date.now() + PRAZO_PENDENTE_MS, tentativas: 0 };
    res.redirect("/login/2fa");
  });
}

function pendenteValido(req) {
  const p = req.session.pending2fa;
  if (!p) return null;
  if (Date.now() > p.expira) { delete req.session.pending2fa; return null; }
  return p;
}

function paginaSegundaEtapa(req, res) {
  if (!pendenteValido(req)) {
    return res.redirect("/login?error=" + encodeURIComponent("Sua verificação expirou. Entre novamente."));
  }
  res.render("pages/login_2fa", { error: req.query.error || null });
}

async function confirmarSegundaEtapa(req, res, next) {
  const p = pendenteValido(req);
  if (!p) return res.redirect("/login?error=" + encodeURIComponent("Sua verificação expirou. Entre novamente."));

  try {
    const r = await twoFactor.verificar({ userId: p.userId, codigo: req.body.codigo });

    if (!r.ok) {
      p.tentativas += 1;
      await auditService.log(AuditAction.MFA_FAILED, {
        req, userId: p.userId, metadata: { tentativa: p.tentativas, reuso: Boolean(r.reuso) },
      });
      if (p.tentativas >= MAX_TENTATIVAS) {
        // Esgotou: descarta o pendente. Para tentar de novo, precisa da
        // senha outra vez — adivinhar 6 dígitos deixa de ser viável.
        delete req.session.pending2fa;
        return res.redirect("/login?error=" + encodeURIComponent("Muitas tentativas de código. Entre novamente com sua senha."));
      }
      const msg = r.reuso
        ? "Este código já foi usado. Aguarde o próximo no aplicativo."
        : `Código incorreto. Restam ${MAX_TENTATIVAS - p.tentativas} tentativa(s).`;
      return res.redirect("/login/2fa?error=" + encodeURIComponent(msg));
    }

    const destino = p.redirectTo || "/";
    const user = await usuarioDaSessao(p.userId, true);
    req.session.regenerate(async (err) => {
      if (err) return next(err);
      req.session.user = user;
      req.session.boasVindas = primeiroNome(user.name);
      await auditService.log(AuditAction.LOGIN_SUCCESS, {
        req, userId: user.id, metadata: { email: user.email, role: user.role, segundoFator: r.metodo },
      });
      if (r.metodo === "recuperacao") {
        // Uso de código de recuperação é incomum: avisa o dono.
        mailService.send({
          to: user.email, template: "2fa_recuperacao_usada",
          subject: "Código de recuperação usado — AquaTrip",
          text: `${user.name}, um código de recuperação foi usado para entrar na sua conta. ` +
                `Restam ${r.restantes}. Se não foi você, troque sua senha agora.`,
        }).catch((e) => log.error({ err: e }, "falha ao avisar uso de recuperação"));
        if (r.restantes <= 3) return res.redirect("/conta/2fa?aviso=poucos-codigos");
      }
      res.redirect(destino);
    });
  } catch (err) {
    next(err);
  }
}

/* ==============================================================
   CONFIGURAÇÃO (Minha conta → Verificação em duas etapas)
   ============================================================== */

async function paginaConfigurar(req, res, next) {
  try {
    const status = await twoFactor.statusDe(req.session.user.id);
    let config = null;
    if (!status.ativo) {
      // O segredo fica na SESSÃO até ser confirmado com um código:
      // nada vai ao banco antes de provarmos que o app foi configurado.
      if (!req.session.setup2fa || Date.now() - req.session.setup2fa.criado > 15 * 60 * 1000) {
        req.session.setup2fa = { segredo: twoFactor.gerarSegredo(), criado: Date.now() };
      }
      const s = req.session.setup2fa.segredo;
      const { uri, qr } = await twoFactor.qrPara(req.session.user.email, s);
      config = { qr, chave: s.replace(/(.{4})/g, "$1 ").trim(), uri };
    }
    res.render("pages/conta_2fa", {
      status,
      config,
      obrigatorio: req.session.user.role === "ADMIN" && exigeParaAdmin(),
      aviso: req.query.aviso || null,
      error: req.query.error || null,
      codigosNovos: null,
    });
  } catch (err) { next(err); }
}

async function ativar(req, res, next) {
  const setup = req.session.setup2fa;
  const voltar = (msg) => res.redirect("/conta/2fa?error=" + encodeURIComponent(msg));
  if (!setup) return voltar("A configuração expirou. Leia o QR code de novo.");
  try {
    if (!(await senhaConfere(req.session.user.id, req.body.senha))) return voltar("Senha incorreta.");
    const codigos = await twoFactor.ativar({ userId: req.session.user.id, segredo: setup.segredo, codigo: req.body.codigo });
    delete req.session.setup2fa;

    // Esta sessão acabou de provar posse do app. As OUTRAS sessões
    // (abertas antes, sem segundo fator) são encerradas.
    req.session.user.mfa = true;
    await db.query(
      `DELETE FROM session WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.user.id')) = ? AND session_id <> ?`,
      [req.session.user.id, req.sessionID]
    );
    await auditService.log(AuditAction.MFA_ENABLED, { req, userId: req.session.user.id });
    mailService.send({
      to: req.session.user.email, template: "2fa_ativado",
      subject: "Verificação em duas etapas ativada — AquaTrip",
      text: `${req.session.user.name}, a verificação em duas etapas foi ativada na sua conta.`,
    }).catch(() => {});

    res.render("pages/conta_2fa", {
      status: await twoFactor.statusDe(req.session.user.id), config: null,
      obrigatorio: false, aviso: null, error: null, codigosNovos: codigos,
    });
  } catch (err) {
    if (err instanceof twoFactor.TwoFactorError) return voltar(err.message);
    next(err);
  }
}

/** Exige senha E código atual: gerar códigos novos é ação sensível. */
async function confirmarIdentidade(req) {
  if (!(await senhaConfere(req.session.user.id, req.body.senha))) return "Senha incorreta.";
  const r = await twoFactor.verificar({ userId: req.session.user.id, codigo: req.body.codigo });
  if (!r.ok) return r.reuso ? "Este código já foi usado. Aguarde o próximo." : "Código incorreto.";
  return null;
}

async function regenerarCodigos(req, res, next) {
  try {
    const erro = await confirmarIdentidade(req);
    if (erro) return res.redirect("/conta/2fa?error=" + encodeURIComponent(erro));
    const codigos = await twoFactor.regenerarCodigos(req.session.user.id);
    await auditService.log(AuditAction.MFA_CODES_REGENERATED, { req, userId: req.session.user.id });
    res.render("pages/conta_2fa", {
      status: await twoFactor.statusDe(req.session.user.id), config: null,
      obrigatorio: false, aviso: null, error: null, codigosNovos: codigos,
    });
  } catch (err) { next(err); }
}

async function desativar(req, res, next) {
  if (req.session.user.role === "ADMIN" && exigeParaAdmin()) {
    return res.redirect("/conta/2fa?error=" + encodeURIComponent(
      "Para administradores a verificação em duas etapas é obrigatória. Para trocar de celular, gere novos códigos ou peça a outro administrador para redefinir."));
  }
  try {
    const erro = await confirmarIdentidade(req);
    if (erro) return res.redirect("/conta/2fa?error=" + encodeURIComponent(erro));
    await twoFactor.desativar(req.session.user.id);
    req.session.user.mfa = false;
    await auditService.log(AuditAction.MFA_DISABLED, { req, userId: req.session.user.id });
    mailService.send({
      to: req.session.user.email, template: "2fa_desativado",
      subject: "Verificação em duas etapas desativada — AquaTrip",
      text: `${req.session.user.name}, a verificação em duas etapas foi DESATIVADA. Se não foi você, troque sua senha agora.`,
    }).catch(() => {});
    res.redirect("/conta/2fa?aviso=desativado");
  } catch (err) { next(err); }
}

/* ==============================================================
   ADMIN: redefinir o 2FA de outra pessoa (perdeu celular E códigos)
   ============================================================== */
async function redefinirPorAdmin(req, res, next) {
  const alvoId = req.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(alvoId)) return res.status(400).json({ error: "Identificador inválido." });
  if (alvoId === req.session.user.id) {
    // Ninguém redefine o próprio 2FA pelo painel: seria o atalho
    // exato que um invasor com a senha do admin procuraria.
    return res.status(403).json({ error: "Você não pode redefinir a sua própria verificação em duas etapas.", codigo: "SELF_RESET" });
  }
  try {
    const alvo = await userRepository.findById(alvoId);
    if (!alvo) return res.status(404).json({ error: "Usuário não encontrado." });
    await twoFactor.desativar(alvoId);
    await db.query(
      `DELETE FROM session WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.user.id')) = ?`,
      [alvoId]
    );
    await auditService.log(AuditAction.MFA_RESET_BY_ADMIN, {
      req, userId: req.session.user.id, metadata: { alvo: alvoId },
    });
    mailService.send({
      to: alvo.email, template: "2fa_redefinido",
      subject: "Sua verificação em duas etapas foi redefinida — AquaTrip",
      text: `${alvo.name}, um administrador redefiniu sua verificação em duas etapas. ` +
            `Configure de novo no próximo acesso. Se você não pediu isso, responda este e-mail.`,
    }).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  exigeParaAdmin, iniciarPendente, paginaSegundaEtapa, confirmarSegundaEtapa,
  paginaConfigurar, ativar, regenerarCodigos, desativar, redefinirPorAdmin,
};
