# ADR-020 — Contenido no monetario y grano temporal de la versión

- **Estado:** Aceptado
- **Fecha:** 2026-08-28

## Contexto

Un movimiento del Modo Personal tiene que significar algo para quien lo lee en
un historial: **un concepto**, **una categoría** y **la hora** a la que ocurrió.
Ninguna de las tres existe hoy.

[ADR-013](ADR-013-persisted-vs-derived.md) §3 enumera el contenido de
`core.operation_version` **de forma cerrada** —predecesor, atribución, instante,
fecha efectiva, un importe original, su definición monetaria y la versión de
reglas económicas— y dice explícitamente qué **no** contiene: ni clase, ni
ámbito, ni método de reparto, ni pagador. El principio detrás de esa lista es
que **la versión guarda lo que toda versión tiene**.

Eso deja una pregunta que no se puede esquivar: **concepto y categoría no los
tiene toda versión.** Un ajuste no tiene concepto —su línea de historial la
deriva el producto, «Saldo ajustado a X», y no la escribe nadie—; una
liquidación tampoco. Y el aviso está escrito en el propio encargo: _no inventes
conceptos como «Adjustment» ni categorías «Other» para satisfacer una
constraint_.

**Lo que ya estaba decidido y esta decisión no reabre:** los hechos son
inmutables y corregir crea una versión nueva ([ADR-011](ADR-011-operation-version-model.md))
· la clase vive solo en `core.operation` y no se duplica (ADR-013 §3) ·
`operation_class` es un vocabulario **abierto** a propósito (ADR-013 §2) · la
canonicalización la hace **solo** el servidor y «no degrada ni reformatea los
valores exactos» (ADR-011 §8) · `core.participant_period` es de grano `date`
**porque su único consumidor es `effective_date`**
([ADR-012](ADR-012-participant-identity.md) §7).

## Decisión

### 1. Dos categorías de contenido, y no una

|               | Dónde vive                          | Por qué                                                               |
| ------------- | ----------------------------------- | --------------------------------------------------------------------- |
| **Universal** | columna de `core.operation_version` | Es un hecho que **toda** versión tiene                                |
| **Por clase** | relación de detalle **por versión** | La presencia declara qué clases lo tienen; la ausencia es estructural |

**`effective_time` es universal. Concepto y categoría son por clase.**

La hora es el **mismo hecho** que `effective_date` con más grano, y va a su
lado. Concepto y categoría son atributos de un **movimiento**, que es una
noción de producto más estrecha que «operación».

### 2. `core.movement_detail`, y el patrón ya existía

```
core.movement_detail (operation_version_id PK, concept, category_id, applies_to)
```

Las tres columnas son `NOT NULL`, y **pueden serlo precisamente porque la fila
solo existe donde el hecho existe**.

**No es un patrón nuevo:** `core.split` es exactamente esto —detalle por
versión, presente solo en las clases que reparten— y su propio comentario lo
dice: _«Método y pagador viven aquí y no en la versión»_. `core.movement_detail`
es el mismo patrón por el mismo motivo.

La consecuencia es la que se buscaba: **ninguna clase inventa nada**. Donde el
hecho existe hay fila y columnas obligatorias; donde no existe, no hay fila.

**Y al estar referenciado a la versión, el versionado sale gratis:** corregir el
concepto o la categoría crea una versión nueva con su propia fila de detalle, y
la anterior queda intacta. Es exactamente la semántica que el producto pide, sin
maquinaria adicional.

### 3. `effective_time`: `time` sin zona, y anulable

**Anulable, y es una decisión.** `NOT NULL` obligaría a las seis clases
restantes a aportar una hora **hoy**, antes de que el producto haya decidido si
un ajuste o una liquidación tienen hora. Eso es fabricar un dato para satisfacer
una restricción.

> **Nulo significa «sin hora registrada», nunca medianoche.** No se hace
> `coalesce` a `'00:00'` en ningún sitio: inventaría un instante que nadie
> declaró y, al ordenar, pondría esos movimientos los primeros del día por
> accidente.

