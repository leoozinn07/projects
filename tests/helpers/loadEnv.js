/* Carrega as variáveis de teste antes de tudo. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const arquivo = path.join(__dirname, "..", "..", ".env.test");

if (fs.existsSync(arquivo)) {
  require("dotenv").config({ path: arquivo, override: true, quiet: true });
} else {
  /* Sem .env.test (ex.: CI): valores de teste públicos — os mesmos do
     workflow e do docker-compose — e segredos gerados a cada execução,
     para nenhum segredo precisar morar no repositório. */
  const padrao = {
    NODE_ENV: "test",
    PORT: "3001",
    PAYMENT_PROVIDER: "mock",
    PAYMENT_ENV: "sandbox",
    BOOKING_HOLD_MINUTES: "15",
    PUBLIC_BASE_URL: "http://localhost:3001",
    UPLOAD_DIR: "./tmp/test-uploads",
    REQUIRE_ADMIN_2FA: "false",
    SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
    PAYMENT_WEBHOOK_SECRET: crypto.randomBytes(16).toString("hex"),
    TOTP_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
  };
  for (const [chave, valor] of Object.entries(padrao)) {
    if (!process.env[chave]) process.env[chave] = valor;
  }
  // Sempre o banco de TESTE (a suíte apaga dados): uma DATABASE_URL de
  // desenvolvimento herdada do shell nunca é usada aqui.
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    || "mysql://aquatrip:aquatrip_dev_pw@127.0.0.1:3306/aquatrip_test";
}
