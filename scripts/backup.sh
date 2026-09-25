#!/usr/bin/env bash
# ==============================================================
# AquaTrip — Backup do banco de dados (MySQL 8.0)
# ==============================================================
# Uso:
#   ./scripts/backup.sh                 # usa DATABASE_URL do .env
#   BACKUP_DIR=/mnt/backups ./scripts/backup.sh
#
# O que faz, e por quê:
#   1. mysqldump com --single-transaction: um snapshot consistente das
#      tabelas InnoDB sem travar escritas (equivalente ao dump normal
#      do pg_dump num banco que só usa InnoDB, como este).
#      Diferente do Postgres, o MySQL não tem um formato binário
#      "custom" com tabela de conteúdo (pg_restore --list): o dump
#      aqui é SQL puro, comprimido com gzip.
#   2. Grava em arquivo .partial e só renomeia no final. Assim um
#      backup interrompido (disco cheio, queda) nunca é confundido
#      com um backup válido.
#   3. Gera checksum SHA-256: detecta corrupção silenciosa antes que
#      você precise do backup e descubra que ele não serve.
#   4. Valida o arquivo: descompacta e confere que cada tabela
#      obrigatória tem um "CREATE TABLE" no dump. Não existe um
#      "restore --list" no MySQL pra validar sem restaurar de
#      verdade, então a validação aqui é textual — mais simples que
#      a do Postgres, mas pega o mesmo problema (dump truncado ou
#      vazio) antes do dia da emergência.
#   5. Rotação: mantém os últimos N (padrão 14). Backup sem rotação
#      enche o disco e acaba derrubando o próprio banco.
#
# IMPORTANTE: backup no mesmo servidor do banco não é backup — é
# cópia. Se a máquina morrer, vão os dois juntos. Copie o arquivo
# gerado para outro lugar (outro servidor, storage de objetos).
# ==============================================================
set -euo pipefail

# ---------- Configuração ----------
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${DATABASE_URL:-}" && -f "$RAIZ/.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source <(grep -E '^DATABASE_URL=' "$RAIZ/.env"); set +a
fi

: "${DATABASE_URL:?DATABASE_URL não definido (configure o .env)}"
BACKUP_DIR="${BACKUP_DIR:-$RAIZ/backups}"
MANTER="${BACKUP_KEEP:-14}"

CARIMBO="$(date -u +%Y%m%dT%H%M%SZ)"
ARQUIVO="$BACKUP_DIR/aquatrip_${CARIMBO}.sql.gz"
PARCIAL="${ARQUIVO}.partial"

log() { printf '[backup] %s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
falhar() { log "ERRO: $*"; rm -f "$PARCIAL" "${CREDENCIAIS:-}"; exit 1; }

command -v mysqldump >/dev/null || falhar "mysqldump não encontrado (instale o cliente do MySQL)"
command -v gzip >/dev/null      || falhar "gzip não encontrado"

# ---------- Parseia DATABASE_URL (mysql://usuario:senha@host:porta/banco) ----------
if [[ ! "$DATABASE_URL" =~ ^mysql://([^:@]+)(:([^@]*))?@([^:/]+)(:([0-9]+))?/([^?]+)$ ]]; then
  falhar "DATABASE_URL não parece uma URL mysql:// válida"
fi
DB_USUARIO="${BASH_REMATCH[1]}"
DB_SENHA="${BASH_REMATCH[3]}"
DB_HOST="${BASH_REMATCH[4]}"
DB_PORTA="${BASH_REMATCH[6]:-3306}"
DB_NOME="${BASH_REMATCH[7]}"

# Credenciais NUNCA na linha de comando (apareceriam em `ps` pra
# qualquer usuário da máquina) — vão num arquivo temporário só do
# dono, no padrão --defaults-extra-file do cliente MySQL.
CREDENCIAIS="$(mktemp)"
chmod 600 "$CREDENCIAIS"
trap 'rm -f "$CREDENCIAIS"' EXIT
{
  printf '[client]\n'
  printf 'user=%s\n' "$DB_USUARIO"
  printf 'password=%s\n' "$DB_SENHA"
  printf 'host=%s\n' "$DB_HOST"
  printf 'port=%s\n' "$DB_PORTA"
} > "$CREDENCIAIS"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"   # o dump tem dado pessoal: só o dono lê

# ---------- 1. Dump ----------
log "iniciando dump"
# --single-transaction: snapshot consistente sem lock de leitura (as
# tabelas são todas InnoDB). --routines/--triggers: nada escondido
# fora do dump. --hex-blob: binários (se algum dia houver) saem como
# hex, não corrompem o SQL. --set-gtid-purged=OFF: evita erro em
# servidores sem replicação por GTID configurada.
# SEM --databases de propósito: com --databases, o mysqldump grava
# "CREATE DATABASE"/"USE aquatrip" DENTRO do dump com o nome de
# origem — e um restore num banco de nome diferente (o fluxo
# recomendado, ver scripts/restore.sh) acabaria escrevendo no banco
# de ORIGEM por engano, não no de destino. Sem a flag, o dump só tem
# DROP/CREATE TABLE e os dados: quem escolhe o banco de destino é
# quem restaura, na hora de restaurar — igual ao --dbname do
# pg_restore original.
mysqldump --defaults-extra-file="$CREDENCIAIS" \
          --single-transaction --routines --triggers --hex-blob \
          --set-gtid-purged=OFF --default-character-set=utf8mb4 \
          --no-tablespaces \
          "$DB_NOME" \
  | gzip -9 > "$PARCIAL" \
  || falhar "mysqldump falhou"

# ---------- 2. Validação ----------
# Descompacta pra stdout e confere as tabelas obrigatórias — se o
# dump estiver truncado ou vazio, isto falha.
CONTEUDO=$(gunzip -c "$PARCIAL" 2>/dev/null) \
  || falhar "dump ilegível (arquivo corrompido?)"
TABELAS=$(grep -c '^CREATE TABLE' <<< "$CONTEUDO" || true)
[[ "$TABELAS" -gt 0 ]] || falhar "dump inválido: nenhuma tabela encontrada"

# Tabelas que precisam estar lá — se sumirem, o backup está incompleto.
for obrigatoria in users bookings payments consent_records audit_log; do
  grep -q "^CREATE TABLE \`$obrigatoria\`" <<< "$CONTEUDO" \
    || falhar "tabela obrigatória ausente no dump: $obrigatoria"
done

# ---------- 3. Finaliza ----------
mv "$PARCIAL" "$ARQUIVO"
chmod 600 "$ARQUIVO"
( cd "$BACKUP_DIR" && sha256sum "$(basename "$ARQUIVO")" > "$(basename "$ARQUIVO").sha256" )

TAMANHO=$(du -h "$ARQUIVO" | cut -f1)
log "ok: $(basename "$ARQUIVO") ($TAMANHO, $TABELAS tabelas)"

# ---------- 4. Rotação ----------
mapfile -t ANTIGOS < <(ls -1t "$BACKUP_DIR"/aquatrip_*.sql.gz 2>/dev/null | tail -n +"$((MANTER + 1))")
for velho in "${ANTIGOS[@]}"; do
  rm -f "$velho" "$velho.sha256"
  log "rotação: removido $(basename "$velho")"
done

log "concluído. Lembre-se: copie para fora deste servidor."
