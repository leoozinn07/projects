#!/usr/bin/env node
/* ==============================================================
   AquaTrip — Diagnóstico da configuração de pagamentos
   Uso: npm run pagamentos:verificar

   Roda na SUA máquina e confere, em ordem, tudo que precisa estar
   certo para o Mercado Pago sandbox funcionar. Em vez de você
   descobrir o erro só na hora de pagar, ele aponta exatamente qual
   passo está faltando.
   ============================================================== */
require("dotenv").config({ quiet: true });

const CHECK = "\x1b[32m✓\x1b[0m";
const CROSS = "\x1b[31m✗\x1b[0m";
const WARN = "\x1b[33m!\x1b[0m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

let hasError = false;
let hasWarning = false;

function ok(msg, detail) {
  console.log(`${CHECK} ${msg}`);
  if (detail) console.log(`  ${DIM}${detail}${RESET}`);
}
function fail(msg, fix) {
  hasError = true;
  console.log(`${CROSS} ${msg}`);
  if (fix) console.log(`  ${DIM}→ ${fix}${RESET}`);
}
function warn(msg, detail) {
  hasWarning = true;
  console.log(`${WARN} ${msg}`);
  if (detail) console.log(`  ${DIM}${detail}${RESET}`);
}
function section(title) {
  console.log(`\n${BOLD}${title}${RESET}`);
}

