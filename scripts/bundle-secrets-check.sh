#!/usr/bin/env bash
#
# Ninguna credencial privada de backend en lo que de verdad se empaqueta.
#
# Es el criterio 4 de cierre de la Fase 5 —`docs/product/roadmap.md`— y el
# invariante de `AGENTS.md` §7, mirado sobre el ARTEFACTO y no sobre el fuente.
#
# POR QUE HACE FALTA UNA TERCERA CAPA. Ya hay dos, y ninguna ve lo que esta ve:
#
#   1. `tests/infra/no-backend-secrets.test.ts` revisa el FUENTE VERSIONADO. No
#      puede ver el `.env` de cada maquina, que no esta versionado — y es
#      justamente ahi donde alguien pega una clave secreta.
#   2. `src/lib/env/supabase-env.ts` rechaza una clave con forma de secreto EN
#      EJECUCION. Protege al que arranca la app, no al que publica el binario.
#
# El modo de fallo que cierra esta capa es el peor que hay, porque no tiene
# sintoma: una clave secreta en `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` funciona
# PERFECTAMENTE en desarrollo y solo se descubre cuando alguien descomprime lo
# publicado.
#
# LA CLASIFICACION NO SE INVENTA AQUI. Publico frente a privado ya lo decide
# `src/lib/env/supabase-env.ts`, que es la fuente canonica: `sb_publishable_` se
# acepta, `sb_secret_` se rechaza por nombre, y CUALQUIER JWT se rechaza tambien
# —incluida la `anon` heredada— porque Nomey no arranca sobre el sistema de
# claves antiguo. Este script aplica esa misma clasificacion al artefacto, y por
# eso la URL publica y la clave publicable NO son hallazgos: estan ahi porque
# deben estarlo.
#
# POR QUE SE EXPORTA SIN BYTECODE, que es la unica decision no obvia de aqui.
# Hermes empaqueta la tabla de cadenas SIN SEPARADORES, asi que sobre el `.hbc`
# cualquier regla con sufijo cruza la frontera entre dos cadenas contiguas.
# MEDIDO en este repositorio: el prefijo legitimo `sb_secret_` de
# `supabase-env.ts` quedaba pegado a `_getObserverID` y se leia como una clave.
# El `.hbc` es una compilacion de exactamente estas cadenas, asi que revisar el
# JS ve el mismo contenido sin ese ruido — y un falso positivo que hay que
# silenciar es peor que no tener el check.
#
# POR QUE SE LIMPIA LA CACHE, que es la otra decision no obvia. Expo inlinea
# las `EXPO_PUBLIC_` en tiempo de TRANSFORMACION y Metro guarda ese resultado,
# asi que un export normal puede revisar un bundle que lleva la configuracion
# ANTERIOR. MEDIDO: con la cache caliente, una clave secreta puesta a proposito
# en el entorno no llegaba al artefacto y el check pasaba. Sin `--clear` esta
# comprobacion no demuestra nada sobre la configuracion actual.
#
# SI SE EJECUTA EN CI desde F8.A1, y la duda que dejaba escrita aqui quedo
# resuelta al reves de como estaba planteada. Exportar exige las dos
# `EXPO_PUBLIC_`, pero NO exige las de nadie: son configuracion publica, no
# secretos, asi que CI las pone FICTICIAS. Un secreto de repositorio habria sido
# la respuesta equivocada -habria metido un valor real en un job cuyo unico
# proposito es demostrar que ahi no hay valores reales-.
#
# Quien lo orquesta es `scripts/bundle-secrets-matrix.sh`: pasa las tres
# variantes con valores ficticios y, ademas, siembra un secreto a proposito para
# comprobar que esta guarda FALLA. Una guarda que solo se ha visto pasar no se
# ha visto funcionar.
#
# Uso, desde la raiz del repositorio y con el `.env` de la maquina puesto:
#
#   ./scripts/bundle-secrets-check.sh
#
# Exporta a un directorio temporal propio y lo borra al salir. No toca `dist/`.

set -uo pipefail

fallos=0
fallo() { echo "  FALLO: $*"; fallos=$((fallos + 1)); }
ok()    { echo "  ok: $*"; }

OUT="$(mktemp -d -t nomey-bundle-XXXXXX)"
LOG="$OUT.log"
trap 'rm -rf "$OUT" "$LOG"' EXIT

echo
echo "=== Variante bajo revision ==="
echo "  APP_VARIANT=${APP_VARIANT:-(sin definir, resuelve development)}"

echo
echo "=== Exportando el bundle de iOS a un directorio temporal ==="
if ! npx expo export --platform ios --no-bytecode --clear --output-dir "$OUT" >"$LOG" 2>&1; then
  echo "  FALLO: la exportacion no termino. Ultimas lineas:"
  tail -20 "$LOG"
  exit 1
fi

ficheros=$(find "$OUT" -type f | wc -l | tr -d ' ')
echo "  ficheros exportados: $ficheros"

# Un export vacio pasaria todas las comprobaciones de ausencia sin mirar nada,
# que es el peor de los falsos verdes.
if [ "$ficheros" -lt 3 ]; then
  fallo "el export tiene $ficheros ficheros: no hay artefacto que revisar"
fi

GREP=(grep -r -a -o -E)

echo
echo "=== Lo que NUNCA puede estar en un bundle de cliente ==="

# Las mismas tres formas que rechaza `supabase-env.ts`, mas una clave privada
# PEM. Se buscan como literal SEGUIDO DE CONTENIDO: el prefijo a secas aparece
# en el propio validador y en sus mensajes de error, y prohibirlo obligaria a
# silenciar el check.
comprueba_ausencia() {
  local nombre="$1" patron="$2"
  local coincidencias
  coincidencias=$("${GREP[@]}" "$patron" "$OUT" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$coincidencias" != "0" ]; then
    # El valor NO se imprime: seria filtrar el secreto al log de quien lo busca.
    fallo "$nombre presente en el bundle ($coincidencias coincidencia/s)"
  else
    ok "sin $nombre"
  fi
}

comprueba_ausencia "clave secreta de Supabase (sb_secret_)" 'sb_secret_[A-Za-z0-9_-]{8,}'
comprueba_ausencia "clave JWT heredada (anon o service_role)" \
  'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}'
comprueba_ausencia "clave privada PEM" 'BEGIN [A-Z ]*PRIVATE KEY'

echo
echo "=== Lo que SI debe estar, y por eso esto no es un grep vacio ==="

# Sin esto el check pasaria sobre un bundle que no inlineo configuracion
# ninguna, que es exactamente el escenario en el que una ausencia no demuestra
# nada. La clave publicable en el bundle es correcta: se disena para viajar.
if "${GREP[@]}" 'sb_publishable_[A-Za-z0-9_-]{8,}' "$OUT" >/dev/null 2>&1; then
  ok "la clave publicable esta inlineada, que es lo correcto y lo esperado"
else
  fallo "no hay ninguna clave publicable en el bundle: el artefacto no lleva configuracion real, asi que la ausencia de secretos no demuestra nada"
fi

echo
if [ "$fallos" -eq 0 ]; then
  echo "OK - ninguna credencial privada de backend en el bundle exportado."
  exit 0
fi
echo "$fallos comprobacion/es fallidas."
exit 1
