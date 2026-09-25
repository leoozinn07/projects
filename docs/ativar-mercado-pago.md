# Ativar o Mercado Pago (sandbox) + ngrok

Este guia é para rodar **na sua máquina**. São três etapas: pegar as
credenciais, subir o túnel e conferir se está tudo certo.

Ao final, rode `npm run pagamentos:verificar` — ele confere cada item
automaticamente e diz exatamente o que está faltando.

---

## Por que o ngrok é necessário

O Mercado Pago confirma o pagamento chamando o **seu** servidor (webhook).
Ele não consegue chamar `localhost` — precisa de um endereço público na
internet. O ngrok cria um túnel: um endereço `https://algo.ngrok-free.app`
que aponta para a sua máquina.

```
Mercado Pago  →  https://xxx.ngrok-free.app/webhooks/payments  →  seu localhost:3000
```

Sem isso, o pagamento até é criado, mas a reserva **nunca sai de PENDING**,
porque a confirmação não chega.

---

## Etapa 1 — Credenciais do Mercado Pago

1. Acesse https://www.mercadopago.com.br/developers/panel/app
   (faça login com sua conta Mercado Pago; serve conta pessoal comum)

2. Clique em **Criar aplicação**:
   - Nome: `AquaTrip`
   - Produto: **Pagamentos online**
   - Plataforma: **Não, estou usando uma solução própria**

3. Já dentro da aplicação, vá em **Credenciais de teste** (menu lateral).
   Copie o **Access Token** e a **Public Key**. As duas começam com `TEST-`.
   A Public Key não é segredo: ela vai para o navegador montar o formulário
   de cartão.

   > Use **Credenciais de teste**, não as de produção. As de produção
   > cobram de verdade.

4. Ainda no painel, vá em **Webhooks** > **Configurar notificações**:
   - Modo: **Modo de teste**
   - URL: deixe em branco por enquanto (você volta aqui na Etapa 3)
   - Eventos: marque **Pagamentos**
   - Copie a **Assinatura secreta** que aparece ao salvar

5. No arquivo `.env` do projeto:

   ```bash
   PAYMENT_PROVIDER=mercadopago
   PAYMENT_ENV=sandbox
   MP_ACCESS_TOKEN=TEST-cole-seu-token-aqui
   MP_PUBLIC_KEY=TEST-cole-sua-public-key-aqui
   MP_WEBHOOK_SECRET=cole-a-assinatura-secreta-aqui
   ```

---

## Etapa 2 — Instalar e rodar o ngrok

### Instalação

**Windows** (PowerShell):
```powershell
winget install ngrok.ngrok
```

**macOS**:
```bash
brew install ngrok
```

**Linux**:
```bash
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
  | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null \
  && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" \
  | sudo tee /etc/apt/sources.list.d/ngrok.list \
  && sudo apt update && sudo apt install ngrok
```

Se preferir sem instalar nada: baixe o binário em https://ngrok.com/download

### Autenticar

1. Crie conta grátis em https://dashboard.ngrok.com/signup
2. Copie seu authtoken em https://dashboard.ngrok.com/get-started/your-authtoken
3. Rode:
   ```bash
   ngrok config add-authtoken SEU_TOKEN_AQUI
   ```

### Subir o túnel

Com a aplicação já rodando (`npm start`), abra **outro terminal**:

```bash
ngrok http 3000
```

Vai aparecer algo assim:

```
Forwarding   https://a1b2-200-100-50-25.ngrok-free.app -> http://localhost:3000
```

Copie essa URL `https://...ngrok-free.app`.

> No plano gratuito a URL **muda a cada reinício** do ngrok. Sempre que
> reiniciar, atualize o `.env` e o painel do Mercado Pago.

---

## Etapa 3 — Ligar as pontas

1. No `.env`, coloque a URL do ngrok:
   ```bash
   PUBLIC_BASE_URL=https://a1b2-200-100-50-25.ngrok-free.app
   ```

2. Volte ao painel do Mercado Pago > **Webhooks** e cadastre:
   ```
   https://a1b2-200-100-50-25.ngrok-free.app/webhooks/payments
   ```

3. **Reinicie a aplicação** (o `.env` só é lido no boot):
   ```bash
   npm start
   ```

