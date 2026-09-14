# F11/ADR-001 — Resolución autoritativa del tipo de cambio

- **Estado:** Aceptado
- **Fecha:** 2026-09-13
- **Identificador anterior:** ninguno integrado. Se redactó en su rama como
  `ADR-032` de la numeración única, identificador que en `main` pertenece a
  [F09/ADR-001](../F09/ADR-001-group-model-and-permissions.md); nunca llegó a
  `main` con ese número y se renumeró **antes de integrar**, como exige la regla
  5 de [`docs/adr/README.md`](../README.md).
- **Alcance:** F11.A — fuente y resolución de tipos de cambio. Fija el contrato
  que F11.B y F11.C implementarán. **No implementa nada** y **no modifica ningún
  ADR aceptado**: completa lo que ellos delegaron expresamente.

## Contexto

Lo que ya estaba **decidido**, y este ADR no reabre:

- [F02/ADR-001](../F02/ADR-001-money-representation.md): el importe original es el
  autoritativo y la conversión es secundaria (§1); el tipo es un decimal exacto,
  corresponde a la **fecha efectiva**, lo resuelve **el servidor** y queda
  **congelado** (§4); se convierte **una vez** y se reparte después en la moneda
  del ámbito, con **un único redondeo** (§5); la identidad monetaria no es el
  código ISO (§3); y el conflicto de moneda base (§7).
- [F03/ADR-012](../F03/ADR-012-frozen-rate-physical-representation.md): el tipo congelado
  es `(rate_coefficient bigint > 0, rate_scale smallint 0..12)`.
- [F03/ADR-010](../F03/ADR-010-persisted-vs-derived.md) §6: qué se congela por conversión,
  y la tabla de correcciones —heredar frente a nueva resolución—.
- [F03/ADR-005](../F03/ADR-005-exact-data-boundary.md) §4: el coeficiente cruza como texto
  y la escala como entero acotado.
- [F07/ADR-001](../F07/ADR-001-offline-command-queue-and-optimistic-projection.md) §11 y
  §14: la taxonomía de respuestas de la cola y el conflicto monetario.

Lo que quedó **expresamente abierto**:
[F03/ADR-006](../F03/ADR-006-authoritative-write-boundary.md) §8 enumera como no decidido
_«que exista un catálogo determinado · proveedor · granularidad · regla concreta
de selección · qué ocurre si no hay tipo exacto para la fecha»_, y añade que
describirlo como resuelto _«sería inventarlo»_. F03/ADR-010 §6 deja fuera lo mismo.

**Estado medido del repositorio** (commit `6a5746f`):

- Las ocho funciones `api.record_*` llaman a `sec.assert_no_conversion`, que
  responde `CURRENCY_CONVERSION_UNSUPPORTED · 422` ante cualquier moneda
  distinta de la base de un ámbito alcanzado.
- `core.frozen_conversion` existe con sus restricciones y **sin ruta de
  escritura**: el `INSERT` del writer está revocado.
- `core.currency_definition` tiene veinte definiciones: EUR, USD, GBP, CHF, JPY,
  CAD, AUD, NZD, SEK, NOK, DKK, PLN, CZK, HUF, RON, MXN, BRL, ARS, COP y CLP.
- `convert()` (`src/domain/money/convert.ts`) aplica un único redondeo _half
  away from zero_. `conversion.json` y `rounding.json` se inyectan en los checks
  SQL, pero **ningún check los consume** y **no existe conversión en SQL**.
- `src/domain/money/money.ts` **no acota** los importes al rango de `bigint`.
- `effective_date` es `date` y `effective_time` es `time` sin zona: un **reloj
  de pared local** ([F06/ADR-002](../F06/ADR-002-version-content-and-time.md) §3).
- `src/lib/offline/response.ts` clasifica **por estado HTTP primero**:
  - 408, 429 y 5xx → `retryable` con la misma clave;
  - 400, 409 o 422 con un código que no reconoce → `rejected`, terminal;
  - `CURRENCY_CONVERSION_UNSUPPORTED` → `conflict`.

