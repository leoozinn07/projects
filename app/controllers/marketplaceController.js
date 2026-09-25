/* ==============================================================
   AquaTrip — Rotas da conexão do parceiro com o Mercado Pago
   ============================================================== */
const crypto = require("crypto");
const svc = require("../services/marketplaceService");

const voltar = (res, q) => res.redirect(`/parceiro?${new URLSearchParams(q)}`);

async function conectar(req, res) {
  try {
    const url = await svc.iniciar(req);
    // Salva a sessão ANTES de sair do site: o state precisa estar lá na volta.
    req.session.save(() => res.redirect(url));
  } catch (err) {
    if (err instanceof svc.MarketplaceError) return voltar(res, { mp_erro: err.message });
    throw err;
  }
}

async function retorno(req, res, next) {
  try {
    if (req.query.error) return voltar(res, { mp_erro: "A conexão foi cancelada no Mercado Pago." });
    await svc.concluir({ req, code: req.query.code, state: req.query.state });
    voltar(res, { mp: "conectado" });
  } catch (err) {
    if (err instanceof svc.MarketplaceError) return voltar(res, { mp_erro: err.message });
    next(err);
  }
}

/** Só em desenvolvimento com PAYMENT_PROVIDER=mock: imita a tela de consentimento. */
function simulador(req, res) {
  if (!svc.simulado()) return res.status(404).render("pages/erro", { statusCode: 404, title: "Não encontrado", message: "", stack: null });
  res.render("pages/mp_simulador", { state: String(req.query.state || ""), sufixo: crypto.randomBytes(4).toString("hex") });
}

async function desconectar(req, res) {
  try {
    await svc.desconectar({ req });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof svc.MarketplaceError) return res.status(err.status).json({ error: err.message, codigo: err.code });
    res.status(500).json({ error: "Falha ao desconectar." });
  }
}

module.exports = { conectar, retorno, simulador, desconectar };
