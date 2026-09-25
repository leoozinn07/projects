/* ==============================================================
   AquaTrip — Runner de migrations
   Aplica os arquivos .sql de database/migrations/ em ordem
   alfabética, registrando na tabela _migrations quais já rodaram.
   Uso: npm run db:migrate

   MySQL (diferente do Postgres): DDL (CREATE TABLE, ALTER TABLE...)
   faz commit implícito — não existe "ROLLBACK de CREATE TABLE" de
   verdade. Por isso não envolvemos a aplicação do arquivo numa
   transação como antes; cada migration continua idempotente
   (IF NOT EXISTS onde o MySQL suporta), então rodar de novo depois
   de corrigir um erro é seguro na prática — a única exceção é uma
   migration que já tenha chegado a criar uma CONSTRAINT (sem
   IF NOT EXISTS) antes de falhar; nesse caso raro, o próprio erro
   ao reaplicar já indica qual trecho remover/ajustar.
   ============================================================== */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error("[migrate] DATABASE_URL não definido no .env. Abortando.");
    process.exit(1);
  }

  // multipleStatements: cada arquivo .sql tem vários comandos — o
  // driver precisa dessa flag pra executar o arquivo inteiro de uma
  // vez, igual o pool do 'pg' fazia antes.
  const connection = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    multipleStatements: true,
    timezone: "Z",
  });

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name        VARCHAR(255) PRIMARY KEY,
        applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    const [appliedRows] = await connection.query("SELECT name FROM _migrations");
    const applied = new Set(appliedRows.map((r) => r.name));

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let ranAny = false;

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] já aplicada: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log(`[migrate] aplicando: ${file}`);

      try {
        await connection.query(sql);
        await connection.query("INSERT INTO _migrations (name) VALUES (?)", [file]);
        ranAny = true;
        console.log(`[migrate] OK: ${file}`);
      } catch (err) {
        console.error(`[migrate] FALHOU: ${file}`);
        throw err;
      }
    }

    if (!ranAny) console.log("[migrate] nada novo para aplicar.");
  } finally {
    await connection.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
