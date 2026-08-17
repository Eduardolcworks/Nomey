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

## Contenido previsto

| Módulo       | Responsabilidad                                            |
| ------------ | ---------------------------------------------------------- |
| `money`      | Aritmética en unidad mínima entera + moneda ISO-4217       |
| `split`      | Reparto de un gasto entre participantes, incluido el resto |
| `balance`    | Deudas netas por participante dentro de un grupo           |
| `settlement` | Minimización del número de pagos para saldar un grupo      |

## Invariantes

- Los importes son **enteros en la unidad mínima** de su moneda, nunca `float`.
  La escala decimal depende de la moneda (EUR 2, JPY 0), así que ningún módulo
  debe asumir 2 decimales.
- Todo importe viaja **siempre acompañado de su moneda**. No existe un importe
  sin moneda.
- El reparto del resto (100 € entre 3) sigue una **regla determinista y
  documentada**. Si no cuadra al céntimo, es un bug.
- El **formateo no pertenece a esta capa**: depende del locale y vive en
  `src/lib/format`. Aquí solo hay aritmética.

## Tests

Obligatorios, en `tests/domain/`, escritos **en el mismo PR** que la lógica.
