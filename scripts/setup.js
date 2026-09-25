#!/usr/bin/env node
/* ==============================================================
   AquaTrip — Configuração inicial (Windows, macOS e Linux)
   ==============================================================
   npm run setup

   Cria o .env a partir do .env.example e GERA os segredos (sessão,
   chave do 2FA e senha do admin). Se o .env já existe, não apaga
   nada: só preenche o que ainda estiver vazio ou com valor de exemplo.
   Existe porque "cp .env.example .env" não funciona no Prompt de
   Comando do Windows.
   ============================================================== */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const raiz = path.join(__dirname, "..");
const exemplo = path.join(raiz, ".env.example");
const destino = path.join(raiz, ".env");

const gerar = {
  SESSION_SECRET: () => crypto.randomBytes(48).toString("hex"),
  TOTP_ENCRYPTION_KEY: () => crypto.randomBytes(32).toString("base64"),
  ADMIN_PASSWORD: () => "Admin-" + crypto.randomBytes(6).toString("base64url") + "9!",
};
// Valores de exemplo que NÃO podem ficar no .env de ninguém.
const deExemplo = (v) => !v || /^troque/i.test(v);

const jaExistia = fs.existsSync(destino);
let texto = fs.readFileSync(jaExistia ? destino : exemplo, "utf8");
const preenchidos = [];

for (const [chave, fn] of Object.entries(gerar)) {
  const re = new RegExp(`^${chave}=(.*)$`, "m");
  const m = texto.match(re);
  if (m && deExemplo(m[1].trim())) {
    const valor = fn();
    texto = texto.replace(re, `${chave}=${valor}`);
    preenchidos.push([chave, valor]);
  } else if (!m) {
    const valor = fn();
    texto += `\n${chave}=${valor}\n`;
    preenchidos.push([chave, valor]);
  }
}
fs.writeFileSync(destino, texto);

const url = (texto.match(/^DATABASE_URL=(.*)$/m) || [])[1] || "";
const admin = (texto.match(/^ADMIN_EMAIL=(.*)$/m) || [])[1] || "";
const senhaAdmin = preenchidos.find(([k]) => k === "ADMIN_PASSWORD");

console.log(`\n${jaExistia ? ".env já existia — preenchido só o que faltava." : ".env criado a partir do .env.example."}`);
for (const [k] of preenchidos) console.log(`  gerado: ${k}`);
if (senhaAdmin) console.log(`\n  Login do admin: ${admin}  /  senha: ${senhaAdmin[1]}   (anote)`);

console.log(`\nBanco de dados configurado no .env:\n  ${url}`);
let u;
try { u = new URL(url); } catch { u = null; }
if (u) {
  const usuario = decodeURIComponent(u.username), senha = decodeURIComponent(u.password), banco = u.pathname.slice(1);
  console.log(`
Se ainda não criou esse banco, abra o MySQL Workbench (ou outro
cliente MySQL), conecte como root e rode:

  CREATE USER '${usuario}'@'localhost' IDENTIFIED BY '${senha}';
  CREATE DATABASE ${banco} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
  GRANT ALL PRIVILEGES ON ${banco}.* TO '${usuario}'@'localhost';
`);
}
console.log(`Ou crie o usuário e o banco automaticamente:

  npm run db:create

Depois, nesta pasta:

  npm run db:migrate
  npm run db:seed
  npm run db:seed:services
  npm run db:seed:demo
  npm start

A qualquer momento, "npm run doctor" diz o que ainda falta.
`);

// Diagnóstico logo em seguida: mostra o próximo passo já resolvido.
require("child_process").spawnSync(process.execPath, [path.join(__dirname, "doctor.js")], { stdio: "inherit" });
