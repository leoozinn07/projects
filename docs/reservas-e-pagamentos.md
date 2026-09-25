# Reservas e Pagamentos — AquaTrip

## Visão geral do fluxo

```
escolher experiência  →  escolher data/horário  →  reserva PENDING (segura a vaga)
        →  checkout (PIX / crédito / débito)  →  cobrança criada no gateway
        →  webhook do gateway  →  reserva CONFIRMED  →  comprovante
                              ↘  recusado/expirado  →  vaga liberada
```

**Regra central:** a reserva só vira `CONFIRMED` depois que o gateway confirma
o pagamento — preferencialmente por webhook. Nada no front-end pode confirmar
uma reserva.

## Estados

**Reserva** (`bookings.status`): `PENDING` · `CONFIRMED` · `CANCELLED` · `EXPIRED` · `REFUNDED`

**Pagamento** (`payments.status`): `PENDING` · `APPROVED` · `REJECTED` · `CANCELLED` · `REFUNDED` · `EXPIRED`

Enquanto a reserva está `PENDING`, ela segura a vaga até `expires_at`
(padrão: 15 min, via `BOOKING_HOLD_MINUTES`). Depois disso um job libera
automaticamente. A consulta de disponibilidade também ignora pendências
vencidas, então a vaga já aparece livre mesmo antes do job rodar.

## Modo simulado (padrão em desenvolvimento)

Sem `MP_ACCESS_TOKEN` configurado, o sistema usa o **provider simulado**.
Ele reproduz o fluxo inteiro, inclusive webhook assinado, **sem cobrar nada**.

Como forçar cada resultado:

| Situação | Como testar |
|---|---|
| Cartão aprovado | Últimos 4 dígitos: qualquer valor (ex.: `4242`) |
| Cartão recusado | Últimos 4 dígitos: `0000` |
| Cartão em análise | Últimos 4 dígitos: `0001` |
| PIX aprovado/recusado/expirado | Botões do painel de simulação no checkout |

O provider simulado é **bloqueado** se `NODE_ENV=production` — não há como
subir para produção "aprovando" pagamento fake por engano.

## Ativar Mercado Pago (sandbox)

1. Crie uma aplicação em https://www.mercadopago.com.br/developers/panel/app
2. Copie o **Access Token de TESTE** (começa com `TEST-`).
3. No `.env`:
   ```
   PAYMENT_PROVIDER=mercadopago
   PAYMENT_ENV=sandbox
   MP_ACCESS_TOKEN=TEST-xxxxxxxx
   MP_WEBHOOK_SECRET=<segredo configurado no painel>
   PUBLIC_BASE_URL=https://seu-tunel.ngrok.app
   ```
4. O webhook precisa de **URL pública**. Em desenvolvimento use um túnel
   (ngrok, cloudflared) e cadastre `https://.../webhooks/payments` no painel
   do Mercado Pago.
5. Use os [cartões de teste oficiais](https://www.mercadopago.com.br/developers/pt/docs/checkout-api/additional-content/your-integrations/test/cards).

**Travas de ambiente:** subir com `PAYMENT_ENV=production` usando token `TEST-`
derruba a aplicação no boot (e vice-versa gera aviso). É proposital: token
trocado entre ambientes é uma das falhas mais caras em integração de pagamento.

## Segurança de cartão (PCI)

O backend **nunca** recebe número de cartão, CVV ou validade. O fluxo correto:

```
navegador --(SDK do gateway)--> gateway --(token)--> navegador --> backend
```

O backend só lida com o **token** e, para exibição, os 4 últimos dígitos que o
próprio gateway devolve. Há um guard (`assertNoRawCardData`) que derruba a
requisição se alguém tentar passar `card_number`/`cvv` pelo servidor.

> No modo simulado, o campo "últimos 4 dígitos" existe apenas para escolher o
> resultado da simulação — não é um campo de cartão real.

## Proteções implementadas

| Risco | Proteção |
|---|---|
| Cobrança duplicada | 3 camadas: reuso de pagamento ativo; chave de idempotência determinística por (reserva+método+valor); índice único parcial no banco (`uniq_payment_active_per_booking`) |
| Webhook forjado | Validação de assinatura HMAC; sem assinatura válida → `401` |
| Webhook reenviado | Unicidade `(provider, provider_event_id)` — reentrega responde `200 {duplicate:true}` sem reprocessar |
| Overbooking | `SELECT ... FOR UPDATE` no slot dentro de transação |
| Preço adulterado pelo cliente | Valor sempre calculado no servidor a partir do preço no banco |
| IDOR/BOLA | Toda leitura de reserva verifica dono (ou admin) antes de responder |
| Reserva travando vaga para sempre | `expires_at` + job de expiração + disponibilidade que ignora pendências vencidas |
| Webhook fora de ordem | Transições de status condicionais no SQL (`WHERE status = ...`) |

## Rotas

| Rota | Método | Proteção |
|---|---|---|
| `/reservar` | GET | login |
| `/reservar/:slug` | GET | login |
| `/reservar` | POST | login + CSRF |
| `/reservas/:id/checkout` | GET | login + dono |
| `/reservas/:id/pagar` | POST | login + CSRF + dono |
| `/reservas/:id/comprovante` | GET | login + dono |
| `/reservas/:id/cancelar` | POST | login + CSRF + dono |
| `/minhas-reservas` | GET | login |
| `/webhooks/payments` | POST | assinatura (sem CSRF/login — quem chama é o gateway) |
| `/dev/simular-pagamento` | POST | só existe fora de produção |

## Trocar de gateway

Escreva um arquivo em `app/lib/payments/` implementando o contrato descrito em
`contract.js` (`createPayment`, `getPayment`, `refundPayment`, `parseWebhook`,
`name`), registre-o em `index.js` e mude `PAYMENT_PROVIDER`. Nenhum controller,
service ou view precisa ser tocado.

## Comandos

```bash
npm run db:migrate         # cria/atualiza o schema
npm run db:seed            # cria o admin inicial
npm run db:seed:services   # cria experiências e horários de exemplo
npm start
```
