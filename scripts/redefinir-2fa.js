#!/usr/bin/env node
/* ==============================================================
   AquaTrip — Redefinir o 2FA de uma conta (acesso de emergência)
   ==============================================================
   Uso:
     npm run 2fa:redefinir -- admin@exemplo.com              # só mostra
     npm run 2fa:redefinir -- admin@exemplo.com --confirmar  # aplica

   Para quê: o painel impede redefinir o PRÓPRIO 2FA (seria o atalho
   exato que um invasor com a senha procuraria). Então, se o ÚNICO
   administrador perder o celular E os códigos de recuperação, só
   resta este caminho.

   Por que é seguro existir: rodar isto exige acesso ao SERVIDOR e às
   credenciais do BANCO — um nível de acesso acima do painel. Mesmo
   assim, fica registrado na auditoria (com o usuário do sistema que
   executou) e o dono da conta é avisado por e-mail.
   ============================================================== */
require("dotenv").config({ quiet: true });
const os = require("os");
const db = require("../app/lib/db");
const twoFactor = require("../app/services/twoFactorService");
const auditService = require("../app/services/auditService");
const mailService = require("../app/services/mailService");

const email = (process.argv[2] || "").trim().toLowerCase();
const CONFIRMAR = process.argv.includes("--confirmar");

async function main() {
  if (!email || !email.includes("@")) {
    console.log("Uso: npm run 2fa:redefinir -- email@da.conta [--confirmar]");
    process.exitCode = 1;
    return;
  }

  const { rows } = await db.query(
    `SELECT id, name, email, role, totp_enabled_at,
            (SELECT COUNT(*) FROM recovery_codes r WHERE r.user_id = u.id AND r.used_at IS NULL) AS codigos
     FROM users u WHERE email = $1`,
    [email]
  );
  const u = rows[0];
  if (u) u.codigos = Number(u.codigos);
  if (!u) {
    console.log(`Nenhuma conta com o e-mail ${email}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nConta:   ${u.name} <${u.email}> — ${u.role}`);
  console.log(`2FA:     ${u.totp_enabled_at ? "ativo desde " + u.totp_enabled_at.toISOString().slice(0, 10) : "não configurado"}`);
  console.log(`Códigos: ${u.codigos} de recuperação ainda não usados`);

  if (!u.totp_enabled_at) {
    console.log("\nNada a fazer: esta conta não tem 2FA ativo.\n");
    return;
  }
  if (u.codigos > 0) {
    console.log("\nATENÇÃO: a conta ainda tem códigos de recuperação válidos.");
    console.log("Se o dono tem acesso a eles, deve entrar com um código — não é preciso redefinir.");
  }

  if (!CONFIRMAR) {
    console.log("\nSIMULAÇÃO. Com --confirmar, isto vai:");
    console.log("  - remover o 2FA e os códigos de recuperação da conta");
    console.log("  - encerrar todas as sessões abertas dela");
    console.log("  - registrar na auditoria e avisar o dono por e-mail");
    console.log("  - no próximo login, se for admin, ele será obrigado a configurar de novo\n");
    return;
  }

  await twoFactor.desativar(u.id);
  const { rowCount: sessoes } = await db.query(
    `DELETE FROM session WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.user.id')) = $1`,
    [u.id]
  );
  await auditService.log(auditService.AuditAction.MFA_RESET_BY_SERVER, {
    userId: u.id,
    metadata: { origem: "script no servidor", usuarioDoSistema: os.userInfo().username, host: os.hostname(), sessoesEncerradas: sessoes },
  });
  try {
    await mailService.send({
      to: u.email,
      template: "2fa_redefinido",
      subject: "Sua verificação em duas etapas foi redefinida — AquaTrip",
      text: `${u.name}, a verificação em duas etapas da sua conta foi redefinida por acesso direto ao servidor. ` +
            `Configure de novo no próximo login. Se você não pediu isso, trate como incidente de segurança.`,
    });
  } catch { /* o registro na auditoria já foi feito */ }

  console.log(`\nFeito. 2FA removido, ${sessoes} sessão(ões) encerrada(s), dono avisado e registro na auditoria.\n`);
}

main()
  .catch((err) => { console.error("Erro:", err.message); process.exitCode = 1; })
  .finally(() => db.end());
