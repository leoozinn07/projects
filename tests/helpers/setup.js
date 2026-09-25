/* Fecha o pool do banco ao fim da suíte para o Jest não travar. */
const db = require("../../app/lib/db");

afterAll(async () => {
  await db.end();
});