async function main() {
  console.log(`${BOLD}Diagnóstico de pagamentos — AquaTrip${RESET}`);

  /* ---------- 1. Qual provider está ativo ---------- */
  section("1. Provider");

  const explicit = (process.env.PAYMENT_PROVIDER || "").trim().toLowerCase();
  const token = process.env.MP_ACCESS_TOKEN;
  const provider = explicit || (token ? "mercadopago" : "mock");

  if (provider === "mock") {
    ok("Provider: mock (simulado)", "Nenhuma cobrança real é processada.");
    console.log(
      `\n${DIM}Para ativar o Mercado Pago, preencha MP_ACCESS_TOKEN no .env${RESET}`
    );
    console.log(`${DIM}e rode este comando de novo. Guia: docs/ativar-mercado-pago.md${RESET}\n`);
    return;
  }

  ok(`Provider: ${provider}`);

  /* ---------- 2. Credenciais ---------- */
  section("2. Credenciais");

  if (!token) {
    fail(
      "MP_ACCESS_TOKEN não está definido",
      "Copie o Access Token de TESTE do painel do Mercado Pago para o .env"
    );
    return;
  }

  const isTestToken = token.startsWith("TEST-");
  const isProdToken = token.startsWith("APP_USR-");
  const paymentEnv = process.env.PAYMENT_ENV || "sandbox";

  if (!isTestToken && !isProdToken) {
    fail(
      "MP_ACCESS_TOKEN não parece válido",
      "Deve começar com TEST- (sandbox) ou APP_USR- (produção)"
    );
  } else {
    ok(`Token presente (${isTestToken ? "TEST- sandbox" : "APP_USR- produção"})`,
       `${token.slice(0, 12)}…${token.slice(-4)}`);
  }

  if (paymentEnv === "production" && isTestToken) {
    fail(
      "PAYMENT_ENV=production com token TEST-",
      "A aplicação recusa subir assim de propósito. Use PAYMENT_ENV=sandbox."
    );
  } else if (paymentEnv !== "production" && isProdToken) {
    warn(
      "PAYMENT_ENV=sandbox mas o token é de PRODUÇÃO (APP_USR-)",
      "ATENÇÃO: cobranças reais podem ser processadas."
    );
  } else {
    ok(`PAYMENT_ENV=${paymentEnv} coerente com o token`);
  }

  if (!process.env.MP_WEBHOOK_SECRET) {
    fail(
      "MP_WEBHOOK_SECRET não está definido",
      "Sem ele, TODO webhook do Mercado Pago será rejeitado com 401. " +
        "Pegue em: Painel > Sua aplicação > Webhooks > Assinatura secreta"
    );
  } else {
    ok("MP_WEBHOOK_SECRET presente");
  }

  /* ---------- 3. Conexão com a API ---------- */
  section("3. Conexão com a API do Mercado Pago");

  try {
    const res = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      fail(
        "Token rejeitado pelo Mercado Pago (401)",
        "O token está inválido, expirado ou foi revogado. Gere outro no painel."
      );
    } else if (res.status === 403) {
      // 403 do próprio Mercado Pago é raro; quase sempre é proxy ou
      // firewall no caminho devolvendo o bloqueio. Não faça a pessoa
      // trocar um token que está correto.
      const denyReason = res.headers.get("x-deny-reason");
      if (denyReason) {
        fail(
          `Requisição bloqueada pela rede (${denyReason})`,
          "Um proxy/firewall está barrando api.mercadopago.com — não é problema do token."
        );
      } else {
        fail(
          "Mercado Pago respondeu 403",
          "A aplicação pode não ter permissão para este recurso. Confira o painel."
        );
      }
    } else if (!res.ok) {
      fail(`API respondeu ${res.status}`, "Verifique o token e tente novamente.");
    } else {
      const me = await res.json();
      ok("Token aceito pela API", `conta: ${me.nickname || me.id} · país: ${me.site_id || "?"}`);
      if (me.site_id && me.site_id !== "MLB") {
        warn(
          `A conta é do site ${me.site_id}, não MLB (Brasil)`,
          "PIX só funciona em contas brasileiras."
        );
      }
    }
  } catch (err) {
    fail(
      "Não foi possível alcançar api.mercadopago.com",
      `Rede bloqueada ou sem internet. Detalhe: ${err.message}`
    );
  }

  /* ---------- 4. Webhook / URL pública ---------- */
  section("4. Webhook");

  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl) {
    fail(
      "PUBLIC_BASE_URL não está definido",
      "Sem isso o Mercado Pago não sabe para onde mandar a confirmação do pagamento."
    );
  } else if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
    fail(
      `PUBLIC_BASE_URL aponta para ${baseUrl}`,
      "O Mercado Pago precisa de uma URL PÚBLICA. Rode o ngrok e use a URL dele."
    );
  } else if (!baseUrl.startsWith("https://")) {
    warn(`PUBLIC_BASE_URL não usa HTTPS (${baseUrl})`, "O Mercado Pago exige HTTPS.");
  } else {
    ok(`PUBLIC_BASE_URL: ${baseUrl}`);

    const webhookUrl = `${baseUrl}/webhooks/payments`;
    console.log(`\n  ${BOLD}Cadastre esta URL no painel do Mercado Pago:${RESET}`);
    console.log(`  ${webhookUrl}\n`);

    // Confere se o túnel está realmente de pé e chegando na aplicação.
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ping: true }),
      });
      if (res.status === 401) {
        ok("Túnel ativo e webhook respondendo",
           "401 aqui é o esperado: a requisição de teste não tem assinatura válida.");
      } else if (res.status === 400) {
        ok("Túnel ativo e webhook respondendo", `status ${res.status}`);
      } else {
        warn(`Webhook respondeu ${res.status}`, "Esperado 400/401 para um ping sem assinatura.");
      }
    } catch (err) {
      fail(
        "Não foi possível alcançar o webhook pela URL pública",
        "O ngrok está rodando? A aplicação está de pé na porta certa?"
      );
    }
  }

  /* ---------- Resumo ---------- */
  section("Resumo");
  if (hasError) {
    console.log(`${CROSS} Há pendências acima. Corrija-as antes de testar pagamentos.\n`);
    process.exitCode = 1;
  } else if (hasWarning) {
    console.log(`${WARN} Configuração funcional, mas revise os avisos acima.\n`);
  } else {
    console.log(`${CHECK} Tudo pronto. Pode testar o fluxo em /reservar\n`);
  }
}

main().catch((err) => {
  console.error("Erro inesperado no diagnóstico:", err);
  process.exit(1);
});
