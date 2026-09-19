#!/usr/bin/env bash
# ============================================================================
# INGESTA Y FIJACION EN CARRERA, CON DOS SESIONES REALES (F11/ADR-002 §4)
# ============================================================================
#
# sec.fx_ingest_at (migracion 20260923120000) toma un candado consultivo por
# fuente antes de leer lo guardado. La primera sesion ingiere y RETIENE su
# transaccion 3 s antes de confirmar; la segunda arranca 1 s despues. Se mide
# que la segunda ESPERO (clock_timestamp() − now() ≥ 1,5 s) y que el resultado
# es el de un orden serial: cada dia fijado UNA vez, por la primera
# observacion, y ninguna version duplicada.
#
#   1  el mismo documento, el mismo instante, dos veces a la vez
#   2  dos documentos distintos que fijarian el mismo dia: gana el primero, y
#      las versiones del segundo se guardan sin tocar lo fijado
#
# Sin el candado no habria un resultado silencioso: la segunda insercion del
# mismo dia chocaria con la clave primaria de core.fx_day y fallaria. El
# candado convierte ese fallo en una espera y en un resultado serial.
#
# Usa una fuente de fixture (`race_fx`), nunca la real. Escribe filas
# confirmadas y las retira despues, acotadas a esa fuente. Solo base local; el
# contenedor se elige con NOMEY_DB_CONTAINER (por defecto supabase_db_Nomey).
set -uo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/local-db-guard.sh"
C="${NOMEY_DB_CONTAINER:-supabase_db_Nomey}"
exigir_base_local "${C}" || exit 1

DB=(docker exec -i "${C}" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0)
DBQ=(docker exec -i "${C}" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=0)

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

S=race_fx
EUR=830e6f7e-2e33-564e-9ea3-f6c2023af1fe
USD=34cb8424-2243-52d8-be99-e2b7d22884b8
NOK=f2fe8324-641c-548d-b3af-411db0d39448
URL=https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml

limpiar() {
  "${DB[@]}" >/dev/null 2>&1 <<SQL
begin;
delete from core.fx_day_rate where source_id = '${S}';
delete from core.fx_day where source_id = '${S}';
delete from core.fx_observation_publication where source_id = '${S}';
delete from core.fx_publication_rate r using core.fx_publication p where p.id = r.publication_id and p.source_id = '${S}';
delete from core.fx_publication where source_id = '${S}';
delete from core.fx_observation where source_id = '${S}';
delete from core.fx_coverage where source_id = '${S}';
delete from core.fx_source where id = '${S}';
commit;
SQL
}
trap limpiar EXIT
limpiar

preparar() {
  limpiar
  "${DB[@]}" >/dev/null <<SQL
begin;
insert into core.fx_source (id, name, pivot_currency_definition_id, first_reference_date, evidence_url)
values ('${S}', 'fixture de carreras', '${EUR}', '2026-09-01', 'https://www.ecb.europa.eu/');
insert into core.fx_coverage (source_id, currency_definition_id, source_code, valid_from, valid_from_basis, valid_from_evidence)
values ('${S}', '${EUR}', null,  '2026-09-01', 'fixture', 'https://www.ecb.europa.eu/'),
       ('${S}', '${USD}', 'USD', '2026-09-01', 'fixture', 'https://www.ecb.europa.eu/'),
       ('${S}', '${NOK}', 'NOK', '2026-09-01', 'fixture', 'https://www.ecb.europa.eu/');
commit;
SQL
}

# Documento con la forma del BCE: fechas en orden descendente, como la fuente.
documento() { # cuerpo
  printf '%s' "<?xml version=\"1.0\" encoding=\"UTF-8\"?><gesmes:Envelope xmlns:gesmes=\"http://www.gesmes.org/xml/2002-08-01\" xmlns=\"http://www.ecb.int/vocabulary/2002-08-01/eurofxref\"><gesmes:subject>Reference rates</gesmes:subject><gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender><Cube>$1</Cube></gesmes:Envelope>"
}
DOC_A=$(documento '<Cube time="2026-09-03"><Cube currency="USD" rate="1.16"/><Cube currency="NOK" rate="10.8"/></Cube><Cube time="2026-09-02"><Cube currency="USD" rate="1.15"/><Cube currency="NOK" rate="10.7"/></Cube><Cube time="2026-09-01"><Cube currency="USD" rate="1.14"/><Cube currency="NOK" rate="10.6"/></Cube>')
# El mismo 03 sin NOK y el 02 enmendado: fijaria el 04 de otra manera.
DOC_B=$(documento '<Cube time="2026-09-03"><Cube currency="USD" rate="1.16"/></Cube><Cube time="2026-09-02"><Cube currency="USD" rate="1.15"/><Cube currency="NOK" rate="10.9"/></Cube><Cube time="2026-09-01"><Cube currency="USD" rate="1.14"/><Cube currency="NOK" rate="10.6"/></Cube>')

