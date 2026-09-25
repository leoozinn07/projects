/* ==============================================================
   AquaTrip — Configuração do Jest
   runInBand (no script): os testes compartilham o mesmo banco, então
   rodar em paralelo causaria interferência entre suítes.
   ============================================================== */
module.exports = {
  testEnvironment: "node",
  // Carrega .env.test ANTES de qualquer require da aplicação —
  // senão app/lib/db.js leria a DATABASE_URL de desenvolvimento.
  setupFiles: ["<rootDir>/tests/helpers/loadEnv.js"],
  setupFilesAfterEnv: ["<rootDir>/tests/helpers/setup.js"],
  testMatch: ["<rootDir>/tests/**/*.test.js"],
  collectCoverageFrom: [
    "app/services/**/*.js",
    "app/controllers/**/*.js",
    "app/repositories/**/*.js",
    "app/middlewares/**/*.js",
    "app/lib/**/*.js",
  ],
  testTimeout: 15000,
};
