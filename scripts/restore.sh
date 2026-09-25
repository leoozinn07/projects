#!/usr/bin/env bash
# ==============================================================
# AquaTrip — Restauração de backup (MySQL 8.0)
# ==============================================================
# Uso:
#   ./scripts/restore.sh backups/aquatrip_20260921T120000Z.sql.gz
#   RESTORE_DATABASE_URL=mysql://.../aquatrip_restore ./scripts/restore.sh <arquivo>
#
# Travas de segurança, e por quê existem:
#   - Confere o checksum antes: restaurar um arquivo corrompido
#     pode deixar o banco pela metade.
#   - Recusa restaurar em banco que já tem dados, a não ser com
#     FORCE=1. Restauração é a operação mais destrutiva que existe
#     — um comando errado no terminal de produção apaga tudo.
#   - Por padrão restaura em RESTORE_DATABASE_URL, se definido.
#     O fluxo recomendado é restaurar num banco SEPARADO, conferir,
#     e só então apontar a aplicação para ele.
#
# LIMITAÇÃO HONESTA (diferença real do Postgres): o pg_restore
# original rodava tudo dentro de UMA transação (--single-transaction):
# se algo desse errado no meio, nada ficava alterado. O MySQL não
# oferece o mesmo para um restore de SQL puro — comandos DDL
# (CREATE TABLE, DROP TABLE...) fazem commit implícito no InnoDB, o
# mesmo motivo já documentado em database/migrate.js. Ou seja: uma
# falha NO MEIO do restore pode deixar o banco de destino com
# algumas tabelas já recriadas e outras não. Por isso o fluxo
# recomendado (restaurar num banco separado, nunca por cima do de
# produção) importa ainda mais aqui do que importava com Postgres.
# ==============================================================
set -euo pipefail

ARQUIVO="${1:-}"
[[ -n "$ARQUIVO" && -f "$ARQUIVO" ]] || { echo "Uso: $0 <arquivo.sql.gz>"; exit 1; }

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${RESTORE_DATABASE_URL:-}${DATABASE_URL:-}" && -f "$RAIZ/.env" ]]; then
  set -a; source <(grep -E '^DATABASE_URL=' "$RAIZ/.env"); set +a
fi
DESTINO="${RESTORE_DATABASE_URL:-${DATABASE_URL:?defina RESTORE_DATABASE_URL ou DATABASE_URL}}"

log() { printf '[restore] %s\n' "$*"; }

# ---------- Parseia a URL de destino (mysql://usuario:senha@host:porta/banco) ----------
if [[ ! "$DESTINO" =~ ^mysql://([^:@]+)(:([^@]*))?@([^:/]+)(:([0-9]+))?/([^?]+)$ ]]; then
  log "ERRO: URL de destino não parece uma URL mysql:// válida"; exit 1
fi
DB_USUARIO="${BASH_REMATCH[1]}"; DB_SENHA="${BASH_REMATCH[3]}"
DB_HOST="${BASH_REMATCH[4]}";    DB_PORTA="${BASH_REMATCH[6]:-3306}"
DB_NOME="${BASH_REMATCH[7]}"

CREDENCIAIS="$(mktemp)"
chmod 600 "$CREDENCIAIS"
trap 'rm -f "$CREDENCIAIS" "${LISTA:-}"' EXIT
{
  printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' \
    "$DB_USUARIO" "$DB_SENHA" "$DB_HOST" "$DB_PORTA"
} > "$CREDENCIAIS"
mysql_run() { mysql --defaults-extra-file="$CREDENCIAIS" -N -B "$@"; }

# ---------- 1. Integridade ----------
if [[ -f "$ARQUIVO.sha256" ]]; then
  ( cd "$(dirname "$ARQUIVO")" && sha256sum -c --quiet "$(basename "$ARQUIVO").sha256" ) \
    || { log "ERRO: checksum não confere — arquivo corrompido. Abortando."; exit 1; }
  log "checksum ok"
else
  log "AVISO: sem arquivo .sha256 — não foi possível verificar integridade"
fi

gzip -t "$ARQUIVO" 2>/dev/null || { log "ERRO: arquivo .gz corrompido"; exit 1; }
gunzip -c "$ARQUIVO" | head -c 65536 | grep -q '^CREATE TABLE' \
  || { log "ERRO: arquivo não parece um dump válido do mysqldump"; exit 1; }

# ---------- 2. Trava contra sobrescrever dados ----------
USUARIOS=$(mysql_run "$DB_NOME" -e "SELECT COUNT(*) FROM users" 2>/dev/null || echo 0)
if [[ "$USUARIOS" -gt 0 && "${FORCE:-0}" != "1" ]]; then
  log "ERRO: o banco de destino já tem $USUARIOS usuário(s)."
  log "Restaurar por cima APAGA os dados atuais."
  log "Se é isso mesmo que você quer, rode de novo com FORCE=1."
  log "Recomendado: restaure num banco separado (RESTORE_DATABASE_URL) e confira antes."
  exit 1
fi

# ---------- 3. Restaura ----------
log "restaurando em: $(sed -E 's#://[^@]*@#://***@#' <<< "${DESTINO%%\?*}")"

# O dump (gerado por scripts/backup.sh) NÃO tem "CREATE DATABASE"/"USE"
# — de propósito, pra quem restaura escolher o banco de destino aqui,
# não o script herdar o nome de origem gravado dentro do dump. Por
# isso o banco de destino precisa existir antes (criamos se faltar) e
# recebemos o dump explicitamente nesse banco.
mysql_run --execute="CREATE DATABASE IF NOT EXISTS \`$DB_NOME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci" \
  || { log "ERRO: não foi possível criar/confirmar o banco de destino"; exit 1; }

# O dump já inclui "DROP TABLE IF EXISTS" antes de cada "CREATE TABLE"
# (comportamento padrão do mysqldump), então restaurar por cima já
# limpa e recria as tabelas — equivalente ao --clean --if-exists do
# pg_restore, sem precisar de nenhuma flag extra aqui.
if ! gunzip -c "$ARQUIVO" | mysql --defaults-extra-file="$CREDENCIAIS" "$DB_NOME"; then
  log "ERRO: restauração falhou. Veja a limitação sobre atomicidade no topo deste script:"
  log "o banco de destino pode ter ficado parcialmente restaurado."
  exit 1
fi

# ---------- 4. Conferência ----------
log "conferindo contagens:"
for t in users bookings payments consent_records; do
  n=$(mysql_run "$DB_NOME" -e "SELECT COUNT(*) FROM $t" 2>/dev/null || echo "?")
  log "  $t: $n"
done
log "concluído."
