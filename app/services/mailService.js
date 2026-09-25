/* ==============================================================
   AquaTrip — Serviço de e-mail
   ==============================================================
   Mesma estratégia do gateway de pagamento: uma fronteira só, para
   trocar de provedor sem mexer no resto do sistema.

   Sem SMTP configurado, o transporte "dev" escreve o e-mail em
   ./tmp/emails/ e registra no console. O fluxo inteiro (incluindo o
   link com token) pode ser testado sem provedor nenhum — e, o que
   importa mais, sem enviar e-mail de verdade para endereço real
   durante o desenvolvimento.

   Variáveis:
     MAIL_TRANSPORT=dev|smtp   (vazio = dev)
     MAIL_FROM
     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
   ============================================================== */
const fs = require("fs");
const log = require("../lib/logger").forModule("email");
const path = require("path");
const db = require("../lib/db");
const fmt = require("../lib/datas");

const MAIL_DIR = path.join(process.cwd(), "tmp", "emails");

function transportName() {
  const explicit = (process.env.MAIL_TRANSPORT || "").trim().toLowerCase();
  if (explicit) return explicit;
  return process.env.SMTP_HOST ? "smtp" : "dev";
}

function fromAddress() {
  return process.env.MAIL_FROM || "AquaTrip <nao-responda@aquatrip.local>";
}

/** Escreve o e-mail em disco — o "provedor" do ambiente de dev. */
async function sendViaDev({ to, subject, text, html, template }) {
  fs.mkdirSync(MAIL_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(MAIL_DIR, `${stamp}_${template || "email"}.txt`);

  const conteudo = [
    `De:      ${fromAddress()}`,
    `Para:    ${to}`,
    `Assunto: ${subject}`,
    `Data:    ${fmt.dataHora(new Date())}`,
    "",
    "--- TEXTO ---",
    text || "",
    "",
    "--- HTML ---",
    html || "",
    "",
  ].join("\n");

  fs.writeFileSync(file, conteudo, "utf8");

  if (process.env.NODE_ENV !== "test") {
    log.info(`\n[mail] (modo dev, nada foi enviado de verdade)`);
    log.info(`para: ${to} | assunto: ${subject}`);
    log.info(`arquivo: ${file}\n`);
  }

  return { file };
}

/** Envio real por SMTP. Exige nodemailer instalado. */
async function sendViaSmtp({ to, subject, text, html }) {
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    throw new Error(
      "[mail] MAIL_TRANSPORT=smtp exige o pacote nodemailer. Rode: npm install nodemailer"
    );
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });

  return transporter.sendMail({ from: fromAddress(), to, subject, text, html });
}

/**
 * Envia e registra. Uma falha de envio NÃO derruba o fluxo que a
 * originou: quem chama decide o que fazer, e o usuário recebe uma
 * mensagem genérica de qualquer forma (ver authController).
 */
async function send({ to, subject, text, html, template = null }) {
  const transporte = transportName();
  let status = "SENT";
  let erro = null;

  try {
    if (transporte === "smtp") {
      await sendViaSmtp({ to, subject, text, html });
    } else {
      await sendViaDev({ to, subject, text, html, template });
    }
  } catch (err) {
    status = "FAILED";
    erro = err.message;
    log.error({ err }, "falha ao enviar");
  }

  try {
    await db.query(
      `INSERT INTO email_log (to_address, subject, template, status, error)
       VALUES (?, ?, ?, ?, ?)`,
      [to, subject, template, status, erro]
    );
  } catch (err) {
    log.error({ err }, "falha ao registrar envio");
  }

  if (status === "FAILED") throw new Error(erro);
  return { status };
}

/* ==============================================================
   Templates
   ============================================================== */

function layout(titulo, corpo, cta) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#050d1a;font-family:Arial,Helvetica,sans-serif;color:#d4f0fb">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <h1 style="color:#06b6d4;font-size:22px;margin:0 0 16px">AquaTrip</h1>
    <h2 style="color:#f0f8ff;font-size:18px;margin:0 0 12px">${titulo}</h2>
    <div style="font-size:14px;line-height:1.6;color:#93b3ce">${corpo}</div>
    ${
      cta
        ? `<p style="margin:24px 0">
             <a href="${cta.url}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#06b6d4;color:#00222e;font-weight:bold;text-decoration:none">${cta.label}</a>
           </p>
           <p style="font-size:12px;color:#5f7f99;word-break:break-all">
             Se o botão não funcionar, copie este endereço:<br>${cta.url}
           </p>`
        : ""
    }
    <hr style="border:none;border-top:1px solid #16334d;margin:24px 0">
    <p style="font-size:11px;color:#5f7f99">
      Você recebeu este e-mail porque alguém usou este endereço no AquaTrip.
      Se não foi você, pode ignorar esta mensagem com segurança.
    </p>
  </div>
</body></html>`;
}

async function sendPasswordReset({ to, name, url, expiraEmMinutos }) {
  const primeiroNome = (name || "").split(" ")[0] || "Olá";
  return send({
    to,
    template: "password_reset",
    subject: "Redefinição de senha — AquaTrip",
    text:
      `${primeiroNome}, recebemos um pedido para redefinir sua senha no AquaTrip.\n\n` +
      `Abra este endereço para criar uma nova senha:\n${url}\n\n` +
      `O link vale por ${expiraEmMinutos} minutos e só pode ser usado uma vez.\n` +
      `Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.`,
    html: layout(
      "Redefinição de senha",
      `<p>${primeiroNome}, recebemos um pedido para redefinir sua senha.</p>
       <p>O link vale por <strong>${expiraEmMinutos} minutos</strong> e só pode ser usado uma vez.</p>
       <p>Se não foi você que pediu, ignore este e-mail — sua senha continua a mesma.</p>`,
      { url, label: "Criar nova senha" }
    ),
  });
}

async function sendEmailVerification({ to, name, url, expiraEmHoras }) {
  const primeiroNome = (name || "").split(" ")[0] || "Olá";
  return send({
    to,
    template: "email_verification",
    subject: "Confirme seu e-mail — AquaTrip",
    text:
      `${primeiroNome}, bem-vindo ao AquaTrip!\n\n` +
      `Confirme seu endereço de e-mail abrindo este link:\n${url}\n\n` +
      `O link vale por ${expiraEmHoras} horas.`,
    html: layout(
      "Confirme seu e-mail",
      `<p>${primeiroNome}, bem-vindo ao AquaTrip!</p>
       <p>Confirme seu endereço para garantir o acesso à sua conta.
          O link vale por <strong>${expiraEmHoras} horas</strong>.</p>`,
      { url, label: "Confirmar e-mail" }
    ),
  });
}

async function sendPasswordChanged({ to, name }) {
  const primeiroNome = (name || "").split(" ")[0] || "Olá";
  return send({
    to,
    template: "password_changed",
    subject: "Sua senha foi alterada — AquaTrip",
    text:
      `${primeiroNome}, sua senha do AquaTrip acabou de ser alterada.\n\n` +
      `Se não foi você, entre em contato conosco imediatamente.`,
    html: layout(
      "Sua senha foi alterada",
      `<p>${primeiroNome}, sua senha acabou de ser alterada.</p>
       <p><strong>Se não foi você</strong>, entre em contato conosco imediatamente.</p>`,
      null
    ),
  });
}

module.exports = {
  send,
  transportName,
  sendPasswordReset,
  sendEmailVerification,
  sendPasswordChanged,
  MAIL_DIR,
};
