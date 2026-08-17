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

## Dependencias

Auditoría del árbol instalado (515 paquetes, Fase 0):

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

**Sin AGPL, SSPL ni GPL puro.** No se ha identificado ninguna licencia que
obstaculice distribuir Nomey como software propietario. Lectura automatizada
del árbol, no dictamen legal. Ver ADR-001.

Casos que merecen nota:

- **`lightningcss`** (MPL-2.0) — copyleft a nivel de archivo. Se usa como
  herramienta de build. **Pendiente de verificar** si alguna porción llega al
  binario distribuido; la MPL-2.0 obliga a dar acceso al código de los archivos
  cubiertos que se distribuyan en forma ejecutable. Ver ADR-001.
- **`node-forge`** (BSD-3-Clause OR GPL-2.0) — licencia dual; Nomey se acoge a
  BSD-3-Clause.

---

## Pendiente antes de publicar

MIT, BSD, ISC y Apache-2.0 exigen conservar el aviso de copyright en las
**distribuciones binarias**, y una app en App Store o Play lo es.

Antes del lanzamiento hay que añadir una pantalla de **"Licencias de código
abierto"** en Ajustes, generada automáticamente desde el árbol de dependencias
para que no se desactualice.

Este recuento es una foto de la Fase 0 y **debe regenerarse** cuando cambien
las dependencias.
