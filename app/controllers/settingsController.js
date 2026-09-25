/* ==============================================================
   AquaTrip · Configurações (idioma, tema) e aceite dos Termos
   ============================================================== */
const i18n = require("../lib/i18n");
const termos = require("../lib/termos");
const userRepository = require("../repositories/userRepository");
const auditService = require("../services/auditService");
const { AuditAction } = auditService;

/** Só caminhos internos: impede redirecionamento aberto. */
function destinoSeguro(valor, padrao = "/configuracoes") {
  const v = String(valor || "");
  return v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : padrao;
}

function pagina(req, res) {
  res.render("pages/configuracoes", {
    salvo: req.query.salvo === "1",
    versaoTermos: termos.VERSAO,
  });
}

/** Troca o idioma: cookie para todos; na conta também, se logado. */
async function idioma(req, res, next) {
  const escolhido = i18n.valido(req.body.idioma);
  const destino = destinoSeguro(req.body.redirect);
  if (!escolhido) return res.redirect(destino);
  try {
    i18n.gravarCookie(res, escolhido);
    const u = req.session.user;
    if (u) {
      await userRepository.setLocale(u.id, escolhido);
      req.session.user = { ...u, locale: escolhido };
      await auditService.log(AuditAction.LOCALE_CHANGED, { req, userId: u.id, metadata: { idioma: escolhido } });
    }
    const sep = destino.includes("?") ? "&" : "?";
    res.redirect(destino === "/configuracoes" ? destino + sep + "salvo=1" : destino);
  } catch (err) {
    next(err);
  }
}

/** Aceite (ou novo aceite) da versão vigente dos Termos e da Política. */
async function aceitarTermos(req, res, next) {
  const destino = destinoSeguro(req.body.redirect, "/");
  if (req.body.aceite !== "on") return res.redirect(destino);
  try {
    const u = req.session.user;
    await userRepository.acceptTerms(u.id, termos.VERSAO);
    req.session.user = { ...u, termsOk: true };
    await auditService.log(AuditAction.TERMS_ACCEPTED, { req, userId: u.id, metadata: { versao: termos.VERSAO } });
    res.redirect(destino);
  } catch (err) {
    next(err);
  }
}

/** Pede o aceite a quem entrou sem ter aceitado a versão vigente.
    Não bloqueia leitura dos próprios Termos e da Política. */
function exigirAceite(req, res, next) {
  const u = req.session && req.session.user;
  const livre = /^\/(termos-de-uso|politica-de-privacidade|aceite-termos|logout|api\/)/.test(req.path.slice(0) + "/");
  if (u && !u.termsOk && req.method === "GET" && !livre) {
    res.locals.pedirAceite = true;
    res.locals.versaoTermos = termos.VERSAO;
  }
  next();
}

module.exports = { pagina, idioma, aceitarTermos, exigirAceite, destinoSeguro };
