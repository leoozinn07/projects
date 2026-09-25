/* ==============================================================
   AquaTrip · Mensagens de uma vez só
   Valores guardados na sessão que valem para a PRÓXIMA página:
   - boasVindas: primeiro nome, depois do login (tela com a onda)
   - emailCadastro: e-mail recém-cadastrado, para já vir preenchido
     no login (a senha nunca é guardada)
   Só são consumidos em GET de página, nunca em chamada de API ou
   arquivo, para não se perderem num fetch em segundo plano.
   ============================================================== */
function umaVez(req, res, next) {
  const pagina = req.method === "GET" && !req.path.startsWith("/api/") && req.accepts(["html", "json"]) === "html";
  if (!pagina || !req.session) return next();
  if (req.session.boasVindas) {
    res.locals.boasVindas = req.session.boasVindas;
    delete req.session.boasVindas;
  }
  if (req.session.emailCadastro) {
    res.locals.emailCadastro = req.session.emailCadastro;
    delete req.session.emailCadastro;
  }
  next();
}

module.exports = { umaVez };
