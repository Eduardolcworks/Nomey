#!/usr/bin/env bash
#
# Comando estandar del proyecto para ejecutar la Supabase CLI.
#
# Se ejecuta DESDE UBUNTU (WSL2), no desde Windows. El motivo esta en
# docs/runbooks/local-setup.md: por esta via se ejecuta el binario ELF de
# Linux y no el supabase.exe de Windows, que no esta firmado y depende de un
# veredicto de reputacion de Smart App Control que no controlamos.
#
# Uso:
#   ./scripts/supabase-cli.sh --version
#   ./scripts/supabase-cli.sh status
#
# NO instala nada dentro del repositorio: npx descarga a la cache de npm del
# usuario (~/.npm/_npx), fuera del checkout. Nunca escribe en node_modules.

set -euo pipefail

# UNICA fuente de verdad de la version de la CLI. Cambiarla es cambiar esta
# linea; ningun documento la repite.
readonly SUPABASE_CLI_VERSION="2.115.0"

if ! command -v npx >/dev/null 2>&1; then
  echo "error: no hay npx en el PATH." >&2
  echo "       Instala Node con nvm dentro de Ubuntu; .nvmrc fija la version." >&2
  echo "       Ver docs/runbooks/local-setup.md" >&2
  exit 127
fi

# Guarda medida, no teorica: si nvm no esta cargado, WSL resuelve npx al
# toolchain de Windows a traves de /mnt/c y se acabaria ejecutando el .exe.
# Fallar aqui es preferible a "funcionar" por la via equivocada.
npx_path="$(command -v npx)"
case "$npx_path" in
  /mnt/*)
    echo "error: npx resuelve al toolchain de Windows ($npx_path)." >&2
    echo "       Ejecutaria el binario de Windows en vez del de Linux." >&2
    echo "       Carga nvm en esta shell:  source ~/.nvm/nvm.sh && nvm use" >&2
    exit 1
    ;;
esac

exec npx --yes "supabase@${SUPABASE_CLI_VERSION}" "$@"
