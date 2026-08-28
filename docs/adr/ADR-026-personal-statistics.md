# ADR-026 — Estadísticas agregadas del Modo Personal

- **Estado:** Aceptado
- **Fecha:** 2026-08-31

## Contexto

Inicio muestra, para el intervalo que la persona elija —día, mes, año o todo—
tres cifras: **total de ingresos**, **total de gastos** y el **reparto del gasto
por categoría**. Las tres son cifras contables: se ven en pantalla y se usan
para decidir.

[ADR-025](ADR-025-personal-read-surface.md) §1 fijó **cuatro superficies de
lectura, «ni una más»**. Este ADR supersede exactamente esa frase y nada más:
las cuatro siguen existiendo, con su papel intacto, y se añade una quinta.

**Lo que no se reabre:** la unidad de lectura es la operación (ADR-025 §2) ·
`api.personal_effect` conserva su propósito de atribución por dimensión
([ADR-016](ADR-016-economic-attribution.md)) · el saldo se deriva sin caché
([ADR-013](ADR-013-persisted-vs-derived.md) §1) · `core.current_effect` es la
proyección canónica y el límite de privilegio (ADR-013 §9) · los importes cruzan
`api` como texto ([ADR-008](ADR-008-exact-data-boundary.md) §1) · sólo `ingreso`
y `gasto` alimentan estadísticas ([ADR-002](ADR-002-accounting-model.md) §4) ·
`effective_date` es el eje de agrupación por día, mes y año
([ADR-020](ADR-020-version-content-and-time.md) §3).

## Decisión

### 1. Por qué las cuatro superficies de ADR-025 no bastan

Ninguna entrega esas cifras **agregadas**:

| Superficie               | Qué da                      | Por qué no sirve aquí               |
| ------------------------ | --------------------------- | ----------------------------------- |
| `api.personal_effect`    | Fila por efecto             | No agrega, y **no tiene categoría** |
| `api.personal_operation` | Fila por operación          | No agrega                           |
| `api.personal_balance`   | Agrega el ámbito **entero** | No conoce intervalos                |
| `api.observed_balance`   | Fotografías históricas      | Ilustrativa, jamás una derivación   |

Y **la categoría sólo existe en una de ellas**: vive en
`core.movement_detail` y cruza `api` únicamente por
`api.personal_operation.category_id`. `api.personal_effect` no la lleva, y no es
un olvido — su unidad es el efecto y la categoría es un atributo del
**movimiento** (ADR-020 §1).

### 2. Por qué la agregación en cliente se rechaza

**Medido contra el stack real antes de decidir**, no supuesto:

```
PostgREST 16.1 · funciones de agregado DESHABILITADAS
  select=...sum()  ->  PGRST123 · 400
                       «Use of aggregate functions is not allowed»
max_rows = 1000  ->  tope DURO por peticion
Prefer: count=exact  ->  funciona, asi que el truncamiento es DETECTABLE
```

Con eso, un `Año` o un `Todo` por encima de mil operaciones dejaría a la
pantalla **una cifra contable incompleta que no lanza ningún error**. Es el modo
de fallo que `AGENTS.md` §1 y §2 existen para impedir, y detectar el truncamiento
no lo arregla: seguiría sin haber cifra correcta que mostrar.

**Falsificado.** Truncando la agregación a 1000 filas sobre 1200 operaciones, el
total sale **500500** donde la respuesta es **720600**. No falla nada.

Paginar hasta completar el intervalo tampoco vale: sería descargar el historial
para pintar la home, que es justamente lo que ADR-025 evita.

### 3. Por qué no se habilitan los agregados de PostgREST

`db-aggregates-enabled` es un interruptor **global de la Data API**. Aflojarlo
afectaría a **toda relación expuesta**, presente y futura, para resolver un
problema de una pantalla. La propia documentación de PostgREST lo señala como
superficie de denegación de servicio, y desactivarlo por defecto desde la v12 es
una decisión suya, no un descuido.

Una función acotada consigue lo mismo **sin tocar la configuración**: expone
exactamente la agregación que el producto necesita, sobre exactamente los datos
que el actor ya puede leer.

### 4. La quinta superficie, y por qué es derivada y no una caché

```
api.personal_statistics(p_from date default null, p_to date default null)
  -> jsonb
```

> Una **caché** persiste un resultado y por eso puede desincronizarse. Esta
> función **no persiste nada**: es una consulta con nombre. Cada llamada vuelve
> a derivar de `core.current_effect` a través de las vistas, así que **no hay
> nada con qué sincronizarla**.

