# Migração PostgreSQL → MySQL 8.0 — Design

Status: aguardando aprovação do usuário (Henry) antes de implementar.

## Contexto e escopo

Hoje o banco é Postgres 16 (`pg` + `connect-pg-simple`), acessado por uma camada de
9 repositórios com SQL cru (`app/repositories/*.js`), 10 migrations em
`database/migrations/*.sql`, e uma suíte de 421 testes Jest que roda contra um
Postgres de teste.

Levantamento do que usa sintaxe específica de Postgres:

| Recurso Postgres | Ocorrências | Onde |
|---|---|---|
| Placeholders `$1, $2...` | em todas as queries | 9 repositórios + ~10 serviços |
| `RETURNING` | 42 | repositórios (inserts/updates) |
| `ON CONFLICT` | 3 | upserts |
| `gen_random_uuid()` | 15 | migrations (PK default) |
| `JSONB` | 3 | migrations/queries |
| `TIMESTAMPTZ` | 51 colunas | migrations |
| `CITEXT` (email case-insensitive) | users.email | migration 001 |
| `CREATE TYPE ... ENUM` via `DO $$` | vários | migrations (roles, status) |
| Sessão de login em `connect-pg-simple` | 1 | `app.js` |

Decisões já fechadas com o usuário:
- Driver: **mysql2 puro** (mantém o padrão atual de repositório com SQL cru — sem ORM/query builder novo).
- IDs: **manter UUID, gerado no Node** (`crypto.randomUUID()`), coluna `CHAR(36)`.
- Servidor: **mysql:8.0 via Docker**, trocando o serviço `db` do `docker-compose.yml`.
- Escopo: **só a troca de banco nesta entrega** (copywriting/design ficam para depois).

## Arquitetura

### Pool de conexão (`app/lib/db.js`)
Reescrito para `mysql2/promise`. Mantém a mesma interface pública usada hoje pelos
repositórios (`db.query(sql, params)`), para minimizar o diff em cada arquivo:

- Tradução automática de placeholders `$1,$2...` → `?` dentro do wrapper (os
  repositórios continuam parametrizados; só muda a sintaxe do texto SQL nas
  queries que ainda usarem `$N` — durante a migração, cada query já é reescrita
  para `?` diretamente, então esse tradutor é uma rede de segurança, não uma
  muleta permanente).
- `pool.execute()` (prepared statements com plano cacheado) em vez de
  `pool.query()` nos caminhos quentes — ganho de performance real sobre o `pg`
  atual, que não faz isso.
- `typeCast` customizado para `TINYINT(1)` virar `boolean` no retorno (equivalente
  ao comportamento nativo do `pg` com `BOOLEAN`), evitando reescrever comparações
  `=== true/false` espalhadas pelo código.
- `timezone: 'Z'` fixo no pool — toda leitura/escrita de data trafega em UTC,
  igual ao `TIMESTAMPTZ` hoje.
- Helper `withTransaction(fn)` centralizando
  `getConnection() → beginTransaction() → commit()/rollback() → release()`,
  substituindo o padrão manual de `BEGIN/COMMIT/ROLLBACK` usado hoje em
  `bookingService`/`migrate.js`. Reduz duplicação e risco de esquecer um `release()`.

### Geração de UUID
Cada repositório passa a gerar o id em JS (`crypto.randomUUID()`) antes do
`INSERT`, e o próprio objeto inserido já é retornado — elimina a necessidade de
`RETURNING id` (que o MySQL não suporta) na maioria dos 42 casos.

Para os poucos `UPDATE ... RETURNING <coluna>` onde o valor é calculado no banco
(ex.: default), o padrão vira: calcular o valor em JS antes do `UPDATE` sempre que
possível (a maioria dos casos já é assim — o serviço decide o novo status antes de
gravar); nos raros casos onde não dá, um `SELECT` de acompanhamento após o
`UPDATE`.

### Upserts (`ON CONFLICT`)
As 3 ocorrências viram `INSERT ... ON DUPLICATE KEY UPDATE`, mantendo a mesma
constraint única já existente nas colunas de conflito.

### E-mail case-insensitive (`CITEXT`)
Coluna volta a ser `VARCHAR`, usando a collation padrão do MySQL 8
(`utf8mb4_0900_ai_ci`, que já é case-insensitive) — sem mudança de código na
camada de serviço.

### Enums de status/papel
`CREATE TYPE ... AS ENUM` (com `DO $$` para idempotência) vira `ENUM(...)` inline
na definição da coluna, padrão nativo do MySQL. Adicionar um valor novo no futuro
passa a ser `ALTER TABLE ... MODIFY COLUMN ... ENUM(...)`.

