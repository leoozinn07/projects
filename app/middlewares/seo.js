/* ==============================================================
   AquaTrip — SEO: o que o Google pode e não pode ver
   ==============================================================
   X-Robots-Tag em vez de só <meta name="robots">: o cabeçalho vale
   também para JSON, imagens e redirecionamentos, e não depende de
   alguém lembrar de pôr a meta tag em cada página nova.
   ============================================================== */
const PRIVADO = [
  /^\/admin/, /^\/gestao/, /^\/api\//, /^\/conta/, /^\/perfil/,
  /^\/minhas-reservas/, /^\/reservas\//, /^\/ingressos/, /^\/viagens/,
  /^\/avaliacao/, /^\/configuracoes/, /^\/login/, /^\/cadastro/,
  /^\/esqueci-senha/, /^\/redefinir-senha/, /^\/verificar-email/,
  /^\/dev\//, /^\/webhooks\//, /^\/healthz/, /^\/readyz/, /^\/parceiro(\/|$)/,
];

function robotsPrivados(req, res, next) {
  if (PRIVADO.some((r) => r.test(req.path))) {
    res.set("X-Robots-Tag", "noindex, nofollow");
  }
  next();
}

/** URL absoluta a partir do domínio público configurado. */
function base() {
  return (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Valores padrão de SEO para toda view. Controllers sobrescrevem
 * res.locals.seo quando a página tem título/descrição/imagem próprios.
 */
function seoPadrao(req, res, next) {
  const t = req.t || ((chave, vars, padrao) => padrao);
  res.locals.seo = {
    titulo: t("seo.titulo_padrao", null, "AquaTrip | Experiências na água pelo Brasil"),
    descricao: t("seo.descricao_padrao", null, "Praias, mergulho, caiaque, pesca, aquários e expedições. Veja datas, vagas e reserve direto."),
    // Canônica sem query string: ?utm=... e filtros não viram páginas duplicadas.
    canonica: base() + req.path,
    imagem: base() + "/img/fernandonoronha.jpg",
    tipo: "website",
  };
  next();
}

module.exports = { robotsPrivados, seoPadrao, base, PRIVADO };
