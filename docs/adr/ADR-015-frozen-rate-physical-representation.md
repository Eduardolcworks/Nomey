# ADR-015 — Representación física del tipo de cambio congelado

- **Estado:** Aceptado
- **Fecha:** 2026-08-25

## Contexto

Al escribir la migración de `core.frozen_conversion` —la relación que congela la
conversión aplicada a una operación al entrar en un ámbito— apareció una
divergencia real entre tres textos aceptados, todos ellos vigentes.

[ADR-003](ADR-003-money-representation.md) §4 define el tipo de cambio
conceptualmente como **coeficiente entero y escala decimal**, y a continuación
prescribe su forma en PostgreSQL:

> En PostgreSQL, **`NUMERIC` es la representación del valor decimal exacto de un
> tipo de cambio**. No se fija aquí `NUMERIC(p, s)`.

[ADR-013](ADR-013-persisted-vs-derived.md) §6, posterior y específico de esta
relación, enumera exhaustivamente lo que se congela por cada conversión:

> ámbito · definición monetaria origen · definición monetaria destino ·
> **coeficiente exacto** · **escala** · fecha efectiva para la que se resolvió ·
> procedencia opcional.

[ADR-008](ADR-008-exact-data-boundary.md) §4 fija la frontera de transporte:
**`coefficient` cruza como JSON `string`** y **`scale` como entero discreto y
acotado**, y añade que «**no se introduce un decimal canónico como segundo
contrato de transporte**».

Y `src/domain/money/exchange-rate.ts`, que ADR-002 §7 obliga a que el servidor
reproduzca exactamente, tipa `ExchangeRate { coefficient: bigint; scale: number }`.

**Las dos formas son el mismo número y solo una puede ir en la columna.** No es
una diferencia de estilo: decide qué escribe el writer, qué lee la frontera y
qué tiene que validar el esquema.

## Decisión

> **Para `core.frozen_conversion`, la representación física normativa del tipo
> de cambio congelado es el par `(coefficient, scale)`:**
>
> ```
> rate_coefficient  bigint    -- entero exacto, > 0
> rate_scale        smallint  -- entero, 0 <= scale <= 12
> ```
>
> ```
> 0,862034781245   ->   rate_coefficient = 862034781245 ,  rate_scale = 12
> ```

**Esta decisión supersede exclusivamente la prescripción de ADR-003 §4 de
almacenar el tipo como un valor `NUMERIC`.** Nada más de ADR-003 se ve afectado,
y en particular **se mantienen intactas sus cuatro garantías**, que esta forma
cumple igual o mejor:

| Garantía de ADR-003 §4                       | Cómo la cumple `(coefficient, scale)`                             |
| -------------------------------------------- | ----------------------------------------------------------------- |
| **Exacto**                                   | Dos enteros. No hay redondeo en el almacenamiento                 |
| **Nunca coma flotante binaria**              | `bigint` y `smallint`; jamás `real` ni `double precision`         |
| **Acotado**                                  | `rate_scale between 0 and 12`, la cota que ADR-003 §4 exige fijar |
| **No admite en silencio valores especiales** | Un `bigint` **no puede** ser `NaN` ni `±Infinity`                 |

**`12` es la escala máxima, no una escala fija.** Un tipo de otra magnitud usa
otra escala, y la precisión disponible depende de la escala y del coeficiente
conjuntamente. No se exige que toda tasa se exprese con escala 12.

**Sigue vigente sin cambios** todo lo demás de ADR-003 §4: el tipo corresponde a
la **fecha efectiva** del hecho, lo resuelve el **servidor**, queda **congelado**
sin revalorización automática, y una corrección **hereda el histórico** salvo que
el propio tipo sea el dato corregido. Y sigue vigente ADR-013 §6: **se congela el
valor, no una referencia**, y la procedencia **no es autoritativa**.

## Alternativas consideradas

**A · `NUMERIC(p, s)` con el valor decimal**, según la letra de ADR-003 §4.

Tiene a favor la legibilidad directa —`0.862034781245` se lee sin componer nada—
y que PostgreSQL puede operar con él aritméticamente sin reconstruirlo.

