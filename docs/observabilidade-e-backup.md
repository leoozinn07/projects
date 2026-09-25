# Observabilidade e backup — AquaTrip

## Por que isto importa

Antes desta fase, se um webhook de pagamento falhasse às 3h da manhã, o
erro ia para `console.error` e desaparecia. Não havia como saber que
aconteceu, nem o que aconteceu, nem com qual cliente. E não havia backup
nenhum do banco.

---

## Logs estruturados (pino)

Todo `console.*` do backend foi substituído (42 → 0). Cada linha é JSON:

```json
{"level":50,"time":"2026-09-21T20:00:36Z","app":"aquatrip","env":"production",
 "modulo":"webhook","req":{"id":"715b0f3b-..."},"msg":"erro ao processar evento"}
```

Em desenvolvimento sai colorido e legível. Em produção sai JSON puro — o
formato que Datadog, Grafana Loki, CloudWatch e afins consomem direto.

**Nível por resultado:** 5xx vira `error`, 4xx vira `warn`. Um alerta em
`level >= error` dispara só no que importa.

### Redação automática

Senha, cookie, `authorization`, assinatura de webhook, token de cartão, CVV
e CSRF viram `[REDACTED]` **antes** de chegar ao log — mesmo que alguém
passe o objeto inteiro por descuido. Verificado com login real: a senha
digitada não aparece em lugar nenhum. Há 4 testes cobrindo.

---

## Correlação: X-Request-Id

Cada requisição ganha um id, devolvido no header `X-Request-Id` e presente
em toda linha de log daquela requisição.

**Para achar tudo o que aconteceu numa requisição:**
```bash
grep "715b0f3b" app.log
```

**Na página de erro**, o usuário vê os 8 primeiros caracteres como
"Código para o suporte". Quando ele relata o problema, você busca o código
e acha exatamente o que falhou — sem adivinhar pelo horário.

Se quem chama já envia `X-Request-Id` (load balancer, outro serviço), o id é
reaproveitado e o rastro atravessa sistemas. Mas só se o formato for seguro:
um id como `"><script>` é descartado, senão viraria injeção no log.

---

## Health checks

| Rota | Pergunta | Se falhar |
|---|---|---|
| `/healthz` | O processo está vivo? | Orquestrador **reinicia** o container |
| `/readyz` | Posso receber tráfego? | Load balancer **para de mandar** requisições |

A diferença é deliberada. O `/healthz` **não toca no banco**: se tocasse,
uma queda do MySQL faria todos os containers reiniciarem em loop, sem
resolver nada — o problema está no banco, não na aplicação.

O `/readyz` checa o banco com timeout de 2s e reporta `degradado` quando há
fila no pool de conexões — sinal de saturação **antes** da queda.

Nenhum dos dois expõe versão, string de conexão ou mensagem de erro interna:
endpoint público de health é alvo comum de reconhecimento.

Exemplo para Docker:
```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://localhost:3000/healthz"]
  interval: 15s
```

---

## Falhas que escapam

`uncaughtException` e `unhandledRejection` agora são registradas como
`fatal` antes de o processo encerrar. Continuar rodando depois de uma
exceção não tratada deixa o processo em estado desconhecido — o certo é
cair e deixar o orquestrador subir outro.

---

## Backup

```bash
npm run db:backup                                 # gera backups/aquatrip_<data>.sql.gz
npm run db:restore -- backups/<arquivo>.sql.gz    # restaura
npm run db:verificar-restore -- <url-origem> <url-restaurado>
```

### O que o backup faz

1. `mysqldump --single-transaction` (snapshot consistente das tabelas
   InnoDB sem travar escrita), comprimido com `gzip`. O MySQL não tem um
   formato binário próprio com tabela de conteúdo como o `pg_restore
   --list` do Postgres — aqui o dump é SQL puro compactado
2. Grava em `.partial` e só renomeia no final — backup interrompido nunca é
   confundido com backup válido
3. Checksum SHA-256 para detectar corrupção silenciosa
4. Valida o arquivo descompactando e conferindo que as tabelas críticas
   (`users`, `bookings`, `payments`, `consent_records`, `audit_log`) têm um
   `CREATE TABLE` no dump
5. Rotação: mantém os últimos 14
6. Permissão `600` no arquivo e `700` na pasta — o dump tem dado pessoal

