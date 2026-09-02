#!/usr/bin/env bash
#
# Guarda para los scripts que ESCRIBEN en la base.
#
# Se carga con `source`; no se ejecuta por su cuenta.
#
# **Por que existe.** Los scripts de concurrencia y el de frontera HTTP escriben
# filas confirmadas y despues las retiran. Ejecutar cualquiera de ellos contra
# una base que no sea la local de desarrollo destruiria datos reales, y nada en
# su invocacion lo impedia: bastaba tener enlazado un proyecto remoto o apuntar
# una variable de entorno a otro sitio.
#
# **No sustituye a acotar la limpieza.** Son dos protecciones distintas y las
# dos hacen falta: esta impide trabajar sobre la base equivocada; la limpieza
# acotada impide destrozar la correcta. Una sin la otra deja un hueco.

# Se niega a continuar si la conexion que va a usar el script no es el Postgres
# local de desarrollo.
#
# **LA COMPROBACION PRINCIPAL ES LA CONEXION EFECTIVA**, y esto importa. Lo que
# demuestra donde se va a escribir no es la configuracion del proyecto: es a que
# base llega de verdad el mismo `docker exec` que usara el script. Eso se
# comprueba interrogando a la propia sesion —donde escucha, con que datos, en
# que contenedor— en lugar de deducirlo.
#
# Las otras dos son coadyuvantes y NO bastan por si solas:
#
#   · un `supabase/.temp/project-ref` presente significa que hay un proyecto
#     remoto enlazado, no que este script vaya a escribir en el. De hecho estos
#     scripts nunca usan ese enlace: van por `docker exec` al contenedor local.
#     Se conserva porque un enlace es señal de que la maquina trabaja tambien
#     contra un entorno real, y ahi conviene parar y mirar;
#   · las variables de entorno de conexion las ignoran estos scripts por la
#     misma razon. Se miran para que nadie las herede al adaptar uno de ellos a
#     `psql` directo y crea que sigue protegido.
exigir_base_local() {
  local contenedor="${1:-supabase_db_Nomey}"
  local raiz
  raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

  # 1 · LA PRINCIPAL · la conexion efectiva. Se ejecuta por el mismo camino que
  # usara el script y se le pregunta a la sesion donde esta: la escucha ha de
  # ser local al contenedor y el servidor, el de desarrollo de Supabase.
  # `inet_server_addr()` es NULL cuando se entra por socket Unix, que es como
  # entra `docker exec`. Lejos de ser un hueco, es la prueba mas fuerte que hay:
  # un socket Unix no alcanza otra maquina. Se distingue de una direccion real
  # con `coalesce`, y una direccion solo se admite si es local o de la red
  # privada de Docker.
  local donde
  donde=$(docker exec -i "${contenedor}" \
            psql -U postgres -d postgres -X -q -t -A \
            -c "select coalesce(host(inet_server_addr())::text,'socket-unix')
                       || '|' || current_database() || '|' || current_user" \
            2>/dev/null | tr -d '[:space:]')

  if [ -z "${donde}" ]; then
    echo "ABORTADO: no se pudo interrogar a la base a traves de '${contenedor}'" >&2
    echo "          Sin saber a donde se escribe, no se escribe." >&2
    echo "          Levanta el stack:  ./scripts/supabase-cli.sh start" >&2
    return 1
  fi

  local host="${donde%%|*}"
  local resto="${donde#*|}"

  if [ "${resto}" != "postgres|postgres" ]; then
    echo "ABORTADO: la sesion no es la base de desarrollo esperada" >&2
    echo "          Responde: ${donde}" >&2
    return 1
  fi

  case "${host}" in
    socket-unix|127.0.0.1|::1|172.1[6-9].*|172.2[0-9].*|172.3[01].*|10.*|192.168.*) ;;
    *)
      echo "ABORTADO: la conexion efectiva sale de la maquina local" >&2
      echo "          El servidor escucha en: ${host}" >&2
      return 1
      ;;
  esac

  # 2 · Coadyuvante · proyecto remoto enlazado. AVISA, NO BLOQUEA.
  #
  # Un enlace remoto no dice nada sobre donde escribe este script: acaba de
  # demostrarse que la sesion entra por socket local al contenedor. Bloquear por
  # esto dejaria la maquina de quien trabaja tambien contra un entorno real sin
  # poder correr las pruebas locales, que es un falso positivo permanente. Se
  # avisa para que se mire, y se sigue.
  if [ -f "${raiz}/supabase/.temp/project-ref" ]; then
    echo "AVISO: hay un proyecto remoto enlazado ($(cat "${raiz}/supabase/.temp/project-ref"))." >&2
    echo "       No afecta a este script —escribe por socket local—, pero conviene" >&2
    echo "       saberlo antes de adaptar cualquiera de estos comandos." >&2
  fi

  # 3 · Coadyuvante · variables de conexion apuntando fuera. Estas SI bloquean:
  # una de ellas apuntando a otra maquina significa que existe una conexion
  # efectiva no local configurada, y estos scripts se copian y se adaptan.
  local var
  for var in SUPABASE_DB_URL DATABASE_URL PGHOST; do
    local valor="${!var:-}"
    [ -z "${valor}" ] && continue
    case "${valor}" in
      *127.0.0.1*|*localhost*) ;;
      *)
        echo "ABORTADO: ${var} apunta fuera de la maquina local" >&2
        echo "          ${var}=${valor}" >&2
        return 1
        ;;
    esac
  done

  return 0
}
