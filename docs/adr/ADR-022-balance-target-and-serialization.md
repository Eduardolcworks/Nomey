# ADR-022 — Ajuste por saldo objetivo y serialización de la dimensión saldo

- **Estado:** Aceptado
- **Fecha:** 2026-08-29

## Contexto

`api.record_adjustment` recibía un **delta**. El producto pide otra cosa: la
persona declara **«ahora mismo tengo 100 €»** y Nomey registra el ajuste que
haga falta.

Calcular ese delta en el cliente está descartado dos veces. Por principio,
ADR-002 §7 e invariante 20: **el cliente envía intención, no resultado**. Y por
medición, **E22/R1**:

```
saldo 120,00 · las dos sesiones piden objetivo 100,00 · saldo final 80,00
```

**Ningún orden serial produce 80,00** — A→B da 100,00 y B→A da 100,00. Las dos
leyeron 120,00 y las dos restaron 20,00. Y la idempotencia no lo cubre **ni
debe**: son comandos distintos, con claves e intenciones distintas, y aceptar los
dos es correcto. Lo que falta es serialización.

**Lo que ya estaba decidido y esta decisión no reabre:** el saldo se **deriva**
de los efectos vigentes, sin caché en v1 ([ADR-013](ADR-013-persisted-vs-derived.md) §1)
· una corrección crea versión nueva y no muta la anterior
([ADR-011](ADR-011-operation-version-model.md)) · `core.current_effect` es la
proyección canónica (ADR-013 §9) · el protocolo de serialización de ADR-013 §11,
su orden ascendente y su criterio de pertenencia **por efectos y no por nombre**
· una función pública por clase de operación ([ADR-009](ADR-009-authoritative-write-boundary.md) §1).

## Decisión

### 1. Qué declara el comando

`delta` **o** `target_balance`, **exactamente uno**. Extiende la función
existente; **no se crea una segunda**: ADR-009 §1 fija una por **clase de
operación**, y la forma del comando no es una clase nueva.

### 2. Qué significa `target_balance`, y qué no

> **El saldo que la persona declara tener EN EL MOMENTO DE RECONCILIAR.**

**No** es «el saldo que tenía en un instante histórico elegido». De ahí se sigue,
y se escribe para que no se reinterprete, que **F6.C no hace**: reconstrucción de
saldo `as-of` · recálculo retroactivo · modificación posterior de un ajuste ya
escrito cuando aparece un movimiento con fecha anterior.

La **hora efectiva** representa el momento declarado de esa reconciliación y
**no convierte el objetivo en un saldo histórico que haya que reconstruir**.

> **Consecuencia directa, y conviene verla antes de que sorprenda.** Corregir un
> objetivo lo **reafirma contra el estado actual** sin la versión sustituida. Si
> entre medias hubo otros movimientos, **quedan absorbidos**: el saldo pasa a ser
> exactamente el objetivo nuevo, no el objetivo más lo posterior. Es lo que
> significa que el objetivo sea una afirmación sobre el saldo y no un
> incremento, y la alternativa sería justamente la reconstrucción retroactiva
> que queda fuera de alcance.

### 3. Qué se persiste y qué se deriva

|                  | Dónde                                           | Qué es                                     |
| ---------------- | ----------------------------------------------- | ------------------------------------------ |
| `target_balance` | `core.adjustment_detail`                        | **Intención**. Presente solo si se declaró |
| delta            | `operation_version.original_amount` y el efecto | **Derivado** bajo lock                     |

La relación aparte, y no una columna de la versión, por la misma razón que
concepto y categoría ([ADR-020](ADR-020-version-content-and-time.md)): **no toda
versión lo tiene**. Así `original_amount` conserva **un solo significado** en las
dos formas del ajuste.

**La intención canónica lleva el objetivo, nunca el delta**: el delta depende del
estado y no es intención declarada.

### 4. Dónde se observa el saldo, y la secuencia exacta

```
1  autorizar
2  BLOQUEAR los ambitos, en orden global ascendente
3  CAS
4  derivar el saldo, ya bajo lock
5  delta = objetivo − saldo
6  persistir version, detalle y efectos
7  commit, que libera
```

Los pasos 2 y 4 **no se pueden invertir**: leer antes de bloquear reintroduce la
carrera. Es literalmente la regla de ADR-013 §11.

