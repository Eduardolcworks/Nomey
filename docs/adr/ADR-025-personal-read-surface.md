# ADR-025 — Superficie de lectura del Modo Personal

- **Estado:** Aceptado
- **Fecha:** 2026-08-30

## Contexto

Ocho funciones autoritativas escriben, y **nada las lee**. La única superficie de
lectura económica es `api.personal_effect`, cuya unidad es el **efecto** y cuyo
propósito es la atribución por dimensión de
[ADR-016](ADR-016-economic-attribution.md). El producto necesita otra cosa: una
lista de **movimientos**, el detalle de uno, su historial de correcciones y el
saldo.

El handoff de la Fase 6 dejó a este bloque siete obligaciones, y tres de ellas
son restricciones estructurales que ya se habían medido:

- **Las anuladas se excluyen por `version_kind`**, no por ausencia de efectos:
  un `NOT EXISTS` sobre `core.effect` dentro de una vista lo rechaza la guarda de
  [ADR-013](ADR-013-persisted-vs-derived.md) §9, como ya ocurrió en F6.A.
- **`observed_balance_after` es ilustrativo**, y una vista de `api` que dependa
  de `core.balance_observation` hace fallar el check de
  [ADR-023](ADR-023-balance-observation.md) §3.4.
- **La unidad de lectura es la operación**, y `api.personal_effect` no se
  convierte en lista de movimientos.

**Lo que no se reabre:** el saldo se **deriva** de los efectos vigentes sin caché
en v1 (ADR-013 §1) · `core.current_effect` es la proyección canónica y el
**límite de privilegio** (ADR-013 §9) · los importes cruzan `api` como **texto**
([ADR-008](ADR-008-exact-data-boundary.md) §1) · corregir versiona y no muta
([ADR-011](ADR-011-operation-version-model.md)) · anular es una versión sin
efectos, terminal, y su trazabilidad es **interna**
([ADR-024](ADR-024-annulment.md)) · el ajuste declara `delta` **o**
`target_balance` ([ADR-022](ADR-022-balance-target-and-serialization.md) §1) ·
concepto, categoría y hora viven donde el hecho existe
([ADR-020](ADR-020-version-content-and-time.md), [ADR-021](ADR-021-category-catalogue.md)).

## Decisión

### 1. Cuatro objetos, y la composición explícita entre ellos

```
api.personal_operation          vista   lista y version vigente
api.personal_operation_version  vista   historial de correcciones
api.personal_balance            vista   el Disponible, derivado
api.observed_balance(uuid[])    funcion la observacion, por lote
```

| Lo que el producto pide         | Cómo se resuelve                                                 |
| ------------------------------- | ---------------------------------------------------------------- |
| Lista de movimientos            | `personal_operation` · **1 consulta**                            |
| «Editado» con el valor anterior | `personal_operation_version?operation_version_id=in.(…)` · **1** |
| «Antes» tachado del ajuste      | `observed_balance([…])` · **1**                                  |
| Detalle de un movimiento        | las mismas tres, filtradas por `operation_id`                    |
| Historial completo              | `personal_operation_version?operation_id=eq.X`                   |
| Saldo                           | `personal_balance` · **1**                                       |

**Una página cuesta tres consultas, no 1+N.** Es la razón por la que la lista
publica `previous_version_id` y por la que la observación **toma un array**: con
un identificador único, pintar N movimientos costaría N llamadas.

**Y no hay una vista por dato.** Lista y detalle son la misma pregunta con
distinto filtro; el «anterior» y el historial completo son la misma relación con
distinto filtro. Lo que sí quedan separados son el **saldo** —una agregación, no
una fila— y la **observación** —una fotografía, no una derivación—, y esa
separación es exactamente el invariante que ADR-023 protege.

### 2. La unidad es la operación, y `api.personal_effect` no cambia

Una fila por **(operación, ámbito personal del actor)**. `api.personal_effect`
se conserva **intacta** para su propósito técnico: es la atribución por dimensión
de ADR-016 y, con ella, la superficie desde la que se derivan las **estadísticas**
que sólo `ingreso` y `gasto` alimentan (ADR-002 §4). Ampliarla a lista de
movimientos habría mezclado dos preguntas en una relación.

### 3. Dos importes, y por qué son dos

| Columna           | Qué es                                                                        |
| ----------------- | ----------------------------------------------------------------------------- |
| `balance_amount`  | **Firmado.** Lo que la operación mueve en el saldo, sobre la proyección       |
| `original_amount` | El importe **declarado** de la versión (ADR-013 §3). Un gasto lo declara en + |

