/* ==============================================================
   AquaTrip — Seleção do provider de pagamento
   ==============================================================
   Único lugar do sistema que decide QUAL gateway está em uso.
   O resto do código chama `getPaymentProvider()` e não sabe (nem
   precisa saber) se por trás está Mercado Pago, mock ou outro.

   PAYMENT_PROVIDER = 'mercadopago' | 'mock' | (vazio = auto)
     auto: usa mercadopago se MP_ACCESS_TOKEN existir; senão mock.
   ============================================================== */
const mockProvider = require("./mockProvider");
const log = require("../logger").forModule("pagamentos");
const mercadoPagoProvider = require("./mercadoPagoProvider");

function resolveProviderName() {
  const explicit = (process.env.PAYMENT_PROVIDER || "").trim().toLowerCase();
  if (explicit) return explicit;
  return process.env.MP_ACCESS_TOKEN ? "mercadopago" : "mock";
}

function getPaymentProvider() {
  const providerName = resolveProviderName();
  const isProd = process.env.NODE_ENV === "production";

  if (providerName === "mercadopago") {
    if (!process.env.MP_ACCESS_TOKEN) {
      throw new Error(
        "[payments] PAYMENT_PROVIDER=mercadopago mas MP_ACCESS_TOKEN não está definido."
      );
    }
    // Trava de segurança: token de teste em produção (ou o contrário)
    // quase sempre é erro de configuração de deploy — falhar cedo e
    // alto é melhor do que cobrar (ou deixar de cobrar) errado.
    const token = process.env.MP_ACCESS_TOKEN;
    const isTestToken = token.startsWith("TEST-");
    const paymentEnv = process.env.PAYMENT_ENV || "sandbox";

    if (paymentEnv === "production" && isTestToken) {
      throw new Error(
        "[payments] PAYMENT_ENV=production com token TEST- do Mercado Pago. Configuração inválida."
      );
    }
    if (paymentEnv !== "production" && !isTestToken) {
      log.warn("AVISO: PAYMENT_ENV não é production mas o token não é TEST-. Confira as credenciais.");
    }
    return mercadoPagoProvider;
  }

  if (providerName === "mock") {
    if (isProd) {
      // Nunca deixar o mock "aprovar" pagamento de verdade em produção.
      throw new Error(
        "[payments] Provider simulado (mock) não pode ser usado com NODE_ENV=production."
      );
    }
    return mockProvider;
  }

  throw new Error(`[payments] PAYMENT_PROVIDER desconhecido: ${providerName}`);
}

/** Útil para a UI mostrar um aviso claro de "modo simulado". */
function isSimulated() {
  return resolveProviderName() === "mock";
}

module.exports = { getPaymentProvider, isSimulated, resolveProviderName };