4. Confira tudo:
   ```bash
   npm run pagamentos:verificar
   ```

   Ele testa de verdade: valida o formato do token, chama a API do
   Mercado Pago para ver se o token é aceito, e faz uma requisição na
   sua própria URL pública para confirmar que o túnel está de pé.

---

## Etapa 4 — Testar um pagamento

1. Acesse `http://localhost:3000/reservar`
2. Escolha uma experiência, um horário e crie a reserva
3. No checkout, escolha **PIX**

O QR Code que aparecer é do **sandbox**: não desconta dinheiro real.

### Como o cartão funciona

O checkout usa o formulário oficial do Mercado Pago (**Card Payment Brick**):

1. O navegador carrega `https://sdk.mercadopago.com/js/v2`. A CSP libera os
   domínios do Mercado Pago **só na página de pagamento** e só com o provider
   real ligado (`app/middlewares/cspMercadoPago.js`).
2. Número, validade e CVV são digitados em iframes do Mercado Pago. O
   AquaTrip recebe apenas: `token`, bandeira (`payment_method_id`), emissor
   (`issuer_id`), parcelas e o CPF do titular.
3. O servidor cria o pagamento em `/v1/payments` com o valor lido do banco
   (nunca do navegador). Uma trava (`assertNoRawCardData`) derruba qualquer
   tentativa de enviar número de cartão pelo backend.
4. Se o cartão for recusado, a página mostra o motivo (CVV, limite, banco
   pedindo autorização...) e a vaga continua segura até o fim do prazo da
   reserva, para a pessoa tentar outro cartão ou o PIX.
5. Venda de parceiro: o formulário usa a Public Key **do parceiro**
   (`partners.mp_public_key`), porque o cartão precisa ser tokenizado pela
   conta que vai cobrar.

O PIX e a análise de cartão (`in_process`) ficam em "aguardando"; a página
consulta `/reservas/:id/status` sozinha e atualiza quando o status muda.

### Cartões de teste

Para testar cartão, use os cartões oficiais de teste:
https://www.mercadopago.com.br/developers/pt/docs/checkout-api/additional-content/your-integrations/test/cards

Exemplo (aprovado): `5031 4332 1540 6351`, CVV `123`, validade `11/30`,
titular `APRO`.

O nome do titular controla o resultado:
| Titular | Resultado |
|---|---|
| `APRO` | Aprovado |
| `OTHE` | Recusado por erro geral |
| `FUND` | Recusado por saldo insuficiente |
| `SECU` | Recusado por código de segurança |

### Acompanhar o webhook chegando

Abra `http://127.0.0.1:4040` no navegador — é o inspetor do ngrok. Você
vê cada chamada que o Mercado Pago faz, com corpo e resposta. É a melhor
ferramenta para depurar webhook que não chega.

---

## Voltar para o modo simulado

Basta esvaziar o token no `.env`:

```bash
PAYMENT_PROVIDER=mock
MP_ACCESS_TOKEN=
```

O modo simulado não precisa de ngrok nem de internet.

---

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Reserva fica em PENDING para sempre | Webhook não está chegando — confira o ngrok e a URL cadastrada no painel |
| Todo webhook dá 401 | `MP_WEBHOOK_SECRET` errado ou vazio |
| API recusa o token (401) | Token copiado incompleto, ou é de produção com `PAYMENT_ENV=sandbox` |
| App não sobe | Provavelmente a trava de ambiente: token `TEST-` com `PAYMENT_ENV=production` |
| Cartão aparece desativado | Falta `MP_PUBLIC_KEY` (ou o parceiro conectou sem Public Key) |
| "Não foi possível carregar o formulário do Mercado Pago" | Bloqueador de anúncios ou rede bloqueando `sdk.mercadopago.com` |
| Brick carrega mas o pagamento dá 400 | Public Key e Access Token de contas/ambientes diferentes |
| PIX não aparece como opção | Conta Mercado Pago não é brasileira (`site_id` diferente de `MLB`) |
| URL do ngrok parou de funcionar | Plano grátis troca a URL a cada reinício — atualize `.env` + painel |

---

## Importante: o que ainda não foi validado

O adaptador do Mercado Pago (`app/lib/payments/mercadoPagoProvider.js`)
foi escrito seguindo a documentação oficial, mas **nunca foi executado
contra a API real** — o ambiente onde ele foi desenvolvido não tem acesso
à internet nem credenciais.