No es redundancia. ADR-002 §2 existe para que el movimiento de caja y el hecho
declarado no se sustituyan el uno al otro. Y hay una razón operativa: el
historial **no puede** publicar un importe firmado —los efectos de una versión
superada están en `core.effect`, que ninguna vista puede leer—, así que publica
`original_amount`. Que la línea vigente y la tachada hablen la misma unidad es lo
que hace que la UI aplique **una sola convención de signo por operación**, y que
eso sea seguro lo garantiza `OPERATION_CLASS_MISMATCH` (ADR-020): todas las
versiones de una operación son de la misma clase.

**No se fabrica el signo con un `case` sobre la clase.** Sería aritmética
paralela a la que ya hizo el escritor, que es lo que ADR-023 rechazó para el
saldo.

### 4. El historial de correcciones es superficie de producto

El producto muestra el valor vigente, la marca **`Editado`** y, debajo, el valor
de la versión **inmediatamente anterior**. Al abrir, el historial completo.

- **El discriminante de «Editado» es `previous_version_id`**, no `version_no - 1`.
  ADR-011 §11 reservó a la frontera el invariante «el predecesor es la versión
  vigente anterior» y **no lo hizo estructural**, así que restar uno sería una
  suposición. Nulo ⇔ nunca se corrigió.
- **El historial conserva lo que cambió, y no sólo el importe**: importe, moneda,
  fecha, hora, concepto, categoría y objetivo de ajuste, cada uno tal como esa
  versión lo declaró. Cuánto de eso se muestra lo decide la UI; el backend no
  computa ningún diff.
- **La RLS que lo hace posible ya existía**: `operation_version_client_select`
  deriva de los efectos **históricos**, no sólo de los vigentes, porque la RLS de
  `core.effect` filtra por ámbito y no por vigencia. Es lo que ADR-013 §10 quería
  decir con «el historial es consultable sin estructuras adicionales».

### 5. Las anuladas, fuera de las tres superficies

Y **también del historial**, que es la consecuencia que conviene ver de frente:
ADR-024 fija que la trazabilidad de una anulada «solo es alcanzable por vía
interna», y publicarla como historial de `api` la devolvería a la superficie
normal por la puerta de atrás.

**Qué es entonces la vía interna, medido:** no es el cliente leyendo `core`.
`authenticated` **no tiene `USAGE` sobre ese schema**, así que `api` es su única
puerta. La vía es que el hecho permanece **íntegro** en `core` bajo acceso
privilegiado, y que la versión de anulación sigue siendo **legible bajo RLS** por
su dueño — lo que ADR-024 ya falsificó en su §D6.

**Y una honestidad sobre el mecanismo.** La exclusión la produce hoy la
proyección canónica: una anulación no tiene efectos, así que no aporta fila. La
cláusula `version_kind = 'record'` es **redundante — se falsificó y el check pasa
igual**. Se conserva porque el handoff exige que el criterio esté **declarado** y
no implícito, y porque quien mañana cambie la relación base y vea reaparecer las
anuladas iría a buscar el `NOT EXISTS` que la guarda rechaza. Un check afirma que
la cláusula sigue ahí, para que nadie la retire por «código muerto».

### 6. El saldo, derivado y con fila siempre

Agregación sobre `core.current_effect`, sin materializar y sin caché. **Vista y
no RPC**: no tiene parámetros ni control de flujo, y como vista conserva el
filtrado de PostgREST sin ganar nada a cambio.

**Un ámbito sin efectos devuelve una fila con `0`, no cero filas.** Con la
agregación directa, «todavía no hay movimientos» y «no hay Modo Personal» se
leerían igual, y son dos estados que el cliente pinta distinto — el mismo fallo
silencioso contra el que avisa la obligación 4 de F6.E.

**`Disponible tras saldar` no está**: necesita deuda, que llega con F9.

### 7. La observación sale por una función, y es la única

El check de ADR-023 cuenta las vistas de `api` que dependen de
`core.balance_observation` y exige **cero**. Convertir ese cero en «exactamente
una, y es ésta» funcionaría, pero **debilita el invariante literal** justo donde
`AGENTS.md` §4 avisa de que relajar una guarda es peor que el bug.

