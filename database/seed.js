/* ==============================================================
   AquaTrip — Seed do usuário admin inicial
   Não existe (e não deve existir) um fluxo público de "virar
   admin" pelo cadastro comum — isso seria uma falha de RBAC
   (qualquer um poderia se promover). O primeiro admin é criado
   por este script, a partir de credenciais em .env.
   Uso: npm run db:seed
   ============================================================== */
require("dotenv").config({ quiet: true });
const argon2 = require("argon2");
const db = require("../app/lib/db");
const userRepository = require("../app/repositories/userRepository");

async function seed() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || "Administrador AquaTrip";

  if (!email || !password) {
    console.error(
      "[seed] Defina ADMIN_EMAIL e ADMIN_PASSWORD no .env antes de rodar o seed."
    );
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("[seed] ADMIN_PASSWORD precisa ter pelo menos 8 caracteres.");
    process.exit(1);
  }

  const existing = await userRepository.findByEmail(email.trim().toLowerCase());
  if (existing) {
    console.log(`[seed] usuário ${email} já existe (role atual: ${existing.role}). Nada a fazer.`);
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await userRepository.create({
    name,
    email: email.trim().toLowerCase(),
    passwordHash,
    role: "ADMIN",
  });

  console.log(`[seed] usuário admin criado: ${user.email} (id ${user.id})`);
}

seed()
  .catch((err) => {
    console.error("[seed] erro:", err);
    process.exit(1);
  })
  .finally(() => db.pool.end());
