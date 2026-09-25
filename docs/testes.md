# Testes automatizados — AquaTrip

## Rodar

```bash
npm run db:migrate:test   # uma vez, prepara o banco de teste
npm test                  # roda tudo
npm run test:watch        # re-roda ao salvar
npx jest --coverage       # com relatório de cobertura
```

## O que está coberto (422 testes, 28 suítes)

**`tests/auth.test.js`** — cadastro (hash argon2, nunca ADMIN por
auto-cadastro, anti-enumeração), login (mensagem idêntica para senha
errada e usuário inexistente, bloqueio após 5 tentativas, regeneração
de sessão contra session fixation, cookie httpOnly+SameSite), RBAC
(anônimo redirecionado, usuário comum recebe 403 em /admin, ADMIN
passa), logout.

**`tests/booking.test.js`** — criação de reserva (valor calculado no
servidor, preço enviado pelo cliente é ignorado, CSRF obrigatório,
limite de quantidade), capacidade (não excede, segura vaga enquanto
pendente, devolve ao expirar, ignora pendência vencida mesmo antes do
job, recusa horário passado), IDOR/BOLA (checkout e comprovante alheios
dão 404 e não 403, cancelamento e pagamento de reserva alheia sem
efeito, listagem isolada por usuário).

**`tests/payments.test.js`** — PIX pendente com copia-e-cola, cartão
aprovado confirma na hora, cartão recusado libera a vaga, dados
sensíveis de cartão nunca persistidos, método inválido recusado;
duplo clique não gera dois pagamentos, reserva confirmada não aceita
nova cobrança, a aplicação barra segunda cobrança ativa para a mesma
reserva (`startPayment` reutiliza a cobrança existente em vez de
duplicar — ver nota sobre o índice único abaixo);
webhook forjado e sem assinatura rejeitados sem alterar estado,
webhook válido confirma, evento reenviado não reprocessa, recusa
libera vaga, webhook atrasado não rebaixa pagamento aprovado;
cancelamento e estorno; comprovante só após confirmação.

## Por que MySQL real (e não mock de banco)

Várias proteções do sistema vivem **no banco**, não no JavaScript: o
`SELECT ... FOR UPDATE` contra overbooking, as transições condicionais
de status (`UPDATE ... WHERE status <> 'X'` e confere `rowCount`), as
constraints `CHECK` (categoria válida, preço não-negativo, motivo
obrigatório quando rejeitado). Um mock de banco passaria nos testes e
deixaria o bug em produção.

**Nota sobre a migração de Postgres para MySQL:** a proteção "só um
pagamento ativo por reserva" era um índice único parcial no Postgres.
O MySQL/InnoDB não permite recriar esse índice numa coluna gerada com
FK em cascata (limitação documentada na migração), então essa
proteção específica passou a viver só na aplicação
(`bookingService.startPayment()` consulta antes de criar) — não é
mais à prova de corrida entre dois processos concorrentes como era no
banco, só entre chamadas sequenciais. É um trade-off conhecido, não
um descuido: o teste correspondente (`payments.test.js`) foi reescrito
pra verificar a proteção onde ela realmente está agora.

## Isolamento

`.env.test` aponta para o banco `aquatrip_test`, separado do de
desenvolvimento. Cada teste começa truncando as tabelas transacionais
(uma a uma, com `FOREIGN_KEY_CHECKS` desligado — o MySQL não tem um
`TRUNCATE ... CASCADE` de várias tabelas numa instrução só, como o
Postgres tinha), então a ordem de execução não importa e um teste não
contamina o outro. Os testes rodam com `--runInBand` (em série) porque
compartilham esse banco.

## Verificação da própria suíte

Os testes foram validados por sabotagem deliberada: ao desligar a
validação de assinatura do webhook, 2 testes falharam; ao remover a
checagem de dono da reserva, 3 testes de IDOR falharam. Uma suíte que
continua verde com a proteção removida é pior que nenhuma suíte, porque
dá falsa confiança.

## Cobertura atual

| Camada | Linhas |
|---|---|
| middlewares | 94% |
| services | 91% |
| repositories | 90% |
| controllers | 86% |

Total do projeto: 89% de linhas, 86% de branches. O que falta cobrir é
sobretudo caminho de erro raro em controller e o adaptador do Mercado
Pago (que exige credenciais reais).

## CI

`.github/workflows/ci.yml` roda a cada push e PR: checagem de sintaxe,
migrations contra um MySQL 8.0 real (de propósito SEM as tabelas de fuso
horário, como no Windows: a conversão de fuso é do Node), suíte completa, cobertura
e `npm audit --audit-level=high` (falha o build em vulnerabilidade alta).