Una función consigue lo mismo **sin tocarlo**: ADR-013 §9 ya estableció que las
funciones de lectura económicas se escriben con `BEGIN ATOMIC` precisamente para
que el catálogo las cubra. Lo que se añade es una **guarda nueva** —exactamente
una función de `api` puede depender de la observación, y es
`api.observed_balance`—, no una guarda debilitada.

**`SECURITY INVOKER`, que es lo contrario de `api.claimed_dimension()` y
deliberadamente:** una lectura de reclamación debe **atravesar** la RLS; ésta
**no debe**. Consecuencia medida, y es la que evita el oráculo: un identificador
ajeno devuelve **cero filas sin error**, también por HTTP, donde un `403` o un
`404` ya delatarían que la operación existe.

Devuelve **todas las versiones**, con `is_current` separándolas: la línea de la
lista usa la vigente y el detalle puede acompañar cada versión con la suya. Cada
observación es del instante en que **su versión** se escribió (ADR-023 §5), y la
UI debe presentarla como observación del sistema, nunca como «el saldo que tenías
aquel día».

### 8. Lista blanca de clases, explícita

`personal_expense · personal_income · adjustment`. **No es una restricción
técnica:** `record_internal_transfer`, `record_group_expense` y
`record_settlement_by_transfer` también producen dimensión de saldo en un Modo
Personal, y sin la cláusula aparecerían en la lista **en cuanto F9 o F12 las
hagan alcanzables**, antes de que la superficie de producto tenga semántica para
ellas. Ampliar el contrato le toca a la fase que traiga la clase.

> **La lista blanca acota la LISTA, nunca el SALDO.** El `Disponible` se deriva
> de **todos** los efectos vigentes (ADR-013 §1); truncarlo a las clases
> representables daría una cifra falsa que no falla. En F6 coinciden porque sólo
> tres clases son alcanzables; desde F9 no tienen por qué, y el check lo fija.

### 9. El ajuste, en sus dos formas y sin nada inventado

Sin concepto ni categoría, como decidió ADR-020: salen **nulos**, no vacíos ni
sintéticos. Las dos formas se distinguen por `target_balance`, tal como ADR-022
§1 las define:

| Forma            | Cómo se lee                                                                     |
| ---------------- | ------------------------------------------------------------------------------- |
| **Por objetivo** | `target_balance` no nulo. La línea la compone el producto: «Saldo ajustado a X» |
| **Por delta**    | `target_balance` **nulo**. `original_amount` **es** el delta, con su signo      |

El delta negativo se persiste negativo —`core.operation_version` no tiene
restricción de positividad—, así que un ajuste manual por importe es
representable sin que el backend le fabrique nada.

### 10. Lo que este bloque NO expone, y por qué

**«¿Este ámbito ha tenido algún efecto alguna vez?»** queda fuera, que es lo que
F6.A delegó aquí.

No es comodidad: la pregunta es sobre **cualquier** efecto histórico, así que
`core.current_effect` responde a otra cosa, y `core.effect` está cerrado **por
partida doble** — la guarda de ADR-013 §9 prohíbe que dependan de él tanto una
**vista** como una **función**. Exponerlo exigiría una **excepción nombrada**, y
ningún consumidor de F6 la necesita: la autoridad es
`api.set_personal_base_currency`, que revalida bajo bloqueo y devuelve
`BASE_CURRENCY_LOCKED · 409`, y esa autoridad es la FK compuesta, ya medida.
Tampoco se infiere de la observación: sería cierto en la práctica y no
estructuralmente, y haría que una fotografía sostuviera una **decisión**.

Si F6.E quiere deshabilitar el selector en vez de dejar que falle con 409, eso
reabre la pregunta **con consumidor**, y entonces es una decisión propia.

**Tampoco hay superficie de diff** ni columna «qué cambió»: el historial entrega
las versiones y la comparación es presentación.

### 11. El orden es contrato del cliente

Una vista no puede imponérselo a PostgREST, así que las columnas para expresarlo
están publicadas y el orden canónico es:

```
effective_date desc, effective_time desc nulls last,
operation_created_at desc, operation_id desc
```

El desempate es `operation.created_at` y **no** el de la versión: el instante de
registro de la **operación** es estable frente a las correcciones, así que
corregir un movimiento **no lo reordena** entre sus pares del mismo día y hora.
`operation_id` cierra el orden total. `effective_time` es anulable —nulo es «sin
hora registrada», nunca medianoche—, y de ahí el `nulls last`.