ESPERA_SQL="select 'ESPERA=' || round(extract(epoch from clock_timestamp() - now())::numeric, 1);"

ingerir() { # salida documento instante retener
  "${DB[@]}" >"$1" 2>&1 <<SQL &
begin;
select 'RES=' || sec.fx_ingest_at('${S}', \$DOC\$$2\$DOC\$, '{"url":"${URL}","status":200}', '$3'::timestamptz)::text;
${ESPERA_SQL}
select pg_sleep($4);
commit;
SQL
}

q() { "${DBQ[@]}" <<SQL | tr -d '[:space:]'
$1
SQL
}
res()      { grep -o 'RES=.*' "$1" | head -n 1 | cut -d= -f2-; }
campo()    { res "$1" | sed -E "s/.*\"$2\": ?([^,}]*).*/\1/"; }
espera_de(){ grep -o 'ESPERA=[0-9.]*' "$1" | cut -d= -f2; }
espero() { local e; e=$(espera_de "$1")
  if [ -n "${e}" ] && awk -v e="${e}" 'BEGIN { exit !(e >= 1.5) }'; then ok "$2 espero al candado (${e} s)"; else fallo "$2 no espero: ESPERA=${e:-?} · $(tr -d '\n' <"$1" | head -c 200)"; fi; }
esperar() { wait "$1"; wait "$2"; }
afirmar() { [ "$1" = "$2" ] && ok "$3 = $2" || fallo "$3: esperado $2, medido $1"; }

t1=""; t2=""
carrera() { echo "== $1 =="; t1=$(mktemp); t2=$(mktemp); }
fin() { rm -f "${t1}" "${t2}"; }

carrera "1 · el mismo documento y el mismo instante, dos veces a la vez"
preparar
T='2026-09-04 10:00:00+02'
ingerir "${t1}" "${DOC_A}" "${T}" 3; p1=$!
sleep 1
ingerir "${t2}" "${DOC_A}" "${T}" 0; p2=$!
esperar "${p1}" "${p2}"
espero "${t2}" "la segunda"
afirmar "$(campo "${t1}" days_fixed)" 3 "dias que fijo la primera"
afirmar "$(campo "${t2}" days_fixed)" 0 "dias que fijo la segunda"
afirmar "$(campo "${t2}" versions_new)" 0 "versiones nuevas de la segunda"
afirmar "$(q "select count(*) from core.fx_day where source_id = '${S}'")" 3 "dias fijados"
afirmar "$(q "select count(*) from core.fx_publication where source_id = '${S}'")" 3 "versiones"
afirmar "$(q "select count(*) from core.fx_observation where source_id = '${S}' and complete")" 2 "observaciones completas"
afirmar "$(q "select count(*) from core.fx_day_rate where source_id = '${S}'")" 9 "tipos fijados"
fin

carrera "2 · dos documentos que fijarian el 04 de forma distinta"
preparar
"${DB[@]}" >/dev/null <<SQL
select sec.fx_ingest_at('${S}', \$DOC\$${DOC_A}\$DOC\$, '{"url":"${URL}","status":200}', '2026-09-03 18:00:00+02');
SQL
ingerir "${t1}" "${DOC_A}" '2026-09-04 00:10:00+02' 3; p1=$!
sleep 1
ingerir "${t2}" "${DOC_B}" '2026-09-04 00:20:00+02' 0; p2=$!
esperar "${p1}" "${p2}"
espero "${t2}" "la segunda"
afirmar "$(campo "${t1}" days_fixed)" 1 "dias que fijo la primera"
afirmar "$(campo "${t2}" days_fixed)" 0 "dias que fijo la segunda"
afirmar "$(campo "${t2}" versions_new)" 2 "versiones nuevas de la segunda (el 03 sin NOK y el 02 enmendado)"
afirmar "$(q "select r.position || r.reference_date from core.fx_day_rate r where r.source_id = '${S}' and r.day = '2026-09-04' and r.currency_definition_id = '${NOK}'")" \
        "R2026-09-03" "NOK del 04, fijado por la primera"
afirmar "$(q "select count(*) from core.fx_day d join core.fx_observation o on o.id = d.observation_id where d.source_id = '${S}' and d.day = '2026-09-04' and o.observed_at = '2026-09-04 00:10:00+02'")" \
        1 "el 04 lo fijo la primera observacion"
afirmar "$(q "select count(*) from core.fx_publication where source_id = '${S}'")" 5 "versiones"
fin

echo
if [ "${fallos}" -eq 0 ]; then echo "FIJACION EN CARRERA: OK (2 carreras)"; else echo "FIJACION EN CARRERA: ${fallos} fallo(s)"; exit 1; fi
