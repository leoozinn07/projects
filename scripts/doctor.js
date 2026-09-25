#!/usr/bin/env node
/* ==============================================================
   AquaTrip — Diagnóstico (npm run doctor)
   ==============================================================
   Verifica, em ordem, tudo que o site precisa para subir e diz
   exatamente o que fazer em cada falha. Existe porque a mensagem
   "não conseguiu falar com o banco" tem cinco causas diferentes,
   e cada uma tem uma solução diferente.
   ============================================================== */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const net = require("net");
const path = require("path");

const ok = (m) => console.log("  \x1b[32mOK\x1b[0m    " + m);
const erro = (m, comoResolver) => { console.log("  \x1b[31mFALHA\x1b[0m " + m); if (comoResolver) console.log("\n" + comoResolver + "\n"); };
const aviso = (m) => console.log("  \x1b[33m!\x1b[0m     " + m);

function testarPorta(host, porta, ms = 3000) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port: porta });
    const fim = (r) => { s.destroy(); resolve(r); };
    s.setTimeout(ms);
    s.on("connect", () => fim(true));
    s.on("timeout", () => fim(false));
    s.on("error", () => fim(false));
  });
}

async function main() {
  console.log("\nDiagnóstico do AquaTrip\n");

  // 1. .env
  if (!fs.existsSync(path.join(process.cwd(), ".env"))) {
    return erro("Arquivo .env não encontrado em " + process.cwd(),
      "  Rode:  npm run setup\n  (Confira também se o terminal está na pasta do projeto, onde fica o package.json.)");
  }
  ok(".env encontrado");

  for (const [chave, dica] of [["SESSION_SECRET", ""], ["TOTP_ENCRYPTION_KEY", ""]]) {
    const v = process.env[chave];
    if (!v || /^troque/i.test(v)) return erro(`${chave} vazio ou com valor de exemplo`, "  Rode:  npm run setup" + dica);
  }
  if (Buffer.from(process.env.TOTP_ENCRYPTION_KEY, "base64").length !== 32) {
    return erro("TOTP_ENCRYPTION_KEY não tem 32 bytes", "  Apague essa linha do .env e rode:  npm run setup");
  }
  ok("segredos configurados");

  // 2. DATABASE_URL
  let u;
  try { u = new URL(process.env.DATABASE_URL); } catch {
    return erro("DATABASE_URL ausente ou mal formada",
      "  Exemplo no .env:\n  DATABASE_URL=mysql://aquatrip:aquatrip_dev_pw@localhost:3306/aquatrip");
  }
  const host = u.hostname, porta = Number(u.port || 3306);
  const usuario = decodeURIComponent(u.username), banco = u.pathname.slice(1);
  ok(`DATABASE_URL lida: usuário "${usuario}", banco "${banco}", ${host}:${porta}`);

  // 3. MySQL ligado?
  if (!(await testarPorta(host, porta))) {
    return erro(`nada respondendo em ${host}:${porta} — o MySQL parece parado`,
      "  Windows/macOS: abra o MySQL Workbench e confira se o servidor local está iniciado\n" +
      "  Linux:   sudo service mysql start");
  }
  ok("MySQL respondendo");

  // 4. Login, banco e tabelas
  const mysql = require("mysql2/promise");
  let c;
  try {
    c = await mysql.createConnection({ uri: process.env.DATABASE_URL, connectTimeout: 5000, timezone: "Z" });
  } catch (e) {
    if (e.code === "ER_ACCESS_DENIED_ERROR") {
      return erro(`o MySQL recusou o login do usuário "${usuario}" (senha incorreta ou usuário inexistente)`,
        "  Crie o usuário e o banco automaticamente:  npm run db:create");
    }
    if (e.code === "ER_BAD_DB_ERROR") {
      return erro(`o banco "${banco}" não existe`, "  Crie automaticamente:  npm run db:create");
    }
    return erro(`não foi possível conectar: ${e.message}`, "  Confira a DATABASE_URL no .env.");
  }
  ok(`login no banco "${banco}" funcionando`);

  try {
    const [rows] = await c.query(
      `SELECT count(*) AS n FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name IN ('users','services','bookings','payments','partners')`);
    if (rows[0].n < 5) {
      erro("faltam tabelas no banco", "  Rode:  npm run db:migrate");
      return;
    }
    ok("tabelas criadas");

    const [d] = await c.query(
      `SELECT (SELECT count(*) FROM users) AS usuarios,
              (SELECT count(*) FROM services) AS experiencias,
              (SELECT count(*) FROM partners) AS parceiros`);
    if (!d[0].usuarios) aviso("nenhum usuário — rode: npm run db:seed");
    if (!d[0].experiencias) aviso("nenhuma experiência — rode: npm run db:seed:services");
    if (!d[0].parceiros) aviso("nenhum parceiro de demonstração — rode: npm run db:seed:demo");
    if (d[0].usuarios && d[0].experiencias && d[0].parceiros) {
      ok(`dados presentes: ${d[0].usuarios} usuário(s), ${d[0].experiencias} experiência(s), ${d[0].parceiros} parceiro(s)`);
      console.log("\nTudo pronto. Rode:  npm start   e abra http://localhost:3000\n");
    } else {
      console.log("");
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error("\nErro inesperado no diagnóstico:", e.message, "\n"); process.exitCode = 1; });