**Descartada por tres razones, en orden de peso:**

1. **Obligaría a convertir en la frontera, en los dos sentidos.** ADR-008 §4
   transporta coeficiente y escala, y el dominio los consume así. Con una
   columna `numeric` habría que descomponerla al leer y componerla al escribir,
   y esa conversión es **exactamente el sitio donde ADR-003 no quiere que pase
   nada**. Peor: E11 midió que un `numeric` que cruza a JavaScript **pierde su
   garantía de decimal exacto y su escala**, así que la descomposición tendría
   que ocurrir en SQL de todos modos.
2. **La escala dejaría de ser un dato y pasaría a ser una inferencia.**
   `0,8620` y `0,862000` son el mismo número y **distinta escala declarada**, y
   la escala es la que el dominio transporta y con la que calcula `convert()`.
   `numeric` conserva la escala en la práctica, pero apoyarse en ello es
   apoyarse en un detalle de representación, no en un contrato.
3. **`NaN` seguiría siendo representable.** El propio ADR-003 §4 dedica un
   párrafo a advertir que la documentación de PostgreSQL restringe las
   infinidades a un `numeric` sin precisión finita pero **no enuncia lo mismo
   para `NaN`**, y concluye que no debe confiarse en la precisión declarada. Con
   `bigint` la cuestión desaparece: no hay `CHECK` que recordar escribir.

**B · Las dos formas a la vez**, una columna `numeric` derivada del par.

**Descartada de plano.** Sería una segunda fuente de verdad de la misma
cantidad, exactamente lo que ADR-013 §5 y §6 rechazan al negarse a duplicar la
definición monetaria y el importe convertido. Y una columna generada tampoco
ayuda: seguiría exigiendo elegir cuál de las dos manda.

**C · Enmendar ADR-003.** **Imposible por norma**: `docs/adr/README.md` declara
inmutables los ADR aceptados, y lo único que se actualiza es la metadata de
estado. De ahí que esta decisión viva en un ADR propio y no en una corrección.

## Consecuencias

### A favor

- **Una sola forma del tipo en las cuatro capas** —columna, frontera, dominio y
  vectores compartidos—, sin conversión en ningún salto.
- **`NaN` e `Infinity` dejan de ser representables**, en vez de quedar excluidos
  por una validación que hay que acordarse de escribir.
- **La escala es un dato declarado**, no una propiedad inferida de cómo el motor
  guardó un decimal.
- La cota que ADR-003 §4 exigía declarar **queda declarada**, y es comprobable
  en catálogo.

### En contra

- **El valor no es legible de un vistazo.** Ver `862034781245` y `12` en una
  fila obliga a componer mentalmente `0,862034781245`. Una vista de lectura
  futura puede presentarlo compuesto, pero la columna no lo hace.
- **La aritmética en SQL es más incómoda.** Multiplicar por el tipo exige
  `coeficiente / 10^escala` explícito. Es el precio de no depender de `numeric`,
  y `src/domain/money/convert.ts` ya demuestra que la fórmula se mantiene entera
  y con **un único redondeo al final**.
- **La magnitud representable depende de la escala elegida.** Con `bigint`, una
  escala alta deja menos margen para la parte entera y viceversa. Es una
  propiedad de la representación, no un defecto de esta decisión, pero condiciona
  qué escala elige el servidor al resolver un tipo.
- **Queda una divergencia documental viva.** ADR-003 §4 seguirá diciendo
  `NUMERIC`, porque es inmutable. Quien lo lea aislado puede concluir lo
  contrario que este ADR; por eso esta decisión enuncia explícitamente qué
  supersede y qué no.

## Fuera de alcance

- **El proveedor, la fuente y el algoritmo de selección del tipo**, que ADR-003
  §4 deja expresamente fuera y este ADR no toca.
- **La representación de la procedencia**, que ADR-013 §6 declara opcional y no
  autoritativa y que no se persiste todavía.
- **La forma física de cualquier otro decimal exacto** que Nomey pueda necesitar
  en el futuro. Esta decisión es sobre el tipo de cambio congelado, y no
  establece una regla general contra `numeric`.
