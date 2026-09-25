/* ==============================================================
   AquaTrip — Rate limiting
   Limites por rota, calibrados pelo custo de cada abuso:
   - login/cadastro: brute force e credential stuffing
   - rotas de escrita: DoS de negócio (esgotar vagas sem pagar)
   - webhook: flood de eventos forjados
   ============================================================== */
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");

/* Em teste os limites sobem muito: a suíte dispara dezenas de
   requisições legítimas em segundos e o limitador (em memória,
   compartilhado entre suítes) começaria a barrar testes válidos,
   gerando falha intermitente. O comportamento continua coberto
   pelos testes que verificam os headers de limite. */
const isTest = process.env.NODE_ENV === "test";
const scale = (valor) => (isTest ? valor * 1000 : valor);

/** Resposta padrão: JSON para API/webhook, página de erro para navegação. */
function limitHandler(mensagem) {
  return (req, res) => {
    if (req.accepts("html") && !req.path.startsWith("/webhooks")) {
      return res.status(429).render("pages/erro", {
        statusCode: 429,
        title: "Muitas tentativas",
        message: mensagem,
        stack: null,
      });
    }
    return res.status(429).json({ error: "too many requests" });
  };
}

/**
 * Login e cadastro. Camada ADICIONAL ao bloqueio progressivo por
 * conta (userRepository.registerFailedLogin) — um limita por IP, o
 * outro por conta; contornar os dois é bem mais difícil.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: scale(20),
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler(
    "Muitas tentativas de acesso. Aguarde alguns minutos antes de tentar novamente."
  ),
});

/**
 * Rotas de escrita autenticadas (criar reserva, pagar, cancelar).
 * Sem isto, alguém logado pode martelar criação de reservas e
 * esgotar as vagas de todos os horários sem pagar nada — DoS de
 * negócio, que não derruba servidor e por isso passa despercebido.
 *
 * A chave é o usuário quando há sessão (e não só o IP): vários
 * clientes atrás do mesmo NAT não devem se prejudicar entre si.
 */
const writeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: scale(40),
  standardHeaders: true,
  legacyHeaders: false,
  // ipKeyGenerator normaliza IPv6 para /64 — sem isso, um atacante
  // com um bloco IPv6 trocaria de endereço a cada requisição e
  // passaria pelo limite à vontade.
  keyGenerator: (req, res) => req.session?.user?.id || ipKeyGenerator(req, res),
  handler: limitHandler(
    "Você fez muitas operações em pouco tempo. Aguarde alguns minutos."
  ),
});

/**
 * Webhook. Limite mais alto porque o gateway legitimamente reenvia
 * eventos, mas ainda assim finito: sem teto, um atacante poderia
 * inundar o endpoint com payloads forjados só para gerar carga
 * (cada um custa uma validação de assinatura).
 */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: scale(120),
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler("Too many requests."),
});

/**
 * Formulário de contato: público e sem login, então é o alvo
 * natural de spam. 5 mensagens por hora por IP é folgado para uma
 * pessoa e caro para um robô. O honeypot é a segunda camada.
 */
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: scale(5),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({
    sucesso: false,
    mensagem: "Você enviou várias mensagens em pouco tempo. Tente de novo mais tarde.",
  }),
});

/**
 * Interações sociais (curtir, seguir, comentar, interesse). Separado do
 * writeLimiter: curtir várias experiências seguidas não pode consumir a
 * cota de quem vai reservar. Por conta, não por IP.
 */
const socialLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: scale(150),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => req.session?.user?.id || ipKeyGenerator(req, res),
  handler: limitHandler("Você fez muitas interações em pouco tempo. Aguarde alguns minutos."),
});

/**
 * Assistente virtual: cada mensagem custa uma chamada paga à API de IA.
 * Freio curto por minuto aqui; a cota diária fica no chatbotService.
 */
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: scale(8),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => req.session?.user?.id || ipKeyGenerator(req, res),
  handler: (req, res) => res.status(429).json({ error: "Muitas mensagens seguidas. Espere um minuto e tente de novo." }),
});

module.exports = {
  socialLimiter,
  chatLimiter, loginLimiter, writeLimiter, webhookLimiter, contactLimiter };
