# ADR-001 — Licencia de Nomey y avisos de terceros

- **Estado:** Propuesto
- **Fecha:** 2026-08-17

> ⚠️ Este documento no es asesoramiento legal. Antes de publicar en tiendas
> conviene una revisión por un profesional.

## Contexto

Nomey se creó con `create-expo-app`, que deja en la raíz un archivo `LICENSE`
con el texto **MIT y copyright de 650 Industries, Inc. (Expo)**.

Ese archivo plantea dos problemas simultáneos si se deja como está:

1. Licencia el código de Nomey bajo MIT, permitiendo a cualquiera copiarlo,
   modificarlo y venderlo. Nomey es un producto propietario.
2. Atribuye la autoría a Expo, no a LC Works.

Al mismo tiempo, **borrarlo sin más tampoco es correcto**: la licencia MIT
obliga a conservar el aviso de copyright en "copias o porciones sustanciales
del Software", y el proyecto partió de ese template.

### Auditoría del árbol de dependencias

El recuento, con su universo, metodología y fecha declarados, vive en
[`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md). Resumen a
**2026-08-17**, sobre las **853** entradas de `package-lock.json` — universo
elegido por ser el único reproducible desde un archivo versionado: 739 MIT, 40
ISC, 27 Apache-2.0, 12 MPL-2.0, 18 BSD y ninguna entrada sin metadato de
licencia.

> Una versión anterior de este ADR citaba **515 paquetes**. Esa cifra procedía
> de recorrer `node_modules` antes de instalar el linting y **sin declarar el
> universo**, así que no era reproducible; se retira. El cambio de cifra no
> refleja ningún cambio en las dependencias del proyecto.

**Advertencia de alcance:** ese universo incluye todo el tooling de build. El
inventario legalmente relevante es **lo que viaja dentro del binario**, que no
se deriva del lockfile y **está pendiente de determinar**.

Los casos no plenamente permisivos:

- **`lightningcss`** (MPL-2.0; 12 entradas, que son el paquete y sus 11
  binarios por plataforma). Copyleft **a nivel de archivo**. Se usa
  como herramienta de build (procesado de CSS en Metro). **No se ha verificado
  si alguna porción llega al binario distribuido**, y la MPL-2.0 impone
  obligaciones de disponibilidad del código de los archivos cubiertos cuando se
  distribuyen en forma ejecutable, se hayan modificado o no. Pendiente de
  comprobar antes de publicar.
- **`node-forge`** (BSD-3-Clause **OR** GPL-2.0). Licencia dual: se puede
  acoger a BSD-3-Clause.

**No hay AGPL, SSPL ni GPL puro.** En el recuento no se ha identificado ninguna
licencia que obstaculice distribuir Nomey como software propietario. Es una
lectura del árbol de dependencias hecha con herramientas, no un dictamen legal:
la conclusión queda sujeta a la revisión profesional pendiente.

### Obligación que sí existe

MIT, BSD, ISC y Apache-2.0 exigen **conservar el aviso de copyright en las
distribuciones binarias**. Una app publicada en App Store o Play **es** una
distribución binaria. Apache-2.0 (§4) añade la obligación de propagar los
archivos `NOTICE` que existan.

En la práctica del sector esto se cumple con una pantalla de **"Licencias de
código abierto"** dentro de Ajustes.

## Decisión

Propuesta en tres partes:

1. **Sustituir el `LICENSE` del template** por un aviso propietario de LC Works
   (borrador en `NOTICE.md`). **No ejecutado todavía**: requiere aprobación
   explícita.
2. **Conservar el aviso MIT de Expo** íntegro en `THIRD-PARTY-NOTICES.md`,
   junto con el resumen del árbol de licencias.
3. **Añadir una pantalla de licencias de código abierto** en Ajustes antes de
   la primera publicación, generada automáticamente desde el árbol de
   dependencias.

Durante la Fase 0 solo se ha ejecutado el punto 2. `LICENSE` **permanece
intacto**.

## Alternativas consideradas

**A. Borrar `LICENSE` sin sustituirlo.**
Un repositorio privado sin licencia implica, por defecto, todos los derechos
reservados, así que jurídicamente podría bastar. Descartada porque elimina el
aviso de Expo sin dejar rastro y no deja constancia expresa de la titularidad,
lo que complica cualquier discusión futura sobre autoría.

**B. Mantener MIT y publicar Nomey como open source.**
Descartada: contradice la decisión de producto. Permitiría a un tercero
publicar un clon.

**C. Mantener el `LICENSE` de Expo tal cual.**
Descartada: es la peor opción de todas. Licencia el código propio bajo MIT
_y_ atribuye el copyright a otra empresa.

**D. Licencia propietaria + `THIRD-PARTY-NOTICES.md` + pantalla de licencias.**
**Elegida.** Cumple las obligaciones de atribución, deja constancia de la
titularidad y no compromete el carácter propietario del producto.

## Consecuencias

**A favor**

- El carácter propietario queda expresado, no solo implícito.
- Las obligaciones de atribución quedan documentadas antes de publicar, no
  descubiertas durante la revisión de tienda.
- El aviso de Expo se conserva donde corresponde.

**En contra**

- Hay que **mantener** `THIRD-PARTY-NOTICES.md` al añadir dependencias, y se
  desactualizará salvo que se genere automáticamente.
- La pantalla de licencias es trabajo adicional antes del lanzamiento.
- Una licencia propietaria disuade contribuciones externas. Irrelevante hoy.

**Pendiente**

- Aprobación para sustituir `LICENSE`.
- Confirmar la denominación legal exacta de LC Works para el copyright.
- Revisión legal antes de publicar.
