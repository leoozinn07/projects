# Recuperação de conta — AquaTrip

## O problema que isto resolve

Antes desta fase, **quem esquecesse a senha perdia a conta para sempre** —
não havia fluxo de recuperação. E qualquer pessoa podia se cadastrar com o
e-mail de outra, já que nada era verificado.

## Fluxos

### Esqueci minha senha
1. `/esqueci-senha` → informa o e-mail
2. Recebe link com token de uso único (validade: 30 min)
3. `/redefinir-senha/:token` → cria a nova senha
4. Sessões antigas são derrubadas e um e-mail de aviso é enviado

### Confirmação de e-mail
1. Cadastro dispara o envio automaticamente
2. `/verificar-email/:token` confirma (validade: 48 h)
3. Reenvio disponível para quem está logado

## Decisões de segurança

**Anti-enumeração.** "Esqueci a senha" é o ponto clássico de vazamento: se a
resposta muda conforme o e-mail existe ou não, vira uma API para descobrir
quem tem conta. A resposta é **sempre idêntica** — mesmo status, mesmo
destino, mesma mensagem. Inclusive quando o envio falha internamente.

**Token nunca em claro no banco.** Guardamos só o SHA-256. Se o banco vazar,
os links já enviados continuam inúteis — mesma lógica de nunca guardar senha
em claro. Token de 32 bytes aleatórios: inviável de adivinhar.

**Uso único, consumido atomicamente.** O `UPDATE ... WHERE used_at IS NULL
RETURNING` valida e marca como usado na mesma operação, então dois cliques
simultâneos no link não trocam a senha duas vezes.

**Pedido novo invalida o anterior.** Se alguém pediu duas vezes, só o link
mais recente funciona — um link antigo, possivelmente já exposto, não abre
mais a conta.

**Troca de senha derruba sessões.** Se a conta estava tomada, o invasor perde
o acesso no instante em que o dono redefine.

**Troca libera conta bloqueada.** Quem provou ser dono do e-mail não deve
continuar preso fora por causa das 5 tentativas erradas.

**Limite de pedidos.** Máximo de 5 por conta por hora — impede usar o sistema
como máquina de spam contra um endereço real.

## E-mail sem provedor configurado

Sem SMTP, o transporte `dev` grava as mensagens em `./tmp/emails/` e a rota
`/dev/emails` (só fora de produção) lista as últimas. Dá para percorrer o
fluxo inteiro, pegar o link de redefinição e testar — sem enviar nada para
endereço real durante o desenvolvimento.

Para enviar de verdade:
```bash
npm install nodemailer
# no .env:
MAIL_TRANSPORT=smtp
SMTP_HOST=...  SMTP_PORT=587  SMTP_USER=...  SMTP_PASS=...
```

## Ainda não implementado

- **2FA** — não foi pedido ainda.
- **Bloqueio de ações para e-mail não verificado.** Hoje a verificação é
  registrada mas não restringe nada. Quando quiser exigir e-mail confirmado
  para reservar ou pagar, o dado já está lá (`users.email_verified_at`).
