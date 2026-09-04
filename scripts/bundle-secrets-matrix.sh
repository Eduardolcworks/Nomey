#!/usr/bin/env bash
#
# La guarda del bundle, sobre las TRES variantes y con su caso negativo.
#
# Envuelve a `scripts/bundle-secrets-check.sh`, que es quien mira el artefacto.
# Este fichero solo decide QUE se exporta y QUE se espera de cada ejecucion.
#
# POR QUE EXISTE EL CASO NEGATIVO, que es la mitad que da valor a la otra. Una
# comprobacion de ausencia que nunca se ha visto fallar no demuestra que sepa
# encontrar nada: un grep con la ruta mal escrita, un export vacio o un patron
# roto pasan en verde exactamente igual que un bundle limpio. Asi que aqui se
# siembra deliberadamente una clave con forma de secreto en la variable
# publicable -que es el error real que esto existe para atrapar, porque
# funciona perfectamente en desarrollo- y se exige que la guarda FALLE.
#
# LAS CREDENCIALES DE ESTE FICHERO SON FICTICIAS, Y ESO ESTA COMPROBADO. No son
# de ningun proyecto, no abren nada, y `tests/infra/no-backend-secrets.test.ts`
# falla si alguna deja de ser exactamente una de las tres de abajo o si aparece
# una credencial con forma real en cualquier otro script. La direccion IP es de
# 192.0.2.0/24, el rango que la RFC 5737 reserva para documentacion.
#
# NO USA SECRETOS DEL REPOSITORIO, y es deliberado. Meter un valor real en el
# unico job cuyo proposito es demostrar que no hay valores reales seria
# contradictorio, y ademas innecesario: la URL y la clave publicable son
# configuracion publica, y al bundle le da igual cual sea mientras tenga la
# forma correcta.
#
# Uso, desde la raiz del repositorio:
#
#   ./scripts/bundle-secrets-matrix.sh
#
set -uo pipefail

CHECK="$(dirname "$0")/bundle-secrets-check.sh"

# --- Fixtures ficticios ------------------------------------------------------
URL_FICTICIA='http://192.0.2.10:54321'
PUBLICABLE_FICTICIA='sb_publishable_FICTICIA0000000000000000'
SECRETA_FICTICIA='sb_secret_FICTICIA0000000000000000'
# -----------------------------------------------------------------------------

fallos=0

echo "############################################################"
echo "# Guarda del bundle - tres variantes y un caso sembrado"
echo "############################################################"

for variante in development staging production; do
  echo
  echo "############ $variante (se espera QUE PASE) ############"
  if APP_VARIANT="$variante" \
    EXPO_PUBLIC_SUPABASE_URL="$URL_FICTICIA" \
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$PUBLICABLE_FICTICIA" \
    "$CHECK"; then
    echo "  ==> $variante: OK, y la clave publicable no produjo falso positivo"
  else
    echo "  ==> FALLO: $variante deberia haber pasado"
    fallos=$((fallos + 1))
  fi
done

echo
echo "############ negativo: secreto sembrado (se espera QUE FALLE) ############"
echo "Se pone una clave con forma de sb_secret_ en la variable PUBLICABLE, que es"
echo "el error que esta guarda existe para atrapar."

if APP_VARIANT=production \
  EXPO_PUBLIC_SUPABASE_URL="$URL_FICTICIA" \
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$SECRETA_FICTICIA" \
  "$CHECK"; then
  echo "  ==> FALLO: la guarda PASO con un secreto sembrado en el bundle."
  echo "      Eso significa que no esta mirando lo que dice mirar."
  fallos=$((fallos + 1))
else
  echo "  ==> OK: la guarda fallo, que es lo que se le pedia"
fi

echo
if [ "$fallos" -eq 0 ]; then
  echo "OK - la guarda pasa con las tres variantes y falla con un secreto sembrado."
  exit 0
fi
echo "$fallos comprobacion/es de la matriz fallidas."
exit 1
