/* Roda as migrations no banco de TESTE (.env.test). */
require("dotenv").config({ path: ".env.test", override: true, quiet: true });
require("./migrate.js");
