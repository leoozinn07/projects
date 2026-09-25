#!/usr/bin/env node
/* ==============================================================
   AquaTrip — Criar o banco automaticamente (npm run db:create)
   ==============================================================
   Cria o usuário e o banco definidos na DATABASE_URL do .env, usando
   a conta de administrador do MySQL (normalmente "root").
   Evita o passo manual no MySQL Workbench, que é onde a instalação
   costuma parar.

   A senha do administrador é pedida na hora, não fica em disco nem
   aparece na tela. Idempotente: se o usuário ou o banco já existem,
   apenas ajusta a senha e segue.
   ============================================================== */
require("dotenv").config({ quiet: true });
const readline = require("readline");
const mysql = require("mysql2/promise");

/**
 * Lê as credenciais do administrador do MySQL. Três caminhos:
 *  1. variáveis MYSQLADMIN_USER / MYSQLADMIN_PASSWORD (automação e testes);
 *  2. terminal de verdade: pergunta e esconde a senha com asteriscos;
 *  3. entrada redirecionada (script, pipe): lê duas linhas simples.
 * O caminho 3 existe porque a emulação de terminal consome as linhas
 * de uma vez e o comando travava depois da primeira pergunta.
 */
async function credenciaisAdmin() {
  if (process.env.MYSQLADMIN_PASSWORD) {
    return { admin: process.env.MYSQLADMIN_USER || "root", senhaAdmin: process.env.MYSQLADMIN_PASSWORD };
  }

  console.log("Para isso preciso entrar como administrador do MySQL");
  console.log('(a conta criada na instalação, normalmente "root").\n');

  if (!process.stdin.isTTY) {
    const linhas = [];
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    for await (const l of rl) { linhas.push(l.trim()); if (linhas.length === 2) break; }
    rl.close();
    return { admin: linhas[0] || "root", senhaAdmin: linhas[1] || "" };
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const escrever = rl._writeToOutput.bind(rl);
  let silenciar = false;
  rl._writeToOutput = (t) => (silenciar ? rl.output.write("*") : escrever(t));
  const perguntar = (texto, oculto) => new Promise((resolve) => {
    rl.question(texto, (r) => { if (oculto) { silenciar = false; process.stdout.write("\n"); } resolve(String(r).trim()); });
    if (oculto) silenciar = true;
  });
  const admin = (await perguntar("Usuário administrador [root]: ", false)) || "root";
  const senhaAdmin = await perguntar(`Senha de ${admin}: `, true);
  rl.close();
  return { admin, senhaAdmin };
}

/** Identificador em SQL: cercado de crase, com crase interna escapada. */
const ident = (s) => "`" + String(s).replace(/`/g, "``") + "`";

async function main() {
  let u;
  try { u = new URL(process.env.DATABASE_URL); } catch {
    console.error("\nDATABASE_URL ausente ou inválida no .env. Rode antes:  npm run setup\n");
    process.exitCode = 1;
    return;
  }
  const host = u.hostname, porta = Number(u.port || 3306);
  const usuario = decodeURIComponent(u.username);
  const senha = decodeURIComponent(u.password);
  const banco = u.pathname.slice(1);

  console.log(`\nVou criar no MySQL de ${host}:${porta}:`);
  console.log(`  usuário: ${usuario}`);
  console.log(`  banco:   ${banco}\n`);
  const { admin, senhaAdmin } = await credenciaisAdmin();

  let c;
  try {
    c = await mysql.createConnection({ host, port: porta, user: admin, password: senhaAdmin, connectTimeout: 8000 });
  } catch (e) {
    const dica = e.code === "ER_ACCESS_DENIED_ERROR"
      ? "Senha do administrador incorreta. É a senha definida na instalação do MySQL."
      : e.code === "ECONNREFUSED"
        ? "O MySQL não está rodando. Windows/macOS: abra o MySQL Workbench e confira o servidor local. Linux: sudo service mysql start."
        : e.message;
    console.error("\nNão consegui entrar como administrador: " + dica + "\n");
    process.exitCode = 1;
    return;
  }

  try {
    const [temUsuario] = await c.query(
      "SELECT 1 FROM mysql.user WHERE user = ? AND host IN ('localhost','127.0.0.1')",
      [usuario]
    );
    if (temUsuario.length) {
      await c.query(`ALTER USER ${ident(usuario)}@'localhost' IDENTIFIED BY ?`, [senha]);
      await c.query(`ALTER USER ${ident(usuario)}@'127.0.0.1' IDENTIFIED BY ?`, [senha]);
      console.log(`\n  usuário "${usuario}" já existia — senha sincronizada com o .env`);
    } else {
      await c.query(`CREATE USER ${ident(usuario)}@'localhost' IDENTIFIED BY ?`, [senha]);
      await c.query(`CREATE USER ${ident(usuario)}@'127.0.0.1' IDENTIFIED BY ?`, [senha]);
      console.log(`\n  usuário "${usuario}" criado`);
    }

    const [temBanco] = await c.query("SHOW DATABASES LIKE ?", [banco]);
    if (temBanco.length) {
      console.log(`  banco "${banco}" já existia`);
    } else {
      // utf8mb4_0900_ai_ci: já é a collation padrão do MySQL 8, mas
      // fica explícita aqui porque é ela que faz e-mail e busca por
      // nome se comportarem como "case-insensitive" (equivalente ao
      // CITEXT/ILIKE que o Postgres usava).
      await c.query(
        `CREATE DATABASE ${ident(banco)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
      );
      console.log(`  banco "${banco}" criado`);
    }

    await c.query(`GRANT ALL PRIVILEGES ON ${ident(banco)}.* TO ${ident(usuario)}@'localhost'`);
    await c.query(`GRANT ALL PRIVILEGES ON ${ident(banco)}.* TO ${ident(usuario)}@'127.0.0.1'`);
    await c.query("FLUSH PRIVILEGES");
    console.log("  permissões concedidas");
  } catch (e) {
    console.error("\nFalhou: " + e.message + "\n");
    process.exitCode = 1;
    return;
  } finally {
    await c.end();
  }

  console.log("\nPronto. Agora rode, nesta ordem:\n");
  console.log("  npm run db:migrate");
  console.log("  npm run db:seed");
  console.log("  npm run db:seed:services");
  console.log("  npm run db:seed:demo");
  console.log("  npm start\n");
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