**Al corregir hace falta el saldo _sin_ la versión sustituida, y obtenerlo no
necesita ninguna estructura nueva.** En ese instante **el puntero de vigencia
todavía no se ha movido**, así que la versión sustituida **es** la vigente y sus
efectos están **dentro de `core.current_effect`**. Basta descontarla por
`operation_version_id` sobre la propia proyección canónica. No se lee
`core.effect`, no se resta nada por fuera, y no aparece ninguna segunda fuente
de verdad.

### 5. Quién participa en el protocolo, y por qué son siete

Por **efectos**, como manda ADR-013 §11. Siete de las ocho clases producen
dimensión de saldo; `record_debt_settlement` no produce ninguna y por eso no
observa nada.

**Y el alcance lo decide la observación, no la aritmética del objetivo.** Un
gasto o un ingreso escriben un **delta ciego**: no leen el saldo, así que por sí
solos nunca producen un resultado no serializable. Es
[ADR-023](ADR-023-balance-observation.md) quien convierte toda escritura de saldo
en una lectura. **E22/R2** lo midió: dos gastos simultáneos, y al menos una
observación falsa.

Con solo el ajuste bloqueando, R2 sigue ocurriendo — la _serialización parcial_
que ADR-013 §11 declara equivalente a no serializar nada.

### 6. Un solo orden, un solo nombre

`sec.lock_debt_scopes` pasa a **`sec.lock_scopes`**. Su mecanismo nunca supo nada
de deuda. Mantener dos nombres para un mismo mecanismo **invitaría a creer que
son dos órdenes distintos, que es como se construye un deadlock**.

Se bloquea la **unión** de los ámbitos de la intención nueva y los de la versión
sustituida, en las dos dimensiones y con **un único orden ascendente**.

### 7. La hora del ajuste

**Obligatoria**; el contrato del ajuste pasa a **2**. F6.B delegó aquí la
decisión, y son tres razones: un ajuste por objetivo es **por naturaleza una
observación en un instante**; F6.D necesita **un** criterio de orden en una lista
mixta; y `created_at` es el instante de **registro** y no puede fingir ser el
efectivo — ajustar hoy un saldo de ayer los separa.

**Sin concepto ni categoría**, como decidió ADR-020: su línea de historial la
deriva el producto —«Saldo ajustado a X»— y el objetivo persistido es lo que la
rellena.

## Consecuencias

**Aceptadas.**

- **Toda escritura de saldo sobre un ámbito se serializa.** Con un único dueño es
  irrelevante; en un Grupo, el mismo protocolo que ya gobernaba la deuda.
- Corregir un objetivo absorbe lo posterior (§2). Es la semántica decidida, y se
  documenta en vez de disimularse.
- Las ocho funciones autoritativas se reescribieron. Siete por lock y
  observación; `record_debt_settlement` solo por el renombrado.

## Alternativas descartadas

| Alternativa                                                       | Por qué no                                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **El cliente calcula el delta**                                   | Envía un resultado, y E22/R1 mide que dos objetivos concurrentes dejan un saldo que **ningún orden serial produce**                   |
| **Función pública aparte para el objetivo**                       | Dos funciones para la clase `adjustment`, contra ADR-009 §1                                                                           |
| **`original_amount` = objetivo**                                  | La misma columna significaría delta en un ajuste y objetivo en otro                                                                   |
| **Derivar el objetivo de `balance_after`**                        | Coinciden por construcción, pero construiría la etiqueta que el usuario lee sobre un dato declarado **ilustrativo y no autoritativo** |
| **Bloquear solo el ajuste**                                       | Deja falsas las observaciones de todo gasto e ingreso concurrente (E22/R2)                                                            |
| **Materializar el saldo para tener fila que bloquear**            | Segunda fuente de verdad; ADR-013 alternativa B ya la descartó, y el lock sobre `core.scope` responde el único argumento a favor      |
| **Advisory locks por ámbito**                                     | Mecanismo paralelo sin razón material. ADR-013 §11 lo reserva como escalada **si una medición muestra contención**                    |
| **Reconstrucción `as-of` del saldo al corregir**                  | Recálculo retroactivo, expresamente fuera de alcance                                                                                  |
| **Mantener `lock_debt_scopes` y añadir un segundo lock de saldo** | Dos órdenes de adquisición es como se construye un deadlock                                                                           |

## Verificación

`supabase/checks/balance-and-annulment.sql` §A y §B, y **la concurrencia real**
en `scripts/balance-concurrency.sh`, que una sola sesión de `psql` no puede
medir.

**Falsificado.** Con `sec.lock_scopes` convertido en no-op reaparecen exactamente
los dos fallos de E22: el objetivo aterriza en 80,00 en vez de 100,00, y la
cadena de observaciones muestra un hueco.
