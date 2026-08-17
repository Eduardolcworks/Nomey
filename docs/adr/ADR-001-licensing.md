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

Recuento sobre 515 paquetes instalados:

| Licencia                  | Paquetes |
| ------------------------- | -------- |
| MIT                       | 451      |
| ISC                       | 22       |
| Apache-2.0                | 13       |
| BSD-3-Clause              | 8        |
| BlueOak-1.0.0             | 5        |
| BSD-2-Clause              | 4        |
| MPL-2.0                   | 2        |
| Otras permisivas y duales | 10       |

Los tres casos no plenamente permisivos:

- **`lightningcss`** (MPL-2.0, ×2). Copyleft **a nivel de archivo**. Se usa
  como herramienta de build (procesado de CSS en Metro). **No se ha verificado
  si alguna porción llega al binario distribuido**, y la MPL-2.0 impone
  obligaciones de disponibilidad del código de los archivos cubiertos cuando se
  distribuyen en forma ejecutable, se hayan modificado o no. Pendiente de
  comprobar antes de publicar.
- **`node-forge`** (BSD-3-Clause **OR** GPL-2.0). Licencia dual: se puede
  acoger a BSD-3-Clause.

**No hay AGPL, SSPL ni GPL puro.** Nada impide distribuir Nomey como software
propietario.

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