**Investigación de fuentes** (consultada el 2026-09-13; detalle y URL en
[Evidencia](#evidencia)): BCE, Frankfurter, Open Exchange Rates y
ExchangeRate.host, más las condiciones de los bancos emisores de ARS, COP y CLP.

**Decisiones de producto de F11.A**, que este ADR formaliza:

1. **Para una operación con fecha efectiva X se usa el último tipo definitivo
   disponible al comenzar el día X**, y la conversión se hace en ese momento. Ni
   la hora de creación ni el momento de sincronizar cambian el tipo, y **nunca**
   se usa retrospectivamente una publicación posterior. Fines de semana y cierres
   de TARGET siguen la misma regla.
2. Admiten moneda extranjera en F11: **gasto personal, ingreso personal y gasto
   de grupo**, este último cuando el flujo de Grupos esté integrado. Quedan fuera
   las transferencias, los ajustes, las liquidaciones entre monedas o bases
   distintas y cualquier clase cuya semántica multimoneda no esté definida.
3. **ARS, COP y CLP permanecen en el catálogo**, y Nomey no se restringe por
   país, ubicación, IP ni nacionalidad. La conversión depende de la cobertura
   real de la fuente **por moneda y par**.
4. **No se introducen manualmente** tipo, escala, fuente ni ningún valor
   equivalente. Las correcciones siguen F03/ADR-010 y un tipo congelado no se
   modifica.

## Decisión

### 1. Qué fija este ADR

Este ADR fija:

- la fuente;
- qué tipo corresponde a cada día, y cuándo queda fijado;
- qué se puede convertir;
- qué resultados produce el resolver;
- cómo se deriva el tipo;
- cómo se distingue una moneda extranjera de una base histórica.

Todo lo demás de F02/ADR-001, F03/ADR-005, F03/ADR-010, F03/ADR-012, F07/ADR-001 y F07/ADR-002 sigue
vigente sin cambios.

### 2. La fecha efectiva, y lo que no la determina

**La fecha efectiva es `operation_version.effective_date`**: la fecha de
calendario que la persona declara, local y sin zona (F06/ADR-002 §3).
**`effective_time` no interviene**: la hora a la que se hizo la operación no
cambia el tipo.

> **El tipo resuelto depende exclusivamente de** la fuente, la definición
> monetaria origen, la definición destino y **el tipo del día X** (§3.3), que se
> fija una sola vez para cada fecha.
>
> **Nunca** depende del instante de creación, sincronización, escritura o
> ingesta, de cuándo Nomey descubrió el dato, de la zona del dispositivo, ni del
> país, la región o la ubicación de nadie.

Una operación con fecha efectiva 10/09 que se sincroniza el 12/09 **se resuelve
con el tipo del día 10/09**, el mismo que habría obtenido si se hubiera
sincronizado en el acto. Si al resolver ese tipo **todavía no está fijado**, no
se usa ningún otro: el resultado es _todavía no disponible_ (§6) y se reintenta.

### 3. La fuente, y qué tipo corresponde a cada día

#### 3.1 Fuente

**Los tipos de referencia del euro del Banco Central Europeo** (_euro foreign
exchange reference rates_). De fuente oficial:

- Se fijan hacia las **14:10 CET** y se publican hacia las **16:00 CET**, **sólo
  los días en que opera TARGET2**; no hay publicación los sábados, domingos ni
  días de cierre de TARGET. El BCE tiene su sede en Fráncfort y expresa esos
  horarios en su hora local (CET/CEST).
- Cada publicación lleva una **fecha de referencia** —el día en que se fija y se
  publica— y cotiza **EUR → divisa** como cadena decimal. Medido:
  `USD 1.1592`, `JPY 178.56`, `GBP 0.85815`. El BCE indica _«in most cases five
  significant digits»_.
- **Es un único tipo oficial por fecha de referencia**: la fuente no publica
  tipos provisionales ni intradía.
- **Puede enmendarse o republicarse hasta que se publica el tipo del día hábil
  siguiente**, y nunca después: _«Under no circumstances will the ECB amend or
  republish any euro foreign exchange reference rate after the publication of the
  rate for the same currency on the following business day»_.
- Uso libre **citando al BCE como fuente**.

#### 3.2 El tipo del día X: el disponible al comenzar X

> **El tipo del día X son los tipos de la publicación del BCE con la fecha de
> referencia más reciente estrictamente anterior a X**, con el valor que tenían
> al comenzar el día X.

**Qué es «comenzar el día X»: las 00:00 de X en hora de Fráncfort (CET/CEST),
la de la fuente.** La fecha efectiva no tiene zona (F06/ADR-002 §3), así que el
comienzo del día tiene que tomarla de algún sitio, y la de la fuente es la
correcta:

- **es la zona en la que la fuente define sus fechas**: publica cada tipo el
  mismo día de su fecha de referencia, hacia las 16:00 CET;
- **es la misma para todo el mundo**. La zona del dispositivo haría que dos
  personas con la misma fecha efectiva —dos miembros de un Grupo— recibieran
  tipos distintos según dónde estuvieran, y ese dato ni siquiera se persiste;
- **una zona más adelantada contradice la decisión.** A las 00:00 de X en UTC+14
  todavía no se ha publicado el tipo del día X − 1 en Fráncfort, así que toda
  operación usaría el de X − 2, y la del 11/09 ya no usaría lo publicado el
  10/09.

**Por qué «estrictamente anterior a X» es exactamente «el disponible al comenzar
X».** El BCE publica cada fecha de referencia durante ese mismo día. A las 00:00
de X en Fráncfort **ya existen todas** las publicaciones con fecha anterior a X y
**no existe ninguna** con fecha X o posterior. Por eso la regla no usa jamás una
publicación posterior a la operación ni una del propio día X, aunque esta última
se publique horas después.

**Fines de semana y cierres de TARGET siguen la misma regla sin excepciones**: al
comenzar el día, el último tipo disponible es el de la última publicación.

| Fecha efectiva X           | Tipo que se usa                      |
| -------------------------- | ------------------------------------ |
| Jueves 2026-09-10          | Publicación del miércoles 2026-09-09 |
| Viernes 2026-09-11         | Publicación del jueves 2026-09-10    |
| Sábado 2026-09-12          | Publicación del viernes 2026-09-11   |
| Domingo 2026-09-13         | Publicación del viernes 2026-09-11   |
| Lunes 2026-09-14           | Publicación del viernes 2026-09-11   |
| Jueves 2026-01-01 (TARGET) | Publicación del miércoles 2025-12-31 |
| Viernes 2026-01-02         | Publicación del miércoles 2025-12-31 |
| Sábado 2026-01-03          | Publicación del viernes 2026-01-02   |

Medido sobre los datos del BCE: no existe publicación con fecha 2026-09-12,
2026-09-13 ni 2026-01-01, y sí con 2026-01-02.

#### 3.3 El tipo del día queda fijado una sola vez

> **Para cada día de calendario X, Nomey fija una única vez el tipo del día X**:
> la publicación de §3.2 y sus valores, **tal como constan en la primera
> observación completa de la fuente hecha después de las 00:00 de X en hora de
> Fráncfort. Una vez fijado, no cambia.**

Esto es lo que hace que el tipo sea independiente del momento de sincronizar,
también en los casos raros en que la fuente se mueve:

- **Enmienda o republicación.** El BCE puede corregir el tipo de una fecha de
  referencia hasta la publicación del día hábil siguiente (§3.1), es decir,
  **después** de comenzado el día X. Si el tipo del día se leyera en cada
  resolución, dos operaciones con la misma fecha efectiva obtendrían tipos
  distintos según se escribieran antes o después de la enmienda. Una enmienda
  posterior a la fijación **se registra como historia y no altera el tipo del día
  ya fijado** ni ninguna conversión.
- **Publicación con retraso.** Si una publicación llega después de las 00:00 del
  día siguiente, no estaba disponible al comenzar ese día y no forma parte de su
  tipo, aunque su fecha de referencia sea anterior.
- **Días sin observación.** Si la ingesta no funciona durante unos días, el tipo
  de esos días se fija con la primera observación completa posterior y con la
  misma regla, que sólo admite publicaciones con fecha anterior a cada día. No se
  inventa ni se adelanta nada.
- **Días anteriores al catálogo.** Se fijan con la carga inicial desde el
  histórico oficial y con la misma regla.

**«Definitivo»**, en este ADR, es **el tipo oficial de una fecha de referencia
tal como queda en el tipo del día fijado**. En el caso raro de que el BCE
corrigiera un error después de la fijación, Nomey conserva el tipo que estaba
disponible al comenzar el día. Corregirlo sería una operación explícita y
trazable de Nomey (F02/ADR-001 §3), fuera de F11.

La observación que fija el día **no tiene por qué coincidir exactamente con las
00:00**: basta con que sea la primera completa posterior. Una enmienda publicada
entre las 00:00 y esa observación formaría parte del tipo del día; es un margen
de minutos en un caso que el BCE resuelve en su horario, y **no introduce
dependencia del momento de sincronizar**, porque el tipo del día se fija una sola
vez.

#### 3.4 Disponibilidad y completitud

**Una operación con fecha efectiva X sólo se resuelve si el tipo del día X ya está
fijado.** Si no lo está, el resultado es **_todavía no disponible_** (§6). **Nunca
se usa un tipo más antiguo como sustituto**, y esperar no cambia qué tipo se
obtendrá: sólo cuándo.

Esto sólo ocurre si se resuelve una operación antes de que su día haya empezado
en Fráncfort y la fijación exista:

- una operación con fecha de hoy, registrada en una zona adelantada respecto a
  Fráncfort durante las primeras horas de su día;
- una operación con fecha efectiva futura;
- un retraso o un fallo de la ingesta.

> **La completitud del catálogo es normativa.** Fijar el tipo del día X exige
> una observación **completa** de la fuente: un hueco del catálogo no puede
> confundirse con un día sin publicación, porque congelaría para siempre, y en
> silencio, un tipo antiguo.

Cómo se garantiza la completitud, cómo se registra la fijación y con qué
frecuencia se observa la fuente —al menos una vez al comenzar cada día natural en
Fráncfort— lo decide F11.B. **Que se garantice no es opcional.**

#### 3.5 Una publicación por conversión

**Todos los tipos que intervienen en una conversión salen del mismo tipo del día
X.** No se mezclan fechas ni fuentes.

#### 3.6 Otras fuentes

**Añadir o sustituir una fuente exige un ADR nuevo** que documente para ella lo
mismo que §3.1–§3.4 —qué tipo corresponde a cada día, cuándo queda fijado y qué
cubre— y que respete §2 y §4–§10. **Nunca se compone** un tipo mezclando varias
fuentes.

### 4. Qué operaciones admiten moneda extranjera en F11

| Clase                    | Moneda extranjera en F11          |
| ------------------------ | --------------------------------- |
| `personal_expense`       | **Sí**                            |
| `personal_income`        | **Sí**                            |
| `group_expense`          | **Sí**, al integrarse Grupos (F9) |
| `adjustment`             | No                                |
| `external_transfer`      | No                                |
| `internal_transfer`      | No                                |
| `debt_settlement`        | No                                |
| `settlement_by_transfer` | No                                |

**Una clase sin moneda extranjera en F11**, si recibe una moneda distinta de la
base de algún ámbito alcanzado, sigue respondiendo
**`CURRENCY_CONVERSION_UNSUPPORTED · 422`**, con el significado que ese código
tiene hoy. No quiere decir que esas clases no puedan admitir multimoneda en el
futuro, sino que **su semántica multimoneda no está definida** y queda fuera de
F11.

Un gasto de grupo convierte hacia **cada ámbito alcanzado que lo requiera**
(F03/ADR-010 §6): el del Grupo y, si su base difiere, el Modo Personal del pagador.
**Todas las conversiones de una operación salen del mismo tipo del día X.**

### 5. Cobertura: por definición monetaria y par, nunca por país

#### 5.1 Catálogo monetario y cobertura FX son cosas distintas

**`core.currency_definition` no cambia.** ARS, COP y CLP siguen siendo
definiciones monetarias válidas: pueden ser la base de un ámbito y usarse para
registrar en esa misma base.

**La cobertura FX** es un atributo de la fuente, no del catálogo:

- **Cobertura de la definición.** Una definición monetaria está cubierta por una
  fuente **sólo a través de una correspondencia explícita definición → código
  de la fuente**, versionada y bajo control de Nomey. Nunca por igualdad de
  códigos en ejecución, porque la identidad monetaria no es el código ISO
  (F02/ADR-001 §3, F03/ADR-001). El EUR es el pivote del BCE.
- **Cobertura en la fecha.** Una definición cubierta **sólo lo está en X si
  aparece en el tipo del día X**. El BCE suspendió el rublo tras el 01-03-2022 y
  retiró el lev búlgaro desde el 02-01-2026; aplicarles «su último tipo» usaría
  cifras de hace años.
- **Par.** Origen → destino se puede convertir en X **sólo si las dos
  definiciones están cubiertas en X**, en cualquier sentido.

**Medido el 2026-09-13:** el BCE publica 29 divisas más el euro. **Cubre 17 de
las 20 definiciones de Nomey y no cubre ARS, COP ni CLP.** Una operación que
requiera convertir desde o hacia una de ellas recibe
**`FX_CURRENCY_NOT_COVERED`** (§6).

#### 5.2 Nunca por país

> **Queda prohibido condicionar la conversión al país, la región, la IP, la
> ubicación, la nacionalidad, el idioma o la Region del dispositivo.** La
> recomendación de moneda por Region de F06/ADR-001 §7 es un asunto distinto y no
> cambia.

| Caso                                           | Resultado                                       |
| ---------------------------------------------- | ----------------------------------------------- |
| Persona en Argentina · gasto en USD · base EUR | **Se convierte**: USD y EUR están cubiertas     |
| Persona en España · gasto en ARS · base EUR    | **No se convierte**: ARS no está cubierta       |
| Base ARS · gasto en EUR                        | **No se convierte**: el par EUR → ARS no existe |

### 6. Resultados del resolver, y cómo se distinguen

| Resultado                 | Cuándo                                                           | ¿Puede cambiar con el tiempo?              | Código · estado                         | Clase en el cliente vigente (medido) |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------ | --------------------------------------- | ------------------------------------ |
| **Resuelto**              | El tipo del día X está fijado y el par está cubierto en él       | No                                         | —                                       | —                                    |
| **Moneda no cubierta**    | Sin correspondencia con la fuente, o ausente del tipo del día X  | **No**: es un hecho de la fuente           | **`FX_CURRENCY_NOT_COVERED` · 422**     | `rejected`, terminal                 |
| **Todavía no disponible** | El tipo del día X todavía no está fijado (§3.4)                  | **Sí**: se resuelve cuando se fija, con él | **`FX_RATE_NOT_YET_AVAILABLE` · 503**   | `retryable`, **misma clave**         |
| **Conflicto de base**     | La base asumida al capturar no es la vigente (§10)               | No, para esa intención                     | `CURRENCY_CONVERSION_UNSUPPORTED` · 422 | `conflict`                           |
| **Clase sin FX**          | Moneda distinta de la base en una clase de §4 que no admite FX   | No                                         | `CURRENCY_CONVERSION_UNSUPPORTED` · 422 | `conflict`                           |
| **Fuera de rango**        | El coeficiente o el importe convertido no caben en `bigint` (§7) | No                                         | **`FX_CONVERSION_OUT_OF_RANGE` · 422**  | `rejected`, terminal                 |

**Orden de evaluación**, igual para todas las clases:

1. Replay e idempotencia, antes que nada (F03/ADR-008 §13).
2. Forma del payload: un tipo aportado es `PAYLOAD_INVALID` (§8).
3. Clase sin moneda extranjera (§4).
4. Conflicto de base (§10).
5. Cobertura de la definición (§5.1).
6. Tipo del día X fijado (§3.4).
7. Cobertura en la fecha (§5.1).
8. Derivación y rango (§7).

La cobertura de la definición se comprueba **antes** que la disponibilidad: un
gasto en ARS no espera a nada, se rechaza de inmediato.

**Por qué _todavía no disponible_ es 503 y no un 4xx.** Es un problema de
**disponibilidad del dato**, y F07/ADR-001 §11 ya incluye los 5xx en su fila
«Transporte y disponibilidad», que lleva a `retryable` con la misma clave. Con
400, 409 o 422, el cliente vigente lo clasificaría como **rechazo terminal**
(medido en `response.ts`) y convertiría una espera de horas en una incidencia.
Además, es la fila conservadora que F07/ADR-001 §11 prescribe: no afirma que la
operación no haya producido efectos, aunque aquí sí podría demostrarse.

**Reintentar con la misma clave es seguro.** El rechazo aborta la transacción y
la reclamación del comando está dentro de ella, así que la clave no se quema
—medido en F8.A4 con `CATEGORY_NOT_USABLE`—. **Falta medir** que PostgREST
entregue el 503 con su código por la ruta real; es una verificación obligatoria
de F11.B.

**`CURRENCY_CONVERSION_UNSUPPORTED` cubre dos causas**, el conflicto de base y
la clase sin FX. En las dos la operación no produce efectos y va a revisión, y
conservar el código deja intactos F07/ADR-001 §14, F07/ADR-002 y el cliente vigente. Si
F11.C necesita distinguirlas en la interfaz, puede añadir un discriminador **en
el cuerpo** del error, **sin cambiar el código ni el estado**.

### 7. Derivación y representación del tipo

**Salida:** el tipo en orientación **origen → destino**, como `(coefficient,
scale)` de F03/ADR-012, con **escala canónica 12**, para que un mismo tipo tenga una
única forma congelada.

**Derivación.** Sean `q_C` los tipos del día X como EUR → C, leídos **desde su
texto exacto**, y `q_EUR = 1`:

```
tipo(O → D) = q_D / q_O
```

El resultado se calcula como **un único cociente racional exacto** y se redondea
**una sola vez** a escala 12, _half away from zero_ sobre la magnitud, con la
misma regla que `src/domain/money/rounding.ts`. Directo, inverso y cruzado son
la misma fórmula.

**Nunca:**

- invertir y después multiplicar, porque serían dos redondeos;
- partir de tipos ya rebasados o invertidos por un intermediario. Medido:
  Frankfurter entrega COP → USD como `0.00033`, un error de ≈ 1,4 %;
- pasar un tipo por un número JSON o por `number`.

**Por qué no contradice el «único redondeo» de F02/ADR-001 §5.** Ese redondeo es el
de **convertir un importe dado un tipo**. El tipo congelado **es** el decimal de
escala 12, y **derivarlo forma parte de resolver**, no es un redondeo intermedio
del importe. La conversión mantiene su único redondeo.

**La contrapartida, medida.** Comparado con dividir exactamente con los tipos
publicados, el tipo derivado a escala 12 da el mismo resultado entre 1 y 200 000
unidades mínimas, y **difiere en 1 unidad mínima en importes grandes**. La
primera discrepancia aparece con 22 550 157,85 USD en USD → EUR y con
259 001 813 JPY en JPY → EUR. Esa incertidumbre es entre **seis y ocho órdenes
de magnitud menor** que la precisión de la propia fuente, que publica con cinco
cifras significativas. **Se acepta** y se fija con vectores.

**Límites:**

- Si el coeficiente no cabe en `bigint` a escala 12 (un tipo mayor que
  ≈ 9,2·10⁶), el resultado es **`FX_CONVERSION_OUT_OF_RANGE`**. Hoy no ocurre con
  ninguna moneda cubierta: el tipo más alto es el de HUF, ≈ 364.
- Si el importe convertido no cabe en `bigint`, también es
  **`FX_CONVERSION_OUT_OF_RANGE`**, en las dos implementaciones. En SQL, el
  producto intermedio `minor × coeficiente × 10^escala` puede llegar a ≈ 10³⁷:
  se calcula en `numeric`, nunca en `bigint`.

**Paridad.** La derivación y la conversión se fijan en `tests/vectors/`, y las
consumen **tanto** `src/domain/` **como** los checks SQL (F01/ADR-001 §7, F03/ADR-006
§1).

### 8. No existe tipo manual, y qué significa corregir

**Ningún payload** —ni de alta ni de corrección, de ninguna clase— **admite
tipo, coeficiente, escala, fecha del tipo, fuente ni ningún valor equivalente**.
Si llegan, la respuesta es `PAYLOAD_INVALID · 400`; la frontera ya rechaza hoy
los campos desconocidos. **No se crea ningún campo ni ruta alternativa** que se
salte el resolver.

Un tipo en caché en el cliente **sólo sirve para previsualizar** (F02/ADR-001 §4), y
nunca se envía.

**Corregir sigue la tabla de F03/ADR-010 §6**, sin cambios:

- **Heredar** es reutilizar literalmente el `(coefficient, scale)` congelado de
  la versión anterior. **No se vuelve a resolver.**
- **Nueva resolución** —cambio de fecha efectiva, de definición o de ámbito— usa
  **el mismo resolver y las mismas reglas**. Como el tipo de cada día está fijado,
  las mismas entradas dan siempre el mismo tipo.
- Si la nueva resolución no es posible, la corrección **recibe el resultado de
  §6** y no se aplica. Las correcciones no se encolan (F07/ADR-001 §4): el resultado
  lo recibe directamente quien corrige.

F02/ADR-001 §4 admite corregir _«el propio tipo»_ como dato. **En F11, ningún camino
del cliente convierte el tipo en el dato corregido.** Corregir un error de Nomey
en el catálogo, en la fijación de un día o en la correspondencia de códigos es
una operación **explícita y trazable** (F02/ADR-001 §3) que queda fuera de F11. Esto
**restringe los caminos disponibles** y no contradice F02/ADR-001.

### 9. Congelación

**Una conversión congelada no se modifica jamás.** No la tocan ni una
republicación de la fuente, ni una corrección del catálogo, ni un cambio en la
correspondencia de códigos (F02/ADR-001 §4, F03/ADR-010 §6, invariante 22 de
`data-model.md`).

- `resolved_for_date` sigue siendo la fecha efectiva X de la versión, **por la FK
  existente**, aunque la publicación usada tenga una fecha de referencia
  anterior.
- **La fecha de referencia de la publicación usada, la fuente y el método** se
  persisten **como procedencia no autoritativa**, junto a la conversión y **sin
  alterar las columnas de `core.frozen_conversion`** (F03/ADR-012). Dónde y cómo, lo
  decide F11.B. La procedencia sirve para auditar y **nunca para calcular**.
- El catálogo conserva enmiendas y republicaciones como historia, sin tocar un
  tipo del día ya fijado.

### 10. Moneda extranjera frente a base histórica

**El problema.** Hoy es el `422` de `sec.assert_no_conversion` lo que convierte
en conflicto una operación capturada bajo la base anterior (F07/ADR-001 §14). Con la
conversión habilitada, una operación capturada en EUR con base EUR que llega
después de cambiar la base a USD **sería indistinguible** de un gasto deliberado
en EUR dentro de un ámbito en USD, y **se convertiría en silencio**, contra
F02/ADR-001 §7.

> **`currency_definition_id ≠ base vigente` NO significa «moneda extranjera».**

**La decisión.** El payload de las clases de §4 que admiten moneda extranjera
lleva **`expected_base_currency_definition_id`**: **la base del ámbito de
captura en el momento de capturar**.

- **Sale de la fotografía monetaria** que la cola ya conserva, `MoneySnapshot` en
  `src/lib/offline/queue-entry.ts`, documentada como la definición monetaria del
  ámbito en el momento de capturar.
- **Se fija al encolar**, forma parte del payload congelado y de la **intención
  canónica**, y **no se recalcula al enviar**.

El servidor la compara **antes de resolver** (§6, paso 4):

| `expected_base` frente a la base vigente del ámbito de captura | Qué hace el servidor                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Distinta**                                                   | `CURRENCY_CONVERSION_UNSUPPORTED · 422`: **conflicto**, sin conversión y sin efectos             |
| **Igual**                                                      | `currency_definition_id` **es intención**: si coincide con la base no convierte; si no, resuelve |

**Si el campo falta, se interpreta como `expected_base = currency_definition_id`.**
Tres razones:

- **Es exacto para todo cliente anterior a F11**, que sólo captura en la base.
- **Conserva la forma canónica** de los comandos ya enviados, así que su replay
  no acaba en `IDEMPOTENCY_KEY_REUSED`.
- **Falla del lado seguro**: omitir el campo sólo puede producir un conflicto,
  **nunca una conversión silenciosa**.

**Alcance del campo:**

- **Se refiere sólo al ámbito de captura.** Los ámbitos derivados, como el
  personal del pagador en un gasto de grupo, no tienen base esperada: quien
  registra no la conoce ni la controla, y esa conversión no reinterpreta ninguna
  intención.
- **No se exige en correcciones.** La base es inmutable en cuanto existe un
  efecto (F01/ADR-001 §8, FK compuesta), y una corrección presupone que existe, así
  que el desajuste es imposible.
- **Las clases sin moneda extranjera en F11 no lo admiten.**
- **Si la base cambia EUR → USD → EUR antes de que se vacíe la cola**, la
  operación capturada con EUR entra sin conflicto, porque su base asumida es la
  vigente y no se reinterpreta nada. Es una lectura deliberada de F02/ADR-001 §7,
  que protege contra la reinterpretación, no contra la historia de cambios de un
  ámbito sin efectos.

**Cambiar la intención canónica** de `personal_expense` y `personal_income` se
acepta por la misma razón que en F06/ADR-009: **no hay producción**.

### 11. Relación con Grupos (F9)

**Este ADR no modifica ningún contrato de Grupos.** Deja fijado lo que su
integración con F11 necesitará:

- **El payload y la intención canónica de `record_group_expense` deberán poder
  transportar `expected_base_currency_definition_id`** del ámbito del Grupo, con
  las reglas de §10. Si ese contrato se publica antes sin el campo, añadirlo
  después **no rompe los comandos ya enviados**, gracias a cómo se interpreta su
  ausencia; aun así, conviene que nazca con él.
- **Cambiar la base de un Grupo**, que F02/ADR-001 §7 permite a su creador, produce
  el mismo conflicto que en el Modo Personal.
- **Todos los miembros obtienen el mismo tipo para la misma fecha efectiva**,
  estén donde estén (§3.2).
- **La conversión hacia el Modo Personal del pagador** sigue §3–§7. **Si esa base
  no está cubierta en X, se rechaza el gasto de grupo entero** con
  `FX_CURRENCY_NOT_COVERED`, porque los efectos de una operación son atómicos.
  Hoy ya ocurre algo equivalente: `sec.assert_no_conversion` rechaza cualquier
  pagador cuya base personal difiera de la moneda. Validarlo con producto forma
  parte de la integración con F9.

### 12. Lo que no decide, y dónde queda

| Tema                                                                                                                                                    | Dónde |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Tablas del catálogo, de la fijación del tipo del día y de la procedencia, con su RLS y sus grants                                                       | F11.B |
| Mecanismo, rol, planificación y entorno de la ingesta: observación al comenzar cada día natural en Fráncfort, carga histórica y garantía de completitud | F11.B |
| Correspondencia versionada definición → código de la fuente                                                                                             | F11.B |
| Resolver y derivación en SQL, retirada de `sec.assert_no_conversion` para las clases de §4, escritura de `core.frozen_conversion`                       | F11.B |
| Vectores de derivación y conversión, consumidos por el dominio y por SQL con UUID fijos (F03/ADR-001 §4)                                                | F11.B |
| Medición por HTTP de los códigos y estados de §6                                                                                                        | F11.B |
| Cómo espera la cola una entrada _todavía no disponible_, y si merece una clase propia (sucesor de F07/ADR-001 §11)                                      | F11.C |
| Proyección optimista de entradas en moneda extranjera                                                                                                   | F11.C |
| Superficies de lectura: moneda del importe original y magnitud convertida                                                                               | F11.C |
| Estadísticas por categoría sobre la **magnitud económica convertida**, preservando el invariante de F06/ADR-008 §6                                      | F11.C |
| Presentación: original como principal y convertido como secundario, atribución al BCE, previsualización de correcciones (F03/ADR-010 §6)                | F11.C |
| Mostrar la derivación al revisar un conflicto (F02/ADR-001 §7), hoy vacía por F07/ADR-002 §3                                                            | F11.C |
| Integración del gasto de grupo con F9 y cierre de los criterios de F11                                                                                  | F11.D |

## Alternativas consideradas

**Consultar al proveedor al escribir.** El writer llamaría a Internet dentro de
la transacción. **Descartada** por tres razones:

- la escritura dependería de un tercero —latencia, caídas, cuotas— mientras
  mantiene los locks de ámbito;
- una revisión del proveedor cambiaría el tipo según el momento de escribir,
  contra §2;
- va contra el espíritu de F02/ADR-001 §3, que pone la metadata monetaria bajo
  control de Nomey.

**Frankfurter como fuente.** Es gratuita, no pide clave y cubre las 20 monedas
de Nomey. **Descartada como fuente autoritativa:**

- su tipo por defecto **mezcla** varios proveedores con un filtro de atípicos e
  incluye observaciones de otras fechas (medido: una del 28-08 dentro del tipo
  del 11-09);
- **redondea al rebasar**: COP → USD `0.00033`, ≈ 1,4 % de error;
- las condiciones de sus datos remiten a cada proveedor, y **el BCRA prohíbe el
  uso comercial sin autorización**.

Sigue siendo útil para medir.

**Open Exchange Rates.** Cubre las 20 monedas. **Descartada:** no revela sus
fuentes, su plan gratuito no admite uso comercial y **no está confirmado que
permita almacenar tipos indefinidamente**, algo imprescindible para congelarlos.

**ExchangeRate.host.** **Descartada:** sus condiciones prohíben _«use, store, or
access any … Data & Services … after the termination»_, lo que es incompatible
con congelar tipos.

**El tipo publicado con fecha X, esperando a que sea definitivo.** Usaría la
publicación del propio día X en cuanto se publica la del día hábil siguiente.
**Descartada por decisión de producto:** ninguna operación en moneda extranjera
podría registrarse hasta el día hábil siguiente, o varios días después si hay
fin de semana o cierre de TARGET por medio.

**El tipo publicado con fecha X en cuanto aparece.** **Descartada:** antes de las
16:00 CET de X no existe, así que la operación esperaría; y una enmienda
posterior haría depender el tipo de cuándo se escribió, contra §2.

**Leer el tipo del día en cada resolución, sin fijarlo.** **Descartada:** una
enmienda o una publicación con retraso posteriores al comienzo del día darían
tipos distintos a dos operaciones con la misma fecha efectiva, según cuándo se
resolvieran.

**Comenzar el día en la zona del dispositivo.** **Descartada:** el tipo
dependería de dónde está la persona, dos miembros de un Grupo obtendrían tipos
distintos para la misma fecha, y la zona no se persiste.

**Comenzar el día en UTC.** Daría la misma publicación que Fráncfort con el
horario normal del BCE. **Descartada:** la fijación ocurriría una o dos horas más
tarde sin ninguna ventaja, y se apartaría de la zona en la que la fuente define
sus fechas.

**Comenzar el día en la zona más adelantada (UTC+14).** Evitaría cualquier espera
en cualquier zona. **Descartada:** a esa hora todavía no se ha publicado el tipo
del día anterior en Fráncfort, así que toda operación usaría el de X − 2, contra
la decisión de producto.

**Usar la publicación siguiente** en los días sin publicación. **Descartada:**
usaría retrospectivamente una publicación posterior a la operación.

**Rechazar los días sin publicación.** **Descartada:** impediría registrar en
moneda extranjera cualquier gasto de fin de semana o festivo.

**Retirar ARS, COP y CLP del catálogo, o restringir por país.** Descartadas por
decisión de producto: Nomey se usa en cualquier país, y la cobertura es un hecho
de la fuente, no de la persona.

**Tipo introducido manualmente.** Descartado por decisión de producto y por
F02/ADR-001 (alternativa I): metería en un hecho contable un dato decidido por un
cliente no confiable.

**Deducir la moneda extranjera de `currency_definition_id ≠ base vigente`.**
**Descartada:** convertiría en silencio la operación de F07/ADR-001 §14.

**Un contador de revisión de la base del ámbito** en lugar de la base esperada.
Detectaría también el caso EUR → USD → EUR. **Descartada:** ese caso no
reinterpreta nada, y el contador habría que publicarlo en lectura y mantenerlo en
el cliente sin ganar protección adicional.

**Congelar el tipo publicado con su dirección, o sus tramos.** Evitaría la
diferencia de 1 unidad mínima de §7. **Descartada:** exige un ADR sucesor de
F03/ADR-012 y una migración para ganar fidelidad sobre un dato que en origen sólo
tiene cinco cifras significativas.

**Un código nuevo para el conflicto de base.** Sería más preciso que reutilizar
`CURRENCY_CONVERSION_UNSUPPORTED`. **Descartada:** los clientes ya instalados
sólo reconocen ese código como `conflict`. Un código nuevo les llegaría como
`rejected`, cuya forma ordinaria ofrece repetir el gasto con un importe escrito
en otra moneda.

## Consecuencias

### A favor

- **La conversión es inmediata**: en cuanto el día X ha comenzado en Fráncfort,
  una operación con fecha X se resuelve al registrarla, sin esperar a ninguna
  publicación futura.
- **El tipo de una operación es reproducible** a partir de su fecha efectiva:
  no depende de la hora de creación, de la conectividad ni del momento de
  sincronizar, y todos los miembros de un Grupo obtienen el mismo.
- **Nunca se usa información posterior a la operación.**
- **La escritura no depende de Internet**: el writer lee un catálogo local dentro
  de su transacción.
- **Los seis resultados se distinguen** por código y estado, y encajan en la
  taxonomía de F07/ADR-001 §11 y en `response.ts` **sin tocar el cliente vigente**.
- **La fuente es oficial y gratuita**, con metodología pública, una regla de
  republicación explícita y uso libre citando la fuente.
- **Nomey funciona igual en cualquier país**, y las monedas no cubiertas siguen
  siendo utilizables en su propia base.
- **No hay una segunda autoridad del tipo**: ni el cliente, ni la procedencia, ni
  una mezcla de fuentes.

### En contra

- **El tipo va, como mínimo, una publicación por detrás de la operación.** Una
  operación del día X usa el tipo fijado en la última publicación anterior: el
  lunes usa el del viernes, y el día siguiente a un cierre de TARGET, el anterior
  al cierre. Es la semántica elegida, no un error, pero no es el tipo del mercado
  a la hora de la operación.
- **Espera breve en zonas adelantadas respecto a Fráncfort.** Una operación con
  fecha de hoy registrada antes de que ese día haya empezado en Fráncfort, y se
  haya fijado su tipo, recibe _todavía no disponible_ y se reintenta. Con el
  horario de verano o invierno de cada lugar, eso llega aproximadamente hasta las
  07:00–08:00 en Tokio, las 08:00–10:00 en Sídney y las 10:00–12:00 en Auckland,
  más lo que tarde la ingesta, y una o dos horas tras la medianoche en Europa del
  Este y el este de África. **En las zonas a la hora de Fráncfort o por detrás
  —Europa occidental y central, gran parte de África y toda América— no ocurre**:
  su día empieza a la vez o después. Mientras espera, la operación no produce
  efectos y la cola la reintenta con el backoff de F07/ADR-001 §12. Medido: el worker
  envía la primera entrada vencida, así que **una entrada en espera no bloquea a
  las siguientes**.
- **Las operaciones con fecha efectiva futura** no se convierten hasta que su día
  comienza en Fráncfort.
- **Una enmienda del BCE posterior a la fijación no se aplica** a los días ya
  fijados. Nomey conserva el tipo que estaba disponible al comenzar el día, que
  es lo decidido, pero en el caso raro de que la enmienda corrigiera un error, el
  error queda en esos días hasta una corrección explícita de Nomey, fuera de F11.
- **Los ámbitos con base ARS, COP o CLP no tienen moneda extranjera** mientras la
  fuente no las cubra, y **un gasto de grupo cuyo pagador tenga una de esas bases
  personales se rechaza entero**.
- **Se depende de una sola fuente.** El BCE publica sus tipos _«for information
  purposes only»_ y desaconseja usarlos _«for transaction purposes»_. Nomey
  registra hechos y no ejecuta transacciones —es una inferencia, no un dictamen
  jurídico—. Hay que **citar al BCE** donde se muestren tipos.
- **Hace falta infraestructura nueva**: catálogo, fijación diaria, ingesta y su
  planificación. Hasta que exista un entorno distinto del local (criterio 2 de
  F8, pendiente), sólo puede verificarse en local.
- **La ingesta pasa a afectar a la corrección de los datos** (§3.4): una
  observación incompleta que fijara un día congelaría para siempre un tipo
  erróneo.
- **La paridad tiene coste**: vectores de derivación y conversión consumidos por
  el dominio y por SQL, y cálculo intermedio en `numeric`.
- **`CURRENCY_CONVERSION_UNSUPPORTED` cubre dos causas**, que sólo se distinguen
  con un discriminador en el cuerpo si llega a hacer falta.
- **Hay supuestos vigentes que dejan de cumplirse por sí solos**, y F11.C debe
  preservarlos:
  - F06/ADR-007 §3 da por hecho que la línea vigente y la tachada «hablan la misma
    unidad», pero una corrección puede cambiar la moneda original;
  - la comprobación de F06/ADR-008 §6 (suma de categorías = `expense_total`) exige
    sumar la magnitud **convertida**, no `original_amount`;
  - `api.personal_operation` publica `original_amount` junto a la moneda del
    **efecto**.

## Discrepancias detectadas y no resueltas aquí

- **«Cambio de moneda base con historia».** Las Consecuencias de
  [F06/ADR-001](../F06/ADR-001-personal-provisioning.md) y `docs/PROJECT_STATE.md` lo sitúan
  en F11. Sin embargo, F01/ADR-001 §8 y el invariante 12 fijan la base **inmutable
  tras la primera operación**, y la FK compuesta de `core.effect` lo impone. Las
  decisiones de F11.A **no lo incluyen**, y hacerlo exigiría un ADR sucesor de
  F01/ADR-001 §8. **Este ADR no lo decide.**

## Evidencia

Consultada el **2026-09-13**; las mediciones de API se hicieron entre las 17:55 y
las 18:00 UTC.

**Banco Central Europeo**

- Tipos de referencia (horario, días TARGET, _information purposes_, RUB):
  <https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html>
- Publicación diaria (29 divisas, cadenas decimales, fecha 2026-09-11):
  <https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml>
- Últimos 90 días (sólo días laborables):
  <https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml>
- _Framework for the euro foreign exchange reference rates_ (3-abr-2023: 14:10 y
  16:00 CET, publicación en días TARGET2, límite de republicación):
  <https://www.ecb.europa.eu/stats/pdf/exchange/Frameworkfortheeuroforeignexchangereferencerates.en.pdf>
- Cinco cifras significativas (nota de prensa del 29-11-2007):
  <https://www.ecb.europa.eu/press/pr/date/2007/html/pr071129.en.html>
- Retirada del BGN:
  <https://www.ecb.europa.eu/services/using-our-site/technical-updates/html/ecb.mid_update251217.en.html>
- Condiciones de uso, cita obligatoria y sede en Fráncfort del Meno:
  <https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html>
- Data Portal: <https://data.ecb.europa.eu/help/api/overview> devolvió **HTTP
  503** y no pudo consultarse.

**Frankfurter**

- Documentación: <https://frankfurter.dev/>
- OpenAPI v2.1.1 (`rate` numérico, mezcla, `providers`):
  <https://api.frankfurter.dev/v2/openapi.json>
- Proveedores y divisas: <https://api.frankfurter.dev/v2/providers> ·
  <https://api.frankfurter.dev/v2/currencies>
- Licencia MIT del software:
  <https://github.com/lineofflight/frankfurter/blob/main/LICENSE>
- Mediciones sobre los datos del BCE (`providers=ECB`): no hay publicación con
  fecha 2026-09-12, 2026-09-13 ni 2026-01-01, y sí con 2026-01-02; con `base=JPY`,
  EUR sale como `0.0056`. Con `providers=BANREP` y `base=COP`, USD sale como
  `0.00033`.

**Open Exchange Rates**

- Histórico en UTC desde 1999:
  <https://docs.openexchangerates.org/reference/historical-json>
- Condiciones v4.0: <https://openexchangerates.org/terms> · FAQ:
  <https://openexchangerates.org/faq> · Planes:
  <https://openexchangerates.org/signup>

**ExchangeRate.host**

- Condiciones (almacenamiento tras la terminación):
  <https://exchangerate.host/terms> · FAQ: <https://exchangerate.host/faq> ·
  Planes: <https://exchangerate.host/product>

**Bancos emisores**

- BCRA (prohíbe el uso comercial sin autorización):
  <https://www.bcra.gob.ar/aviso-legal/>
- Banco de la República (TRM):
  <https://www.banrep.gov.co/es/glosario/tasa-cambio-trm>
- Banco Central de Chile: sus URL de términos devolvieron 404. **NO CONFIRMADO.**

**Repositorio** (commit `6a5746f`)

- `src/lib/offline/response.ts` y `src/lib/offline/sync-worker.ts`: clasificación
  de respuestas y selección de la siguiente entrada.
- `supabase/migrations/20260828190000_seed_currency_catalog.sql`: catálogo.
- `supabase/migrations/20260825213506_contextual_split_and_conversion.sql`:
  `core.frozen_conversion`.
- `supabase/migrations/20260826200047_authoritative_writer_boundary.sql`:
  `sec.assert_no_conversion` y `sec.raise_boundary`.
- **Sonda desechable, fuera del repositorio**, que reproduce `convert.ts` y
  `rounding.ts` sobre 230 000 importes por par: 0 discrepancias de 1 a 200 000
  unidades mínimas, y 18 507 (USD → EUR), 23 395 (JPY → EUR) y 17 570
  (CZK → EUR) en la muestra de 10⁶ a 10¹⁵.
