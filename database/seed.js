/* ==============================================================
   AquaTrip — Seed do usuário admin inicial
   Não existe (e não deve existir) um fluxo público de "virar
   admin" pelo cadastro comum — isso seria uma falha de RBAC
   (qualquer um poderia se promover). O primeiro admin é criado
   por este script, a partir de credenciais em .env.
   Se o admin já existe com outra senha, a senha passa a ser a do
   .env (o .env é a fonte da verdade do admin inicial).
   Uso: npm run db:seed
   ============================================================== */
require("dotenv").config({ quiet: true });
const argon2 = require("argon2");
const db = require("../app/lib/db");
const userRepository = require("../app/repositories/userRepository");
const auditService = require("../app/services/auditService");
const { AuditAction } = auditService;

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
    // Conta comum com o e-mail do admin: NUNCA é promovida por aqui.
    if (existing.role !== "ADMIN") {
      console.error(
        `[seed] ${email} já existe como conta comum (role ${existing.role}). Nada foi alterado.\n` +
        "       Use outro ADMIN_EMAIL no .env."
      );
      process.exitCode = 1;
      return;
    }
    // O .env é a fonte da senha do admin inicial. Antes, rodar o setup de
    // novo (clone novo, .env apagado) gerava e mostrava uma senha nova,
    // mas o admin do banco continuava com a antiga: o login dava
    // "E-mail ou senha inválidos" com a senha "certa".
    if (await argon2.verify(existing.password_hash, password)) {
      if (existing.locked_until && new Date(existing.locked_until) > new Date()) {
        await db.query(`UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?`, [existing.id]);
        console.log(`[seed] admin ${existing.email} estava bloqueado por tentativas erradas: desbloqueado.`);
      }
      console.log(`[seed] admin ${existing.email} já existe e a senha confere com o ADMIN_PASSWORD do .env.`);
      return;
    }
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await userRepository.updatePassword(existing.id, hash); // também desbloqueia a conta
    // Quem estava logado com a senha antiga sai.
    await db.query(
      `DELETE FROM session WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.user.id')) = ?`,
      [existing.id]
    ).catch(() => {}); // a tabela session nasce no primeiro "npm start"
    await auditService.log(AuditAction.PASSWORD_CHANGED, {
      userId: existing.id,
      metadata: { origem: "npm run db:seed", motivo: "senha do admin sincronizada com o .env" },
    });
    console.log(
      `[seed] admin ${existing.email} já existia com outra senha: a senha foi atualizada para a do ADMIN_PASSWORD do .env.`
    );
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