### O que o restore faz

- Confere o checksum antes: arquivo corrompido é recusado
- **Recusa restaurar por cima de banco com dados**, a menos que você passe
  `FORCE=1`. Restauração é a operação mais destrutiva que existe
- Cria o banco de destino se ele ainda não existir
- O próprio dump já tem `DROP TABLE IF EXISTS` antes de cada tabela —
  restaurar por cima já limpa e recria, sem precisar de flag extra

**Diferença real, e importante, do Postgres:** o `pg_restore
--single-transaction` original garantia tudo-ou-nada — se algo desse
errado no meio, nada ficava alterado. O MySQL não oferece o mesmo para
um restore de SQL puro: comandos DDL (`CREATE TABLE`, `DROP TABLE`...)
fazem commit implícito no InnoDB (o mesmo motivo documentado em
`database/migrate.js`). Uma falha no meio do restore pode deixar o banco
de destino com algumas tabelas já recriadas e outras não. Por isso o
fluxo recomendado — restaurar num banco **separado**, nunca por cima do
de produção — importa ainda mais aqui do que importava com Postgres.

### Validado de ponta a ponta

Backup → restauração em banco separado → comparação tabela por tabela, por
**contagem e hash do conteúdo**. Resultado: 8 tabelas, conteúdo idêntico.
Também testado: trava contra sobrescrever e arquivo corrompido recusado.

### Falhas encontradas no próprio teste (rodando de verdade, não só lendo o código)

1. **`mysqldump` recusava rodar sob o usuário da aplicação.** Por padrão
   ele tenta exportar metadados de tablespace, que exigem o privilégio
   `PROCESS` — que o usuário da aplicação não tem (nem deveria ter, em
   hospedagem gerenciada). Corrigido com `--no-tablespaces`, que dispensa
   esse privilégio.

2. **O restore para um banco separado escrevia no banco ERRADO.** A
   primeira versão gerava o dump com `mysqldump --databases`, que grava
   `CREATE DATABASE`/`USE aquatrip` **dentro do próprio arquivo**, com o
   nome do banco de ORIGEM. Restaurar com `RESTORE_DATABASE_URL` apontando
   pra um banco de nome diferente parecia funcionar (saía sem erro), mas
   na prática o `USE aquatrip` embutido no dump redirecionava a escrita de
   volta pro banco de origem — o banco "separado" recomendado para testar
   ficava vazio, e um restore desatento poderia sobrescrever produção sem
   avisar. Corrigido tirando `--databases` do backup: o dump agora só tem
   `DROP`/`CREATE TABLE` e dados, sem nome de banco embutido, e quem
   escolhe o destino é sempre `scripts/restore.sh`, na hora de restaurar
   — igual ao `--dbname` do `pg_restore` original.

3. **Minha primeira verificação dava falso positivo.** Ela comparava hash
   de origem e destino — mas quando as duas consultas falhavam, ambas
   devolviam vazio, e vazio igual a vazio aparecia como "idêntico". A versão
   atual trata qualquer erro de consulta como FALHA. Foi validada contra um
   banco vazio antes de ser usada: acusou as 8 tabelas com exit code 1.

### A regra que não pode ser esquecida

**Backup no mesmo servidor do banco não é backup — é cópia.** Se a máquina
morrer, vão os dois juntos. Copie os arquivos para outro lugar (outro
servidor, storage de objetos como S3/R2/GCS).

E **teste o restore periodicamente**. Backup que nunca foi restaurado é uma
suposição, não uma garantia.

### Agendamento (exemplo com cron, diário às 3h)
```cron
0 3 * * * cd /srv/aquatrip && npm run db:backup >> /var/log/aquatrip-backup.log 2>&1
```

---

## O que ainda falta

- **Envio dos logs para um agregador** (Datadog, Grafana, Better Stack): hoje
  saem em stdout no formato certo, mas alguém precisa coletar.
- **Alertas**: configurar no agregador, ex. `level >= 50 AND modulo = webhook`.
- **Cópia do backup para fora do servidor**: o script gera; o envio para
  storage externo depende de onde você vai hospedar.
- **Métricas** (latência por rota, taxa de erro): próximo passo natural, com
  Prometheus/OpenTelemetry.
