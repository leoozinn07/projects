# AquaTrip

Marketplace de experiências aquáticas — praias, mergulho, caiaque, pesca,
aquários e expedições. Clientes reservam e pagam; parceiros publicam
experiências e recebem com a comissão do AquaTrip descontada na hora.

> **Este site é um simulador.** Pagamentos (PIX e cartão), a conexão dos
> parceiros com o Mercado Pago e o envio de e-mails funcionam de ponta a
> ponta, mas **simulados**: nenhum dinheiro real é movimentado e nenhum
> e-mail sai do servidor.

Node.js 22 · Express · EJS · MySQL 8.0 · 481 testes automatizados

Design: veja [docs/design.md](docs/design.md) (tokens, tipografia, movimento e fotos provisórias).

---

## Como rodar

**Requisitos:** [Node.js 22](https://nodejs.org) e [MySQL 8.0](https://dev.mysql.com/downloads/mysql/)
(o **MySQL Workbench CE** é a interface gráfica oficial para administrar o
banco, mas não é obrigatório — os comandos abaixo cuidam de tudo sozinhos).
Funciona em Windows, macOS e Linux — os comandos abaixo são os mesmos nos três.

**1. Configure** (cria o `.env` e gera os segredos sozinho):

```bash
npm install
npm run setup
```

O `setup` mostra a senha do admin (anote) e o SQL para criar o banco.

**2. Crie o banco** — só na primeira vez:

```bash
npm run db:create
```

Ele pergunta o usuário e a senha de **administrador do MySQL** (a conta
`root`, com a senha que você definiu ao instalar) e cria sozinho o usuário e
o banco, já com o charset/collation certos (`utf8mb4` / `utf8mb4_0900_ai_ci`).
Se preferir fazer à mão — no MySQL Workbench ou no `mysql` CLI, como `root`:

```sql
CREATE DATABASE aquatrip CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'aquatrip'@'localhost' IDENTIFIED BY 'aquatrip_dev_pw';
CREATE USER 'aquatrip'@'127.0.0.1' IDENTIFIED BY 'aquatrip_dev_pw';
GRANT ALL PRIVILEGES ON aquatrip.* TO 'aquatrip'@'localhost';
GRANT ALL PRIVILEGES ON aquatrip.* TO 'aquatrip'@'127.0.0.1';
FLUSH PRIVILEGES;
```

> **Fuso horário:** horários de experiências são digitados e exibidos no fuso
> de operação (`OPERATION_TIMEZONE`, padrão `America/Sao_Paulo`) e gravados em
> UTC. A conversão é feita pelo próprio Node, e cada conexão com o banco
> trabalha em UTC: **não é preciso** carregar as tabelas de fuso horário do
> MySQL (a instalação do Windows não as traz).

**3. Crie as tabelas, os dados e suba o site:**

```bash
npm run db:migrate            # cria as tabelas
npm run db:seed               # cria o administrador
npm run db:seed:services      # experiências da equipe AquaTrip
npm run db:seed:demo          # parceiro, experiências e cliente de demonstração
npm run db:seed:comunidade    # (opcional) Comunidade de exemplo, com selo "Exemplo"
npm start                     # http://localhost:3000
```

**Comunidade de exemplo** (`npm run db:seed:comunidade`): cria 8 perfis, 10
viagens em destinos brasileiros reais, participações, curtidas, comentários,
seguidores e avaliações para testar a Comunidade "cheia". Tudo aparece com o
selo **Exemplo** e o aviso de que não é real; fica fora do catálogo, do
sitemap, do assistente e das métricas do admin, com `noindex` para
buscadores. As contas não têm senha utilizável e as fotos são reais, do
próprio destino (`app/public/img` e `database/fotos-exemplo`), sem pessoas
reconhecíveis. O comando recusa rodar
em produção. Para apagar tudo: `npm run db:seed:comunidade:limpar`.

Rode todos os comandos **dentro da pasta do projeto** (onde está o `package.json`).

**Deu erro? Rode `npm run doctor`** — ele verifica tudo em ordem e diz
exatamente o que falta. Resumo das causas mais comuns:

| Mensagem | Causa | O que fazer |
|---|---|---|
| `Arquivo .env não encontrado` | O `setup` não foi rodado, ou o terminal está em outra pasta | `npm run setup` na pasta do projeto |
| `ER_ACCESS_DENIED_ERROR` | O banco/usuário não existe ou a senha não bate | `npm run db:create` |
| `ECONNREFUSED ...3306` | O MySQL não está ligado | Windows: Serviços → `MySQL80` → Iniciar |
| "não conseguiu falar com o banco" no site, ou o aviso de cookies diz "Erro. Tentar de novo" | É sempre a mesma causa: o banco está inacessível | `npm run doctor` |
| `TOTP_ENCRYPTION_KEY` | Chave do 2FA ausente | `npm run setup` (preenche sem apagar o resto) |

## Contas para explorar

| Perfil | E-mail | Senha | Onde ir |
|---|---|---|---|
| Cliente | `cliente@demo.aquatrip` | `Demo12345!` | Minhas reservas, Ingressos |
| Parceiro | `parceiro@demo.aquatrip` | `Demo12345!` | `/parceiro` — experiências, reservas, vendas |
| Admin | `admin@aquatrip.local` | a que o `npm run setup` mostrou | `/admin` |

**Admin e 2FA:** administradores são obrigados a usar verificação em duas
etapas. No primeiro login o sistema pede para configurar um app autenticador
(Google Authenticator, Authy etc.). Para uma demonstração local rápida, é
possível desligar com `REQUIRE_ADMIN_2FA=false` no `.env` — **nunca em
produção**. Perdeu o acesso? `npm run 2fa:redefinir -- email --confirmar`.

## O que dá para simular

**Como cliente:** navegar pelo catálogo, reservar, pagar no **checkout de
teste** (nenhum valor real é cobrado):

- **PIX:** "Gerar QR Code PIX" mostra um QR Code de teste (não pagável em
  banco nenhum) e o botão "Já realizei o pagamento" leva ao comprovante de teste.
- **Cartão:** número completo, validade (MM/AA) e CVV, validados antes de
  avançar. Débito com 16 dígitos; crédito de 13 a 19. O número completo e o
  CVV nunca saem do navegador: o servidor recebe só os 4 últimos dígitos.
  Cartões de teste: `4111 1111 1111 1111` aprova, `4000 0000 0002 0000`
  recusa, `4000 0000 0001 0001` fica em análise, `5555 0000 0000 41234`
  (crédito, 17 dígitos) aprova. Validade: qualquer data futura; CVV: 3 dígitos.

Também dá para ver o ingresso, cancelar com estorno, avaliar com fotos depois da data,
exportar ou pedir exclusão dos dados (LGPD).

**Como parceiro:** candidatar-se (aceita CNPJ alfanumérico, em vigor desde
julho/2026), conectar o Mercado Pago pelo simulador de consentimento, cadastrar
experiências e horários (publicadas na hora, moderadas depois), ver quem reservou (com o código
do ingresso para conferir na chegada) e acompanhar vendas, comissões e líquido.

**Na comunidade (qualquer conta):** criar a própria viagem em `/criar_experiencia`
(gratuita publica na hora; paga exige cadastro de parceiro com Mercado Pago
conectado, porque o dinheiro vai direto para quem organiza), curtir, comentar,
seguir, marcar interesse, denunciar, participar (gratuita confirma na hora) e
acompanhar tudo no perfil social `/meu-perfil`. Reclamações, sugestões e
avaliação do AquaTrip em `/feedback`.

**Assistente virtual:** botão "Ajuda" em todas as páginas. Responde só sobre o
AquaTrip, a partir de `app/lib/chatbot/conhecimento.md`, e consulta apenas o
catálogo público. Precisa de `ANTHROPIC_API_KEY` no `.env` (sem ela, aparece
como indisponível).

**Como admin:** painel com métricas (inclui usuários online, parceiros,
participantes, reclamações e avaliações); moderação da comunidade (suspender,
banir, reativar, denúncias e comentários); banimento de usuários e perfil
completo com CPF/CNPJ (acesso registrado na auditoria); reclamações com
resposta e status; aprovar parceiros e experiências; moderar
fotos e avaliações; atender solicitações LGPD e mensagens de contato; suspender
usuários; faturamento com exportação CSV; trilha de auditoria.

## O que é simulado e o que seria real

| Parte | No simulador | Para virar real |
|---|---|---|
| Pagamentos | Provedor simulado com as mesmas regras do real | `PAYMENT_PROVIDER=mercadopago` + credenciais — ver `docs/ativar-mercado-pago.md` |
| Conexão do parceiro | Tela local imitando o consentimento do Mercado Pago | Aplicação marketplace no Mercado Pago |
| E-mails | Gravados em `tmp/emails` e listados em `/dev/emails` | SMTP (`MAIL_TRANSPORT=smtp`) |
| Imagens | Disco local (`uploads/`) | Storage de objetos com várias instâncias |

## Testes

```bash
npm run db:migrate:test
npm test
```

481 testes em 33 suítes, rodando contra um MySQL 8.0 real. As proteções de
segurança e de dinheiro foram validadas também por **teste de mutação**: a
proteção é removida de propósito e o teste correspondente precisa falhar.

## Documentação

| Assunto | Arquivo |
|---|---|
| Marketplace (fases, regras, divisão do pagamento) | `docs/marketplace.md` |
| Pagamentos e ativação do Mercado Pago | `docs/reservas-e-pagamentos.md`, `docs/ativar-mercado-pago.md` |
| Verificação em duas etapas | `docs/2fa.md` |
| LGPD (consentimento, direitos, anonimização) | `docs/lgpd.md` |
| Moderação de fotos | `docs/moderacao.md` |
| SEO | `docs/seo.md` |
| Observabilidade e backup | `docs/observabilidade-e-backup.md` |
| Auditoria | `docs/auditoria.md` |

## Pendências conhecidas

- Os textos de Termos de Uso e Política de Privacidade descrevem o
  funcionamento real do sistema, mas **não substituem revisão jurídica**
  (faltam razão social, CNPJ, endereço e foro).
- Testes de ponta a ponta em navegador não foram feitos (não havia navegador
  no ambiente de desenvolvimento); o JavaScript de cada tela foi executado em
  DOM simulado com dados reais da API.
