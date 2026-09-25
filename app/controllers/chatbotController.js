/* ==============================================================
   AquaTrip — API do assistente virtual
   O navegador envia só { mensagem }. Nada de histórico, instruções
   ou modelo vindo do cliente (ver chatbotService).
   ============================================================== */
const { z } = require("zod");
const chatbotService = require("../services/chatbotService");

const mensagemSchema = z.object({ mensagem: z.string().max(4000) });

function status(req, res) {
  res.set("Cache-Control", "no-store");
  res.json({
    disponivel: chatbotService.disponivel(),
    historico: chatbotService.historico(req),
  });
}

async function mensagem(req, res, next) {
  const parsed = mensagemSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(422).json({ error: "Mensagem inválida." });
  try {
    res.set("Cache-Control", "no-store");
    res.json(await chatbotService.responder({ req, mensagem: parsed.data.mensagem }));
  } catch (err) {
    if (err instanceof chatbotService.ChatError) {
      return res.status(err.status).json({ error: err.message, codigo: err.code });
    }
    next(err);
  }
}

function limpar(req, res) {
  chatbotService.limparConversa(req);
  res.status(204).end();
}

module.exports = { status, mensagem, limpar };