### JSON
`JSONB` → `JSON` nativo do MySQL 8. As 3 ocorrências de operadores (`->`, `->>`,
`@>`) são adaptadas individualmente para `JSON_EXTRACT`/`->>'$.chave'` durante o
port de cada arquivo.

### Sessão de login
`connect-pg-simple` → `express-mysql-session` (mesma ideia: cria a tabela
automaticamente, guarda sessão no próprio banco, sem depender de Redis).

### Migrations
As 10 migrations `.sql` são reescritas para DDL MySQL. Diferença importante: DDL
no MySQL faz commit implícito (não dá para fazer rollback de `CREATE TABLE` dentro
de uma transação como hoje). O runner (`database/migrate.js`) passa a rodar cada
migration como uma sequência de statements idempotentes (`IF NOT EXISTS`, que o
MySQL 8 já suporta nativamente para tabela/índice) em vez de depender de
transação para desfazer em caso de erro — mesma filosofia de idempotência, só sem
a rede de segurança transacional na parte de DDL. O registro em `_migrations`
continua.

## Fluxo de dados / pontos de atenção

- **Datas**: tudo em UTC, `DATETIME` no lugar de `TIMESTAMPTZ` (evita o limite de
  2038 do `TIMESTAMP` do MySQL).
- **`now()`**: função já existe com esse nome no MySQL 8, sem necessidade de troca
  em grande parte dos casos.
- **Placeholders repetidos** (`$1` usado duas vezes na mesma query Postgres): não
  existe hoje de forma generalizada, mas cada arquivo será conferido durante o
  port — se aparecer, o valor precisa ser passado duas vezes no array de params
  do MySQL.
- **Idempotency key de pagamento** (`bookingService.startPayment`): não depende de
  sintaxe específica de Postgres, só de `db.query`; verificação é só rodar os
  testes de pagamento depois do port.

## Tratamento de erros

- `pool.on('error', ...)` mantido, logando via `pino` como hoje.
- `withTransaction` sempre libera a conexão (`finally { connection.release() }`),
  igual ao padrão atual com `client.release()`.
- Mensagens de erro do `db.js` (hoje orientam a criar `.env`/rodar `npm run
  setup`) são mantidas, só trocando o texto de exemplo da `DATABASE_URL` para o
  formato MySQL.

## Testes

- Novo `.env.test` apontando para um MySQL de teste (`aquatrip_test`).
- `database/migrate-test.js` roda as migrations MySQL novas.
- Suíte Jest (421 testes) roda por completo após o port; qualquer teste que
  dependa de detalhe de comportamento do Postgres (ordenação implícita, cast de
  boolean, etc.) é corrigido nesse momento.
- Checklist manual pós-migração: cadastro/login/2FA, fluxo completo de reserva +
  pagamento (mock), páginas em pt/en/es, painel admin.

## Ordem de implementação

1. Dependências (`mysql2`, `express-mysql-session`; remover `pg`,
   `connect-pg-simple`) + `docker-compose.yml` (`mysql:8.0`) + `app/lib/db.js`.
2. Portar as 10 migrations para DDL MySQL.
3. Portar `migrate.js`, `migrate-test.js`, `seed*.js`.
4. Portar os 9 repositórios + trechos de serviço com SQL embutido, em ordem de
   dependência (catálogo → conta/usuário → reservas → pagamentos → admin/suporte/
   auditoria → tokens).
5. Trocar o session store em `app.js`.
6. Atualizar `.env.example`/`.env`, `docs/*.md` e `README.md` (remover instruções
   Postgres, adicionar MySQL/Workbench).
7. Subir o MySQL local, migrar, seedar, rodar a suíte inteira e corrigir o que
   quebrar.
8. Conferência manual (Playwright/screenshots se der tempo).
9. Empacotar a pasta final + lista de `npm install` atualizada.

## Riscos conhecidos

- Volume de arquivos (37) aumenta a chance de um detalhe de dialeto passar
  despercebido em algum ponto — mitigado por rodar a suíte completa ao final de
  cada bloco, não só no fim de tudo.
- DDL sem transação real no MySQL: se uma migration falhar no meio, pode deixar
  schema parcialmente aplicado — mitigado por `IF NOT EXISTS` em tudo (mesma
  postura de idempotência que as migrations já seguem hoje).
- Ambiente sem acesso à internet/rede restrita: instalação de `mysql2` e
  `express-mysql-session` via npm registry deve funcionar (mesmo canal usado para
  os pacotes atuais), mas não há como testar contra um MySQL gerenciado real
  fora do Docker local nesta sessão.
