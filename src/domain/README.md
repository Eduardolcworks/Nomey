# `src/domain` — reglas de negocio puras

La capa más estricta y la más importante de Nomey.

## Regla

**Sin React. Sin Expo. Sin Supabase. Sin red. Sin acceso a disco.**

Solo funciones puras y deterministas. La regla está impuesta por ESLint
(`no-restricted-imports` en `eslint.config.js`), no es una convención opcional.

## Por qué

Aquí vive el cálculo que, si falla, le dice a una persona real que debe una
cantidad equivocada. Aislado de React y de la red, se puede testear de forma
exhaustiva en milisegundos, y un cambio de UI no puede alterar su
comportamiento: al no importar nada de las capas superiores, la única vía de
influencia son los argumentos que recibe.

## Contenido

| Módulo                      | Responsabilidad                                        |
| --------------------------- | ------------------------------------------------------ |
| `money/currency-definition` | Identidad monetaria opaca y su escala                  |
| `money/money`               | Aritmética exacta sobre importes en unidad mínima      |
| `money/rounding`            | Redondeo _half away from zero_ sobre magnitud absoluta |
| `money/exchange-rate`       | Tipo de cambio como coeficiente entero y escala        |
| `money/convert`             | Conversión racional exacta con un único redondeo final |
| `split/largest-remainder`   | Mayor resto sobre magnitud no negativa                 |
| `split/split`               | `equal`, `shares` y `exact_amounts`                    |
| `effects/effect`            | El efecto y sus dimensiones separadas                  |
| `effects/derive`            | Operación → efectos                                    |
| `effects/balance`           | Saldos y totales económicos derivados                  |
| `effects/debt`              | Deudas netas, liquidaciones y pagos parciales          |

**Fuera de esta capa, por decisión:** la autorización —quién puede registrar
qué—, la idempotencia y la selección de la versión vigente pertenecen a la
frontera de escritura. **La minimización del número de pagos para saldar un
grupo no está implementada**: ADR-002 no fija ningún algoritmo normativo, y
inventar una heurística acoplaría cliente y servidor a algo no decidido.

## Invariantes

- Los valores monetarios que son **fuente de verdad contable se representan de
  forma exacta**, nunca mediante coma flotante binaria susceptible de error de
  precisión. La escala decimal depende de la moneda (EUR 2, JPY 0), así que
  ningún módulo debe asumir 2 decimales.
- Todo importe viaja **siempre acompañado de su moneda**. No existe un importe
  sin moneda.
- El redondeo y el reparto del resto (100 € entre 3) siguen una **regla
  determinista y documentada**. Si no cuadra al céntimo, es un bug.
- **Frontera:** los cálculos aproximados (previsiones, ratios, geometría de
  gráficas) pueden usar float, pero **no pueden realimentar** un valor de
  registro.
- El **formateo no pertenece a esta capa**: depende del locale y vive en
  `src/lib/format`. Aquí solo hay aritmética.

> La **representación concreta** la fija
> [ADR-003](../../docs/adr/ADR-003-money-representation.md), aceptado: entero en
> unidad mínima con `bigint`. Ojo: en TypeScript un `number` es
> un double IEEE-754, exacto solo para enteros hasta 2^53 — "usar un entero"
> también es una elección con límites, no una salida de la pregunta.

## Implementación de referencia

Esta capa **no es solo el cálculo del cliente**. ADR-002 §7 exige que la frontera
de escritura autoritativa del servidor produzca exactamente los mismos
resultados, y es lo que hace visible cualquier deriva entre las
dos implementaciones. **Los vectores son la fuente única de expectativas**: no se
escribe un resultado esperado en el código de test.

Al cierre de la Fase 3.B: **110 tests en verde**.

## Tests

Obligatorios, en `tests/domain/`, escritos **en el mismo PR** que la lógica.