Es la misma naturaleza que `api.personal_balance`, que también agrega y también
es derivada. **La tercera capa de ADR-013 §1 —cachés— sigue vacía.**

`SECURITY INVOKER`, como `api.observed_balance` y por el mismo motivo: esta
lectura **no debe atravesar la RLS**. `BEGIN ATOMIC`, porque ADR-013 §9 lo exige
para las funciones de lectura económicas — y es lo que hace **comprobable** que
depende de las vistas de `api` y de **ninguna tabla de `core`**.

**Ningún `GRANT` nuevo sobre `core`.** Que no hiciera falta ninguno es la señal
de que esta superficie no pregunta nada que la RLS no hubiera previsto.

### 5. Cómo preserva `api.personal_effect` como semántica estadística

Los totales salen **de ahí**, y la clase la decide `accounting_class`, que ya lo
expresa autoritativamente:

```sql
income_total   = sum(economic_amount) where accounting_class = 'income'
expense_total  = sum(economic_amount) where accounting_class = 'expense'
```

**No se vuelve a decidir qué cuenta como ingreso o como gasto.** No hay una
segunda aritmética que pueda divergir de la primera.

**Y los ajustes quedan fuera sin ninguna cláusula que los excluya:** no producen
dimensión económica, así que `sum(economic_amount)` no los ve. La lista de
admitidos de ADR-002 §4 es aquí **estructural**, no una condición que alguien
pueda olvidar.

Se falsificó de las dos maneras, y **las dos respuestas importan**:

- ampliar el filtro de clase a `in ('expense','adjustment')` **no cambia nada** —
  `economic_amount is not null` sigue dejándolos fuera. La exclusión no depende
  de acertar con la clase;
- sumar desde `balance_amount` en vez de `economic_amount` —la segunda
  aritmética— **sí los cuela**: los ingresos suben a 62150 y los gastos a 12850.
  Ahí es donde muerde la comprobación.

### 6. Cómo incorpora la categoría sin crear una segunda autoridad

El reparto sale de `api.personal_operation`, que es la única superficie con
`category_id` y que ya trae de F6.D la lista blanca de clases, el filtro de
propiedad y la exclusión de anuladas.

**Que las dos superficies describan el mismo conjunto de hechos no es una
esperanza: se leyeron las ocho funciones autoritativas.** Qué escribe cada una en
un ámbito personal:

| Clase                        | En el ámbito personal                      |
| ---------------------------- | ------------------------------------------ |
| `personal_expense`           | saldo − y **económica +**, clase `expense` |
| `personal_income`            | saldo + y **económica +**, clase `income`  |
| `adjustment`                 | saldo solo                                 |
| `external/internal_transfer` | saldo solo                                 |
| **`group_expense`**          | en el personal del pagador, **saldo solo** |
| `debt_settlement`            | deuda, nunca económica personal            |
| `settlement_by_transfer`     | saldo y deuda, nunca económica personal    |

De donde se sigue que la dimensión económica de un ámbito personal la producen
**exactamente** `record_personal_expense` y `record_personal_income` — y que
**seguirá siendo cierto cuando F9 traiga los Grupos**, porque un gasto de Grupo
mueve la caja del pagador sin aportarle economía personal.

> **Y se afirma en vez de confiarse.** El check exige que la suma de las
> categorías sea **idéntica** a `expense_total`, hasta la unidad mínima. Si algún
> día divergen, alguien ha introducido la segunda autoridad que este apartado
> dice que no existe. Falsificado cambiando la magnitud del reparto: salta en el
> acto.

### 7. El intervalo

**`[p_from, p_to]`, cerrado por los dos extremos**, sobre `effective_date`.
Cualquiera de los dos puede ser nulo —«sin límite por ese lado»— y **los dos
nulos son `Todo`**.

Cerrado y no semiabierto, a diferencia de `core.participant_period`, que es
`[valid_from, valid_until)`. No es una incoherencia: aquel modela un **periodo**
de elegibilidad, donde uno empieza justo cuando acaba el anterior; esto filtra
**días de calendario**, y «agosto» significa del 1 al 31 inclusive.

**Ningún concepto de interfaz cruza a SQL.** No hay `day | month | year` dentro
de la función: el cliente traduce su selector a dos fechas y la frontera recibe
el intervalo ya resuelto. Un día concreto es `p_from = p_to`.

`effective_time` **no participa**: es reloj de pared local y sólo ordena dentro
del día (ADR-020 §3).

### 8. La forma de la respuesta, y el caso cero

Un único `jsonb`, para resolver las tres cifras en **una petición**:

```json
{
  "scope_id": "…",
  "currency_definition_id": "…",
  "from": "…",
  "to": "…",
  "income_total": "15000",
  "expense_total": "12150",
  "categories": [{ "category_id": "…", "expense_total": "6000", "operation_count": 3 }]
}
```

- **`NULL`** significa que el actor **no tiene Modo Personal** — la misma señal
  que las cero filas de `api.personal_balance`, que el cliente ya distingue para
  el provisioning.
- **Totales `"0"` y `categories: []`** es un ámbito **sin movimientos** en el
  intervalo. Con eso el caso `expense_total = 0` queda definido: **la lista viene
  vacía**, porque una categoría sólo aparece si hubo gasto y
  `record_personal_expense` rechaza importes ≤ 0. El cliente no divide por cero
  ni inventa porcentaje: pinta su estado vacío.
- **El porcentaje no se calcula en SQL.** `category_expense` y `expense_total`
  son exactos y el cliente obtiene el reparto de su cociente sin perder
  información. Devolver un porcentaje redondeado desde el servidor sería fabricar
  un derivado con menos precisión que sus operandos.
- **El reparto viene completo y ordenado** de mayor a menor, con desempate por
  identificador. El «top 4» es presentación: la tarjeta despliega el resto y lo
  necesitaría igual.
- **Todo importe sale como texto**, también dentro del `jsonb`. El check de
  catálogo cuenta columnas `bigint` y **no ve dentro de un `jsonb`**, así que eso
  se comprueba sobre el valor devuelto y sobre la ruta HTTP.

## Consecuencias

**Aceptadas.**

- **ADR-025 §1 deja de ser cierto en su literalidad**: son cinco superficies, no
  cuatro. Se supersede con este ADR en vez de editar aquél.
- **Una función más que compone dos superficies.** El riesgo es real —dos
  caminos podrían divergir— y por eso la coincidencia se comprueba en vez de
  prometerse.
- **La lista blanca de clases acota el reparto, y `accounting_class` acota los
  totales.** Hoy describen el mismo conjunto; desde F9 hay que volver a mirarlo,
  y el check lo dirá.
- **`api.personal_effect` gana un consumidor** y sigue sin cambiar ni una
  columna.

## Alternativas descartadas

| Alternativa                                            | Por qué no                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **Agregar en el cliente**                              | `max_rows = 1000` y agregados deshabilitados: cifra incompleta que no falla. Falsificado      |
| **Paginar el intervalo entero y sumar**                | Descargar el historial para pintar la home, que es lo que ADR-025 evita                       |
| **Habilitar `db-aggregates-enabled`**                  | Afloja **toda** la Data API para un problema local, y añade superficie de DoS                 |
| **Limitar `Año` y `Todo`**                             | Recorta el producto para acomodar una limitación técnica que tiene solución                   |
| **Añadir `category_id` a `api.personal_effect`**       | Su unidad es el efecto; la categoría es del movimiento (ADR-020 §1). Mezclaría dos preguntas  |
| **Derivar los totales de `api.personal_operation`**    | Sería una **segunda aritmética** sobre lo que `accounting_class` ya expresa autoritativamente |
| **Sumar `balance_amount` en vez de `economic_amount`** | El saldo lo mueve toda clase: cuela los ajustes. Falsificado — 62150 y 12850                  |
| **Materializar las estadísticas**                      | La caché que ADR-013 §1 mantiene vacía, con todas sus preguntas de drift                      |
| **Devolver el porcentaje calculado**                   | Un derivado con menos precisión que sus operandos, cuando el cociente exacto es gratis        |
| **`day \| month \| year` como parámetro**              | Mete un concepto de interfaz en la frontera y duplica la semántica temporal en dos sitios     |
| **Intervalo semiabierto**                              | Pedir agosto exigiría pasar el 1 de septiembre. Ambigüedad innecesaria en un filtro por días  |

## Verificación

`supabase/checks/personal-statistics.sql`, siete secciones, y la **sección 12**
de `scripts/http-boundary-check.sh`, que es lo único que prueba que los importes
no se reserializan como número **dentro del `jsonb`** y que el reparto cuadra con
el total sobre la ruta real.

**La sección §F es la que justifica que esta superficie exista**: 1200
operaciones agregadas con `max_rows` en 1000.

**Falsificado.** Truncando a 1000 filas el total sale 500500 en vez de 720600 ·
usando otra magnitud en el reparto, la suma deja de cuadrar con el total ·
sumando el saldo en vez de la económica, los ajustes contaminan las estadísticas
· con el límite superior exclusivo, un intervalo de un día devuelve cero.
