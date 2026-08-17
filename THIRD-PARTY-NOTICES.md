# Third-party notices

Nomey se construye sobre software de terceros. Este archivo recoge los avisos
que deben conservarse.

Ver [`docs/adr/ADR-001-licensing.md`](docs/adr/ADR-001-licensing.md) para el
análisis completo y las decisiones pendientes.

---

## Template de proyecto — Expo

Nomey se inició con `create-expo-app`. El código del template está licenciado
bajo MIT. Su aviso se conserva íntegro:

```
The MIT License (MIT)

Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Inventario de dependencias

> ⚠️ **Este NO es todavía el inventario que acompañará a la app publicada.**
> Ver "Qué falta" al final.

### Qué se está contando

Una cifra de dependencias no significa nada sin decir **qué universo** se
cuenta. Estos son los que existen, medidos el **2026-08-17** con Node 22.23.2 y
npm 10.9.8:

| Universo                                             | Paquetes           |
| ---------------------------------------------------- | ------------------ |
| **A. Entradas en `package-lock.json`** (sin la raíz) | **853**            |
| B. De ellas, marcadas `dev`                          | 262                |
| C. No-`dev`                                          | 591                |
| D. Marcadas `optional` (variantes por plataforma)    | 38                 |
| E. Instaladas en esta máquina tras `npm ci`          | ~818               |
| **F. Efectivamente distribuidas en el binario**      | **sin determinar** |

**El recuento de abajo usa el universo A**, elegido porque es el único
reproducible desde un archivo versionado: no depende del sistema operativo, de
qué binarios opcionales se instalen ni del estado de `node_modules`.

**Metodología:** leer `packages` de `package-lock.json`, descartar la entrada
raíz, agrupar por el campo `license`. Reproducible sobre el lockfile
commiteado.

### Recuento (universo A, 2026-08-17)

| Licencia                  | Paquetes |
| ------------------------- | -------- |
| MIT                       | 739      |
| ISC                       | 40       |
| Apache-2.0                | 27       |
| MPL-2.0                   | 12       |
| BSD-3-Clause              | 9        |
| BSD-2-Clause              | 9        |
| BlueOak-1.0.0             | 6        |
| (MIT OR CC0-1.0)          | 2        |
| Unlicense                 | 2        |
| 0BSD                      | 2        |
| MIT AND Apache-2.0        | 1        |
| (MIT OR Apache-2.0)       | 1        |
| (BSD-3-Clause OR GPL-2.0) | 1        |
| Python-2.0                | 1        |
| CC-BY-4.0                 | 1        |
| **Sin metadato**          | **0**    |
| **Total**                 | **853**  |

Esta tabla lista **cada licencia por separado, sin categorías agregadas**, y su
total debe coincidir siempre con el universo A declarado arriba. Si no coincide,
la tabla está incompleta. En particular, `0BSD` y `(BSD-3-Clause OR GPL-2.0)`
son entradas propias y **no** forman parte de las filas `BSD-2-Clause` /
`BSD-3-Clause`.

Sin AGPL, SSPL ni GPL como licencia única. No se ha identificado en este
universo ninguna licencia que obstaculice distribuir Nomey como software
propietario. Lectura automatizada de metadatos, **no dictamen legal**.

Casos que merecen nota:

- **MPL-2.0 (12)** — son `lightningcss` y sus 11 binarios por plataforma, es
  decir un único paquete con sus variantes. Copyleft a nivel de archivo. Se usa
  como herramienta de build; **pendiente de verificar** si alguna porción llega
  al binario distribuido, ya que la MPL-2.0 obliga a dar acceso al código de
  los archivos cubiertos que se distribuyan en forma ejecutable. Ver ADR-001.
- **`node-forge`** (BSD-3-Clause OR GPL-2.0) — licencia dual; Nomey se acoge a
  BSD-3-Clause.

### Sobre la cifra anterior de 515

Versiones previas de este documento hablaban de **515 paquetes**. Esa cifra
procedía de recorrer `node_modules` (primer nivel y ámbitos) **antes de instalar
ESLint y Prettier**, y **su universo nunca se declaró**. No corresponde a
ninguno de los universos de la tabla y no es reproducible. Se retira.

---

## Qué falta antes de publicar

MIT, BSD, ISC y Apache-2.0 exigen conservar el aviso de copyright en las
**distribuciones binarias**, y una app en App Store o Play lo es.

**El inventario que importa legalmente es el universo F** — lo que realmente
viaja dentro del binario — y **no se deriva del lockfile**: depende de qué
módulos alcanza Metro desde el punto de entrada. El universo A incluye todo el
tooling de build, que no se distribuye.

Pendiente, por tanto:

- [ ] Determinar el universo F a partir del bundle, no del lockfile.
- [ ] Generar automáticamente una pantalla de **"Licencias de código abierto"**
      en Ajustes sobre ese universo, para que no se desactualice.
- [ ] Revisión legal antes de publicar.

Hasta entonces, **este documento es un inventario de trabajo, no el aviso
definitivo**.
