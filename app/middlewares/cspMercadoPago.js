/* ==============================================================
   AquaTrip · CSP do checkout com Mercado Pago
   ==============================================================
   O site inteiro roda sem script de terceiro (script-src 'self').
   A única exceção é a página de pagamento quando há gateway real:
   o formulário de cartão do Mercado Pago (Card Payment Brick) é um
   script deles que desenha campos em iframes deles. É isso que tira
   o número do cartão do nosso servidor (PCI), então vale a exceção,
   mas SÓ nesta rota e SÓ com o provider real ativo.

   O middleware reescreve o cabeçalho que o helmet já montou,
   acrescentando as origens do Mercado Pago em cada diretiva.
   ============================================================== */
const { isSimulated } = require("../lib/payments");

const ORIGENS = {
  "script-src": ["https://sdk.mercadopago.com", "https://*.mercadopago.com", "https://*.mlstatic.com"],
  "connect-src": ["https://*.mercadopago.com", "https://*.mercadolibre.com", "https://*.mercadolivre.com", "https://*.mlstatic.com"],
  "frame-src": ["https://*.mercadopago.com", "https://*.mercadolibre.com", "https://*.mercadolivre.com"],
  "font-src": ["https://*.mlstatic.com"],
  "style-src": ["https://*.mlstatic.com"],
};

/** Acrescenta origens a uma política CSP em texto. Exportada para teste. */
function ampliar(politica, extras = ORIGENS) {
  const diretivas = new Map(
    String(politica || "")
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [nome, ...valores] = d.split(/\s+/);
        return [nome, valores];
      })
  );
  for (const [nome, origens] of Object.entries(extras)) {
    // Diretiva ausente herda de default-src: começa com 'self'.
    const atual = diretivas.get(nome) || ["'self'"];
    diretivas.set(nome, [...new Set([...atual, ...origens])]);
  }
  return [...diretivas].map(([n, v]) => [n, ...v].join(" ")).join(";");
}

function cspMercadoPago(req, res, next) {
  if (isSimulated()) return next();
  const atual = res.getHeader("Content-Security-Policy");
  if (atual) res.setHeader("Content-Security-Policy", ampliar(atual));
  next();
}

module.exports = { cspMercadoPago, ampliar, ORIGENS };