Então é bem possível que apareça algum ajuste fino no primeiro teste real
(nome de campo, formato de resposta). Os pontos mais prováveis de precisar
de ajuste:

- o caminho do QR Code no PIX
  (`point_of_interaction.transaction_data.qr_code`);
- o formato exato do manifest de assinatura do webhook;
- o mapeamento de algum status menos comum.

Quando testar, se algo falhar, os logs da aplicação e o inspetor do ngrok
(`127.0.0.1:4040`) mostram exatamente o que veio do Mercado Pago — é só
trazer isso que o ajuste é rápido.

---

## Marketplace: divisão de pagamento com os parceiros

Venda de experiência de parceiro é criada **em nome do parceiro** (token OAuth
dele) e a comissão do AquaTrip vai como `application_fee`. O dinheiro do
parceiro não passa pela conta do AquaTrip.

### O que foi verificado e o que NÃO foi

Tudo abaixo foi **executado contra o simulador** — a rede deste ambiente
bloqueia o Mercado Pago. A implementação segue a documentação oficial, mas
**nada disso rodou contra a API real ainda**:

| Ponto | Situação |
|---|---|
| Fluxo OAuth (conectar → consentir → retorno) | Simulador + servidor real de desenvolvimento |
| `state` de uso único, 10 min, amarrado à sessão | Testado, incluindo o ataque de troca de conta |
| Tokens cifrados e amarrados ao parceiro | Testado (troca de linha no banco não decifra) |
| Renovação do token (7 dias antes de vencer) | Testado no simulador |
| Pagamento com token do parceiro + `application_fee` | Testado no simulador |
| Webhook e estorno com o token do parceiro | Testado no simulador, que imita o 404 do MP com token errado |
| Formato real das respostas do `/oauth/token` | **Não verificado** — só pela documentação |
| Comissão devolvida no estorno total | **Não verificado** — confirmar no sandbox |
| `application_fee` em pagamento PIX | **Não verificado** — confirmar no sandbox |

### Cartão real (Card Payment Brick)

A página de pagamento agora usa o Card Payment Brick. Em venda de parceiro, o
cartão é tokenizado com a **chave pública do parceiro**
(`partners.mp_public_key`). Os testes (`tests/mercadopago-checkout.test.js`)
conferem o corpo exato enviado ao Mercado Pago com uma API falsa; **o Brick
em si ainda não rodou contra o sandbox**, porque a rede deste ambiente bloqueia
o Mercado Pago. Faça o primeiro teste com os cartões de teste acima.

### Passo a passo para o primeiro teste real (sandbox, no Render)

1. No painel de desenvolvedores do Mercado Pago, crie (ou use) a aplicação do
   AquaTrip e habilite o uso de **OAuth / marketplace**, conforme a
   documentação oficial de marketplace do Mercado Pago.
2. Cadastre como **URL de redirecionamento**:
   `https://SEU-APP.onrender.com/parceiro/mercadopago/retorno`
   (tem que ser idêntica ao `PUBLIC_BASE_URL` + esse caminho).
3. Configure no Render: `MP_CLIENT_ID`, `MP_CLIENT_SECRET`,
   `MP_PLATFORM_USER_ID`, `PAYMENT_PROVIDER=mercadopago`, `PAYMENT_ENV=sandbox`,
   `PUBLIC_BASE_URL` com `https://`.
4. Crie **contas de teste** no painel do Mercado Pago: uma de vendedor (será o
   parceiro) e uma de comprador.
5. Cadastre um parceiro no AquaTrip, aprove-o no painel, e na área do parceiro
   clique em **Conectar Mercado Pago** entrando com a conta de teste de vendedor.
   Neste ambiente de teste, o sistema recusa conta real (e vice-versa em produção).
6. Publique uma experiência dele, reserve com o comprador de teste pagando com
   PIX, e confirme no painel do Mercado Pago: valor na conta do vendedor e a
   comissão na conta do AquaTrip.
7. Faça um estorno e confira o que acontece com a comissão.

Se qualquer passo divergir do esperado, os logs trazem só o código de erro do
Mercado Pago (nunca tokens) — mande o trecho para ajustarmos.
