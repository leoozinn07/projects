#!/usr/bin/env bash
# ==============================================================
# AquaTrip — Teste de restauração (backup só vale se restaurar)
# ==============================================================
# Uso:
#   ./scripts/verificar-restore.sh <url-origem> <url-restaurado>
#
# Compara origem e restaurado tabela por tabela: contagem E hash do
# conteúdo. Qualquer erro de consulta conta como FALHA — nunca como
# "igual". Uma verificação que passa quando os dois lados quebram
# (vazio == vazio) dá falsa confiança, que é pior que não verificar.
#
# Diferente do Postgres — que tem um cast genérico de linha inteira
# pra texto (x::text) —, o MySQL não tem equivalente: o hash de cada
# linha é montado coluna por coluna, descobertas via
# information_schema, então funciona pra qualquer tabela sem precisar
# listar colunas à mão.
# ==============================================================
set -uo pipefail
ORIGEM="${1:?uso: $0 <url-origem> <url-restaurado>}"
RESTAURADO="${2:?uso: $0 <url-origem> <url-restaurado>}"

falhas=0
CRED_TMP=()
trap 'rm -f "${CRED_TMP[@]}"' EXIT

# Devolve, em stdout: "usuario\tsenha\thost\tporta\tbanco" a partir de
# uma URL mysql://usuario:senha@host:porta/banco.
parse_url() {
  local url="$1"
  if [[ ! "$url" =~ ^mysql://([^:@]+)(:([^@]*))?@([^:/]+)(:([0-9]+))?/([^?]+)$ ]]; then
    echo "__ERRO__"; return
  fi
  printf '%s\t%s\t%s\t%s\t%s\n' \
    "${BASH_REMATCH[1]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}" \
    "${BASH_REMATCH[6]:-3306}" "${BASH_REMATCH[7]}"
}

# mysql_of <url> — devolve um comando (via arquivo de credenciais)
# pronto pra rodar consultas naquele banco. Ecoa o nome do arquivo de
# credenciais e o nome do banco, separados por tab.
mysql_of() {
  local campos usuario senha host porta banco cred
  campos="$(parse_url "$1")"
  [[ "$campos" == "__ERRO__" ]] && { echo "__ERRO__"; return; }
  IFS=$'\t' read -r usuario senha host porta banco <<< "$campos"
  cred="$(mktemp)"; chmod 600 "$cred"; CRED_TMP+=("$cred")
  { printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' \
      "$usuario" "$senha" "$host" "$porta"; } > "$cred"
  printf '%s\t%s\n' "$cred" "$banco"
}

# consulta <arq-credenciais> <banco> <sql> — roda ou marca como erro;
# jamais devolve vazio silencioso.
consulta() {
  local r
  r=$(mysql --defaults-extra-file="$1" -N -B "$2" -e "$3" 2>/dev/null) || { echo "__ERRO__"; return; }
  [[ -z "$r" ]] && { echo "__ERRO__"; return; }
  echo "$r"
}

# hash_tabela <arq-credenciais> <banco> <tabela> — MD5 do conteúdo
# inteiro da tabela, ordem-independente por linha (cada linha vira um
# MD5 próprio; os MD5s de linha são concatenados em ordem e hasheados
# de novo). group_concat_max_len alto evita truncar em tabelas
# grandes, o que daria falso "igual" em dois lados truncados do
# mesmo jeito.
hash_tabela() {
  local cred="$1" banco="$2" tabela="$3" colunas expr
  colunas=$(mysql --defaults-extra-file="$cred" -N -B "information_schema" \
    -e "SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ',')
        FROM columns WHERE table_schema = '$banco' AND table_name = '$tabela'" 2>/dev/null)
  [[ -z "$colunas" ]] && { echo "__ERRO__"; return; }
  expr="CONCAT_WS('\x1f', $colunas)"
  consulta "$cred" "$banco" \
    "SET SESSION group_concat_max_len = 1000000000;
     SELECT MD5(COALESCE(GROUP_CONCAT(h ORDER BY h SEPARATOR ''), ''))
     FROM (SELECT MD5($expr) AS h FROM \`$tabela\`) x"
}

CO="$(mysql_of "$ORIGEM")"; CR="$(mysql_of "$RESTAURADO")"
if [[ "$CO" == "__ERRO__" || "$CR" == "__ERRO__" ]]; then
  echo "RESULTADO: URL de origem ou de restaurado inválida"; exit 1
fi
IFS=$'\t' read -r CRED_O BANCO_O <<< "$CO"
IFS=$'\t' read -r CRED_R BANCO_R <<< "$CR"

for t in users bookings payments consent_records audit_log webhook_events services service_slots; do
  co=$(consulta "$CRED_O" "$BANCO_O" "SELECT COUNT(*) FROM \`$t\`")
  cr=$(consulta "$CRED_R" "$BANCO_R" "SELECT COUNT(*) FROM \`$t\`")
  ho=$(hash_tabela "$CRED_O" "$BANCO_O" "$t")
  hr=$(hash_tabela "$CRED_R" "$BANCO_R" "$t")

  if [[ "$co" == "__ERRO__" || "$cr" == "__ERRO__" || "$ho" == "__ERRO__" || "$hr" == "__ERRO__" ]]; then
    printf "  FALHA   %-16s consulta com erro\n" "$t"; falhas=$((falhas+1))
  elif [[ "$co" != "$cr" || "$ho" != "$hr" ]]; then
    printf "  DIVERGE %-16s origem=%s restaurado=%s\n" "$t" "$co" "$cr"; falhas=$((falhas+1))
  else
    printf "  OK      %-16s %s linha(s), conteúdo idêntico\n" "$t" "$co"
  fi
done

if [[ $falhas -gt 0 ]]; then echo "RESULTADO: $falhas tabela(s) com problema"; exit 1; fi
echo "RESULTADO: backup íntegro e restaurável"
