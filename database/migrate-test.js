/* Roda as migrations no banco de TESTE (.env.test). */
// Mesmo carregamento da suíte (inclui o fallback sem .env.test, usado no CI).
require("../tests/helpers/loadEnv");
require("./migrate.js");