**`time` sin zona.** `timetz` adjunta un desplazamiento UTC, es decir semántica
de zona horaria que el producto **no ha definido**. El par
`(effective_date, effective_time)` es un **reloj de pared local** —«la cena fue
el 28 de agosto a las 21:30»—, que es lo que la persona declara y todo lo que
hace falta para presentar y para ordenar dentro del día. Si algún día se
necesita un instante absoluto —una importación bancaria, F17— se añade aparte y
de forma aditiva.

**`effective_date` no se toca.** Sigue siendo la autoridad de elegibilidad de
participantes y el eje de agrupación por día, mes y año.
`core.participant_period` **sigue en grano `date`**.

**`created_at` no cambia de significado**: es el instante de **registro**, no el
efectivo, y sirve de desempate final cuando dos operaciones comparten fecha y
hora.

### 4. Canonicalización del concepto: recortar y NFC, nada más

```
normalize(btrim(concepto), NFC)
```

**El NFC no es cosmético.** En iOS y macOS un acento puede llegar precompuesto o
como letra más diacrítico combinante: dos secuencias de bytes distintas que se
ven igual y que la persona escribió igual. Sin normalizar, «Café» tecleado en
dos teclados produce dos intenciones distintas y **un reintento legítimo sería
conflicto**.

**Lo que no hace, y es tan importante como lo que hace:**

- **No pliega mayúsculas.** `Mercadona` y `MERCADONA` son intenciones
  **distintas** y se conservan distintas.
- No colapsa espacios interiores, no recorta longitud, no quita signos.

Todo eso sería normalización **semántica**, y decidir por la persona que dos
textos suyos «significan lo mismo» no le corresponde a la frontera.

El valor canonicalizado es **el que se persiste y el que entra en la intención
canónica**, de modo que lo comparado y lo mostrado son el mismo texto. Recortar
y normalizar caben en la primera cláusula de ADR-011 §8 —«materializar los
defaults semánticos»— y no tocan ningún valor exacto de ADR-003.

### 5. Los tres entran en la intención canónica

Concepto, categoría y hora son **intención declarada por la persona**, no
metadatos de transporte. Un reintento con la misma clave y cualquiera de los
tres materialmente distinto es **`IDEMPOTENCY_KEY_REUSED · 409`**, nunca un
replay que devuelva en silencio la primera escritura.

El corolario que hace usable la regla: un reintento con **el mismo concepto y
espacios sobrantes** sí es replay, porque la canonicalización se aplica **antes**
de comparar.

### 6. La guarda de clase, en `sec.persist_version`

Una función de una clase **no puede corregir una operación de otra**. Con
`record_personal_income` el defecto deja de ser teórico: su payload es de
**forma idéntica** al del gasto, así que basta intercambiar el `operation_id`
para dejar `operation_class = personal_expense` con efectos `income`, **sin que
nada lance**.

La comprobación vive en `sec.persist_version`, y la elección tiene tres motivos:

1. **Ya recibe la clase.** Las siete funciones existentes le pasan su propio
   literal, así que no hay que tocar ningún cuerpo ni añadir un parámetro que
   alguien pueda olvidar. **Ninguna función autoritativa puede quedarse fuera**,
   porque las ocho pasan por aquí para existir.
2. **Es su trabajo.** Es quien inserta la versión y mueve el puntero de
   vigencia.
3. **El orden correcto.** Corre **después del CAS**, de modo que provocar el
   error exige haber acertado el `expected_version_id` vigente —un UUID
   inadivinable—. La comprobación **no es un oráculo** con el que averiguar la
   clase de una operación ajena. En `sec.begin_command`, que corre antes de
   autorizar, sí lo habría sido.

Código propio: **`OPERATION_CLASS_MISMATCH · 422`**. No es un fallo de
autorización ni un conflicto de estado: es haber usado la función equivocada.

> **La versión anterior de `sec.persist_version` se suelta explícitamente.**
> `CREATE OR REPLACE` con un parámetro nuevo **no reemplaza**: crea una función
> distinta y conviven las dos. Medido al aplicar la migración. El fallo ruidoso
> —«function … is not unique»— oculta uno silencioso peor: si la resolución de
> sobrecarga hubiera elegido la antigua, las siete funciones existentes habrían
> seguido escribiendo **sin la guarda**. Un check afirma que queda exactamente
> una.