**Paginación por `limit`/`offset` en F6.** El keyset sobre una tupla de cuatro
columnas no es expresable limpiamente en PostgREST, y no hay volumen que lo
justifique. Se dice en vez de disimularse.

## Consecuencias

**Aceptadas.**

- **Una excepción nombrada más**, la de la observación. Acotada a una función,
  con guarda nueva y sin tocar la anterior, pero excepción.
- **Una página cuesta tres consultas.** Es el precio de no meter la observación
  en la vista ni denormalizar el «anterior» en columnas `previous_*`.
- **Una operación anulada no tiene historial en `api`.** Recuperarlo sería
  aditivo, y hoy nadie lo pide.
- **La lista y el saldo pueden divergir desde F9**, por la lista blanca. Es
  correcto y está comprobado; lo que no sería correcto es un saldo truncado.
- **`api` gana cuatro objetos**, y `core` ni un `GRANT`: la superficie no
  pregunta nada que la RLS no hubiera previsto.

## Alternativas descartadas

| Alternativa                                           | Por qué no                                                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Lista sobre `api.personal_effect`**                 | La unidad sería el efecto. Un gasto produce saldo y económica: o se duplica la línea o se elige dimensión a ojo         |
| **Columnas `previous_*` en la lista**                 | Duplica la semántica del historial, que hace falta igualmente para el detalle. No elimina ninguna relación              |
| **`version_no - 1` como predecesor**                  | ADR-011 §11 **no** hizo estructural que el predecesor sea la versión anterior                                           |
| **Importe firmado en el historial**                   | Exigiría leer `core.effect` —prohibido— o fabricar el signo con un `case`, que es aritmética paralela                   |
| **Vista de `api` para la observación**                | El check de ADR-023 §3.4 la rechaza. Y ampliarlo a «exactamente una vista» debilita el invariante literal               |
| **`observed_balance(uuid)` de un solo identificador** | Una llamada por fila para pintar una página                                                                             |
| **`SECURITY DEFINER` para la observación**            | Atravesaría la RLS sin necesitarlo, y convertiría un id ajeno en oráculo                                                |
| **Historial de las anuladas en `api`**                | ADR-024 las saca de la superficie normal; publicarlas como historial las devuelve por la puerta de atrás                |
| **RPC para el saldo**                                 | Sin parámetros ni control de flujo, no aporta nada y pierde el filtrado de PostgREST                                    |
| **Saldo como columna de `api.personal_scope`**        | Mezcla identidad de provisioning con cifra económica; F6.A dejó lo económico fuera de esa vista a propósito             |
| **`GROUP BY` en el saldo**                            | Un ámbito sin efectos devolvería cero filas, indistinguible de «no hay Modo Personal»                                   |
| **Denormalizar el nombre de la categoría**            | Rompería en silencio «renombrar alcanza al histórico» de ADR-021. Se publica `category_id` y lo resuelve `api.category` |
| **Sin lista blanca de clases**                        | Falsificado: un `internal_transfer` aparece en la lista sin que el producto sepa representarlo                          |
| **Columna «¿ha tenido efectos alguna vez?»**          | Excepción a una guarda sin consumidor real (§10)                                                                        |

## Verificación

`supabase/checks/read-surface.sql`, siete secciones, y la **sección 11** de
`scripts/http-boundary-check.sh`, que es lo único que puede probar que los
importes no se reserializan como número, que un id ajeno responde `200` con lista
vacía y que sin JWT la puerta está cerrada antes de la RLS.

**Falsificado.** Sin la lista blanca, un `internal_transfer` entra en la lista ·
una vista de `api` sobre la observación hace saltar la guarda · el saldo agregado
con `GROUP BY` devuelve cero filas para un ámbito sin efectos · y sin la cláusula
`version_kind`, el check **pasa igual**, que es lo que obligó a decir que esa
cláusula es declarativa y a protegerla con una comprobación textual.

**Y dónde está la barrera de verdad**, retirando las protecciones una a una con
una fila de un usuario y leyendo como otro:

```
predicado de propiedad fuera, invoker puesto ............ 0 filas
ademas invoker fuera EN LA VISTA DE `api` ............... 0 filas
ademas invoker fuera EN `core.current_effect` ........... SE FILTRA
```

Es literalmente el hallazgo de E19: con el eslabón interno `security_invoker`,
una vista externa ejecutada como propietario **no** reintroduce el bypass. La
proyección canónica es el límite de privilegio, y quien lo vigila es el check A2
de `canonical-attribution.sql`.
