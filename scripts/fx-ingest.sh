#!/usr/bin/env bash
# ============================================================================
# INGESTA LOCAL DE LOS TIPOS DE REFERENCIA DEL BCE (F11/ADR-002)
# ============================================================================
#
# Descarga un documento oficial del BCE y lo entrega a sec.fx_ingest
# (migracion 20260920120000), que decide si la observacion es completa, guarda
# las versiones y fija los dias con la hora del servidor. Este script no decide
# nada: solo transporta el documento y la evidencia HTTP.
#
#   ./scripts/fx-ingest.sh            documento de 90 dias; si la base necesita
#                                     mas historia, repite con el historico
#   ./scripts/fx-ingest.sh --full     historico completo (carga inicial)
#
# SOLO BASE LOCAL. La ingesta de un entorno real espera al entorno verificado
# de F8 (docs/architecture/phase-11-progress.md). El contenedor se elige con
# NOMEY_DB_CONTAINER (por defecto supabase_db_Nomey). Escribe en la fuente real
# `ecb`, de forma permanente: nada de lo que escribe se borra.
#
# Condiciones de uso del BCE: los datos se citan como fuente (ver el runbook
# docs/runbooks/fx-ingest.md).
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
C="${NOMEY_DB_CONTAINER:-supabase_db_Nomey}"
exigir_base_local "${C}" || exit 1

readonly URL_90D="https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"
readonly URL_FULL="https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml"

case "${1:-}" in
  "") url="${URL_90D}" ;;
  --full) url="${URL_FULL}" ;;
  *) echo "uso: $0 [--full]" >&2; exit 2 ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "${tmp}"' EXIT

# Devuelve el JSON de sec.fx_ingest para <url>.
ingerir() {
  local url="$1" status last_modified etag
  # Sin --fail: un 4xx/5xx tambien es una observacion (incompleta) y se registra.
  status=$(curl --silent --show-error --location --max-time 120 \
                --dump-header "${tmp}/headers" --output "${tmp}/doc" \
                --write-out '%{http_code}' "${url}") || {
    echo "ABORTADO: la descarga de ${url} no llego a completarse (red)." >&2
    return 1
  }
  last_modified=$(grep -i '^last-modified:' "${tmp}/headers" | tail -n 1 | cut -d: -f2- | sed 's/^ *//; s/\r$//' || true)
  etag=$(grep -i '^etag:' "${tmp}/headers" | tail -n 1 | cut -d: -f2- | sed 's/^ *//; s/\r$//' || true)

  # El documento viaja en base64 dentro de la sentencia: no cabe en argv y asi
  # no hay comillas ni delimitadores que escapar.
  {
    printf "select sec.fx_ingest(convert_from(decode('"
    base64 -w0 "${tmp}/doc"
    printf "', 'base64'), 'UTF8'), jsonb_build_object('url', %s, 'status', %s, 'last_modified', %s, 'etag', %s));\n" \
      "\$u\$${url}\$u\$" "${status}" \
      "$( [ -n "${last_modified}" ] && printf '$h$%s$h$' "${last_modified}" || printf 'null')" \
      "$( [ -n "${etag}" ] && printf '$h$%s$h$' "${etag}" || printf 'null')"
  } | docker exec -i "${C}" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1
}

resultado=$(ingerir "${url}")
echo "${url}"
echo "${resultado}"

# Con el documento de 90 dias, la base puede necesitar mas historia: nada
# guardado todavia, un hueco desde lo guardado, o dias que la ventana no alcanza.
necesita_historico() {
  echo "$1" | grep -Eq '"reason": "gap_(from_source_start|after_stored)"' && return 0
  echo "$1" | grep -q '"complete": true' && ! echo "$1" | grep -Eq '"days_unfixed": 0[,}]' && return 0
  return 1
}

if [ "${url}" = "${URL_90D}" ] && necesita_historico "${resultado}"; then
  echo "La ventana de 90 dias no basta; se repite con el historico completo."
  resultado=$(ingerir "${URL_FULL}")
  echo "${URL_FULL}"
  echo "${resultado}"
fi

if echo "${resultado}" | grep -q '"complete": true'; then
  echo "OBSERVACION COMPLETA"
else
  echo "OBSERVACION INCOMPLETA: los dias sin fijar siguen sin fijar (503) hasta una completa." >&2
  exit 1
fi