### 7. `command_contract_version`

Cambia el contrato de **`record_personal_expense`**, que pasa a **2**.
`record_personal_income` nace en **1**. **Las otras seis no cambian**: no ganan
campos.

**El servidor no la impone, y no se añade esa imposición.** Se registra en
`core.client_command` y el replay/conflicto se resuelve por `command_type` y
`canonical_intent` —comprobado en el código, no supuesto—. Como los tres campos
nuevos **están en la intención canónica**, la idempotencia ya es correcta sin
mirar el número; imponerlo añadiría un segundo sitio que mantener sincronizado
sin ganar ninguna garantía. Un cliente antiguo falla igual, y con un mensaje
mejor: `falta el campo concept`.

## Consecuencias

**Aceptadas.**

- Una relación más que leer para presentar un movimiento. Es el precio de no
  tener columnas cuya obligación la fila no puede explicar.
- **Que la familia de la categoría coincida con la clase real de la operación no
  es estructural.** La FK compuesta garantiza que la categoría pertenece a la
  familia **declarada**; atar esa familia a `operation_class` exigiría una
  relación que mapee clase de operación a familia contable, y **ADR-013 §2 dejó
  ese vocabulario abierto a propósito**. Cerrarlo para ganar una FK sería pagar
  demasiado. Ese último eslabón lo comprueba la frontera, con un helper único y
  una constante por función, y tiene regresión.
- Los movimientos tienen hora y los ajustes no, así que una lista mixta ordena
  unos por hora y otros por `created_at`. F6.C decidirá si el ajuste declara
  hora; hasta entonces se dice en vez de rellenarse.

**Resueltas.** La obligación que F6.A dejó abierta sobre la corrección cruzada
de clase, y la entrada `clase ingreso sin ruta` de
[`model-coverage.md`](../architecture/model-coverage.md).

## Alternativas descartadas

| Alternativa                                                               | Por qué no                                                                                                                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Columnas anulables en `operation_version`**                             | Su obligación depende de una clase que la fila **no contiene**, y ADR-013 §3 se niega a duplicarla. Quedaría una tabla que no puede explicar sus propios nulos |
| **Meter la clase en la versión** para poder poner un `CHECK` condicionado | Contradice ADR-013 §3, y duplicar la clase es exactamente lo que ese ADR evita                                                                                 |
| **`NOT NULL` en `effective_time`**                                        | Obliga a seis clases a inventarse una hora antes de que el producto decida si la tienen                                                                        |
| **`timetz`**                                                              | Semántica de zona horaria que el producto no ha definido                                                                                                       |
| **Plegar mayúsculas al canonicalizar**                                    | `Mercadona` y `MERCADONA` son intenciones distintas; unificarlas hace desaparecer una edición real como replay                                                 |
| **Dejar concepto y categoría fuera de la intención canónica**             | Un reintento con otro texto devolvería la primera escritura **en silencio**, que es lo que el contrato prohíbe expresamente                                    |
| **La guarda de clase en `sec.lock_and_cas` con un parámetro nuevo**       | Un parámetro se puede olvidar en una función futura; y con valor por defecto se saltaría en silencio                                                           |
| **La guarda en `sec.begin_command`**                                      | Corre **antes** de autorizar: sería un oráculo de la clase de cualquier operación                                                                              |
| **Imponer `command_contract_version` en el servidor**                     | Segundo sitio que mantener sincronizado sin ganancia: la intención canónica ya cubre la semántica                                                              |

## Verificación

`supabase/checks/movement-anatomy.sql`, secciones **C** (concepto), **E** (hora),
**G** (clase cruzada) y **H** (intención canónica), más la sección **9** de
`scripts/http-boundary-check.sh` por HTTP con JWT real.

**Falsificado.** Con la guarda de clase retirada de `sec.persist_version`, el
writer de ingreso corrige una operación de gasto, el de gasto corrige un
ingreso, y **G7 mide la corrupción resultante**: dos efectos vigentes con clase
contable ajena a la clase de su operación.
