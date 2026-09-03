# ADR-028 — Cola de escritura sin conexión, durabilidad de la clave y proyección optimista

- **Estado:** Aceptado
- **Fecha:** 2026-09-03

## Contexto

La **Fase 7** debe cumplir el tercer pilar del producto: registrar un gasto
ordinario en el orden de cinco segundos, reflejarlo de inmediato, encolarlo sin
conexión, sincronizarlo al recuperarla, reutilizar el mismo
`client_operation_id` en todos los reintentos, demostrar que reproducir una
operación no crea un duplicado, y resolver el conflicto monetario de
[ADR-003](ADR-003-money-representation.md) §7 sin reinterpretar nada en
silencio.

### Qué existe hoy, medido sobre el repositorio

El recorrido de escritura de un gasto personal es
`MovementForm → useRecordMovement → personal-service → api.record_personal_expense`,
y la pantalla se reconcilia refrescando las cinco superficies de lectura al
volver el foco a Inicio. Funciona, y no se reabre.

Lo que falta es concreto:

- **La clave de idempotencia no es durable.** Vive en un
  `useRef(new Map<intent, uuid>())` dentro del hook, así que muere al
  desmontarse la hoja, al morir el proceso y al remontar la pantalla. El propio
  código lo declara: _«la clave vive en memoria, así que sobrevive a un
  reintento pero no a que el sistema mate la app entre el envío y la
  respuesta»_. **[ADR-010](ADR-010-client-operation-idempotency.md) §1 exige
  persistirla antes del primer intento, y hoy no se cumple.**
- **No hay cola.** Un fallo de red deja el borrador en la hoja; cerrarla lo
  pierde. Reintentar después es un comando **nuevo** y, con el servidor habiendo
  escrito el primero, **dinero duplicado sin que nada falle**.
- **No hay señal de conectividad**, ni disparador de reconexión.
- **No hay taxonomía de errores.** Los tres hooks de escritura reducen cualquier
  fallo a un booleano. `WriteResult.already_processed` está tipado y **no lo lee
  nadie**, que es justo el dato que distingue «se escribió» de «se volvió a
  escribir».
- **No hay plazo de petición.** Es la misma deuda que la autenticación ya
  registra, ahora con dinero detrás.
- **Un defecto latente ya presente:** `useAdjustBalance` deja fecha y hora fuera
  de su huella de intención pero recalcula `currentClockTime()` en cada intento,
  y `sec.record_adjustment` **sí** incluye `effective_time` en
  `canonical_intent`. Un reintento que cruce el cambio de minuto responde
  `IDEMPOTENCY_KEY_REUSED · 409` en lugar de replay. **Falla cerrado —no duplica
  dinero— pero es incorrecto**, y desaparece al congelar el payload al encolar.

### La tensión que este ADR tiene que resolver

El proyecto tiene escrito, en tres sitios, que el cliente no calcula cifras
contables: la regla de frontera de `AGENTS.md`, el invariante «saldos, deudas,
estadísticas y disponibles son derivados» y la tercera capa vacía de
[ADR-013](ADR-013-persisted-vs-derived.md) §1. La entrada en ~5 segundos con
respuesta inmediata exige que, al guardar, **el Disponible, los totales, el
reparto por categoría y la lista cambien antes de que el servidor conteste**.

Las dos cosas no pueden ser ciertas a la vez sin decir exactamente en qué
consiste la excepción y qué la acota. Eso es lo que este ADR fija.

**Este ADR no reemplaza a ninguno.** Implementa la obligación de cliente que
ADR-010 §1 dejó escrita, usa la puerta que ADR-010 §6 dejó abierta, y respeta
[ADR-011](ADR-011-operation-version-model.md) §5 sin tocarla.

---

## Decisión

### 1. La unidad es la entrada de cola, y su clave se persiste antes de enviar

Registrar un movimiento **inserta una entrada** en una cola local duradera
**antes de cualquier llamada de red**. La entrada nace con su
`client_operation_id`, generado con `newClientOperationId()`, y ése es su
identificador primario.

La entrada tiene dos mitades, y sólo una muta:

| Mitad         | Contenido                                                                                                                             | Mutabilidad   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **Intención** | `client_operation_id` · `schema_version` · `actor_id` · `scope_id` · `command_type` · `payload` · fotografía monetaria · `created_at` | **Inmutable** |
| **Progreso**  | `state` · `attempts` · `next_attempt_at` · `last_error_class` · `last_error_code` · `confirm_seq` · `result_operation_id`             | Mutable       |

El **payload se congela al encolar**, construido con `buildPayload`, la misma
función pura que usa hoy la ruta en línea. Congela importe,
`currency_definition_id`, concepto, categoría, fecha y hora efectivas — es decir,
**exactamente los campos que el servidor mete en `canonical_intent`**. Por eso
todo intento posterior produce la misma intención canónica y el servidor puede
responder replay en vez de conflicto.

La **fotografía monetaria** —`{ definition_id, code, scale }` del ámbito en el
momento de capturar— se guarda junto al payload. Es lo que permite pintar la
operación sin red, y es la prueba documental del conflicto de ADR-003 §7.

> **El orden no es negociable:** `INSERT` → cerrar la hoja → pintar. Nunca al
> revés. Es lo que hace que un cierre forzado entre pintar y persistir sea
> imposible por construcción, en lugar de improbable.

### 2. La identidad de la intención es la entrada, jamás su contenido

**Dos entradas distintas son dos intenciones distintas, aunque su payload sea
idéntico.** Cerrar el formulario y volver a registrar los mismos datos crea una
entrada nueva con una clave nueva: dos cafés iguales pueden ser dos gastos
reales.

**Queda prohibido deduplicar por importe, concepto, categoría, fecha, hora o
cualquier otra huella del payload.** El mapa `Map<intent, uuid>` que hoy indexa
la clave por el contenido del borrador **desaparece de la ruta de alta** en
cuanto la cola es la autoridad.

El **doble toque** se resuelve con **exclusión síncrona más una única inserción
atómica**, no buscando payloads iguales.

> La ruta de **corrección** (`/edit-movement`) conserva de momento su disciplina
> en memoria, porque no se encola en F7 (§4). Es deuda declarada, no un olvido.

### 3. El tipo de comando es un discriminante cerrado y versionado

La entrada **no guarda el nombre de una función RPC**. Guarda un valor de un
vocabulario cerrado:

```
personal_expense.create
personal_income.create
```

El worker lo traduce con un `switch` **exhaustivo** a una función permitida de
`personal-service`. Un valor desconocido —una entrada escrita por una versión
posterior de la app— **no se ejecuta nunca**: queda bloqueada, visible, y
pendiente de migración o revisión.

Guardar un nombre de función libre convertiría el fichero local en una lista de
llamadas arbitrarias, y una entrada corrupta o de otra versión sería una
invocación no prevista.

### 4. Alcance de F7

La infraestructura es genérica y versionada. **F7 sólo enruta por la cola las
altas de `personal_expense.create` y `personal_income.create`.**

Quedan **fuera** de la cola en F7: correcciones, anulaciones, ajustes de saldo y
cualquier comando de Grupos. Tienen CAS y conflictos propios —una corrección
encolada puede quedar obsoleta antes de drenar y aterrizaría como
`VERSION_CONFLICT`— y **no se incorporan por analogía**.

### 5. Persistencia: `expo-sqlite`

La cola vive en una base SQLite local, con estas condiciones:

- **Atomicidad por fila para el camino normal.** El alta es un `INSERT`; cada
  transición, un `UPDATE`.
- **Una única operación exige transacción de varias filas:** la sustitución de
  una entrada rechazada por la intención nueva de §15 —crear la nueva y borrar
  la vieja—, que debe ser todo o nada. `withTransactionAsync` la cubre, y es el
  único sitio donde hace falta.
- **Migración local con `PRAGMA user_version`**, además del `schema_version` de
  cada entrada. Son dos cosas distintas: la primera versiona el esquema físico;
  la segunda, la forma del payload guardado.
- **Importes y conceptos quedan temporalmente en el sandbox local.** Es
  información personal, y de ahí la retención mínima de §18 y la prohibición de
  registro de §19.
- **No se guardan tokens ni secretos**, de ninguna clase.
- **La compartición futura con widgets mediante App Groups no es automática.**
  Exige configuración o código nativo posterior y **queda fuera de F7**. SQLite
  no se presenta como «ya compartible con F16».

### 6. Máquina de estados

```
   (hoja)                                          ┌──► confirmed ──► (retirada, §9)
    draft ──encolar──► queued ──enviar──► sending ─┼──► retryable ──(backoff)──┐
                          ▲                        ├──► blocked_session ──┐    │
                          │                        ├──► rejected          │    │   TERMINALES
                          │                        ├──► review            │    │   (proyección
                          │                        └──► conflict          │    │    retirada)
                          └───────────────────────────────────────────────┴────┘
                                        (mismo actor, sesión válida)
```

| Estado            | Significado                                                                   | Proyectada                | Salida                              |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------- | ----------------------------------- |
| `queued`          | En disco, nunca enviada                                                       | **Sí**                    | → `sending`                         |
| `sending`         | Intento en vuelo. **En disco se relee siempre como `queued`**                 | **Sí**                    | → cualquiera                        |
| `confirmed`       | El servidor contestó; `result_operation_id` guardado                          | **Sí**, hasta reconciliar | retirada (§9)                       |
| `retryable`       | Fallo transitorio o respuesta ambigua: sin red, DNS/TCP, 408, 429, 5xx, plazo | **Sí**                    | → `sending` al vencer el backoff    |
| `blocked_session` | Sin sesión válida del mismo actor                                             | **Sí**                    | → `queued` al volver el mismo actor |
| `rejected`        | El servidor rechazó **y la ausencia de efectos es demostrable**               | **No**                    | §15, forma **ordinaria**            |
| `review`          | Rechazo que **no permite demostrar ausencia de efectos**                      | **No**                    | §15, forma **excepcional**          |
| `conflict`        | La configuración monetaria se movió bajo la operación                         | **No**                    | §14 y §15, forma **excepcional**    |

Las tres reglas que sostienen la tabla:

- **`sending` en disco se relee como `queued` y se reenvía con la misma clave.**
  El cliente no puede distinguir «no llegó» de «llegó y no me enteré», y **no lo
  intenta**. Es seguro únicamente porque el servidor es idempotente: esa
  dependencia es el corazón de esta decisión y se escribe donde se lea.
- **Mientras el resultado sea desconocido, la entrada sigue proyectada y se
  reintenta con la misma clave.** Un fallo transitorio o una respuesta ambigua
  **nunca** crean otra intención: el servidor pudo haberla ejecutado.
- **En un estado terminal la proyección se retira y la autoridad pasa al
  snapshot del servidor.** Si pese a todo la operación existiera, aparecerá en
  el siguiente refresco; por eso ninguna terminal reconstruye nada por su
  cuenta.

Los tres estados terminales son distintos a propósito, y **la diferencia entre
los dos primeros es exactamente qué se puede demostrar**:

- **`rejected`** — la operación **no llegó a producir efectos**, y eso es
  demostrable por la respuesta. Es seguro proponer registrarla de nuevo.
- **`review`** — el servidor respondió de forma terminal pero **no se puede
  demostrar que no haya efectos**, típicamente `IDEMPOTENCY_KEY_REUSED`. Crear
  otra clave aquí podría **duplicar una operación existente**, así que no se
  propone nada automático: sólo revisión.
- **`conflict`** — la operación es válida y lo que se movió fue la
  configuración monetaria bajo ella. ADR-003 §7 exige revisión, no descarte, y
  su payload congelado **no puede** salir adelante bajo la moneda nueva.

**Ninguna entrada terminal se elimina sola**, y ninguna bloquea a las
siguientes: salen de la cabecera de la cola y esperan a que la persona las
resuelva. **Cuando la resuelve, desaparecen** (§15, §18): lo terminal no es
historial.

**Los tres estados terminales son internos.** La interfaz no los nombra ni los
distingue entre sí: §15 define **dos** formas visibles de incidencia, y nada
más.

### 7. Atomicidad, y los cuatro cierres forzados

Lo único que debe ser atómico es la inserción
`(client_operation_id, payload, state = queued)` y la transición de confirmación
con su `result_operation_id`. Ambas son una sola sentencia.

| Se cierra la app…                             | Qué queda      | Qué ocurre al reabrir                                                                                             |
| --------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| **antes de persistir**                        | nada           | El borrador se pierde. Honesto: no se prometió nada                                                               |
| **después de persistir, antes de renderizar** | fila `queued`  | Rehidrata, se proyecta y se sincroniza sola                                                                       |
| **durante la petición**                       | fila `sending` | Se relee `queued` y se reenvía con la misma clave                                                                 |
| **confirmado, respuesta no guardada**         | fila `sending` | **Indistinguible del anterior, y no se intenta distinguir.** Se reenvía → `already_processed: true` → `confirmed` |

### 8. Proyección optimista — la excepción controlada

Al guardar, Nomey muestra **de inmediato el mismo resultado visual que mostraría
tras la confirmación del servidor**: el movimiento aparece con normalidad en la
actividad, el Disponible cambia, Ingresos o Gastos cambian, la categoría cambia,
y el donut y su leyenda cambian. **No hay etiqueta de «Pendiente» ni línea de «n
sin sincronizar».** La confirmación es **visualmente silenciosa**.

Esto es una **excepción explícita y acotada** a la regla vigente de que las
cifras contables sólo las deriva el servidor. Sus siete límites:

1. **La verdad económica sigue siendo el servidor.** Nada de lo proyectado es un
   hecho.
2. **La aplicación no persiste saldos, totales ni sectores optimistas.** Lo único
   duradero es el **comando inmutable** de la cola.
3. **Una única proyección pura y compartida**, de la forma
   `snapshot confirmado del servidor + comandos locales todavía no reconciliados`.
4. **Todas las superficies consumen esa misma proyección.** No hay cálculo
   separado dentro de Disponible, de las tarjetas de flujo, de la de categorías
   ni del donut.
5. **Ninguna cifra proyectada alimenta comandos, conversiones, validaciones
   contables ni escrituras posteriores** (§10).
6. **Al confirmar se deduplica antes de retirar** la proyección (§9).
7. **Al alcanzar un estado terminal la proyección se revierte entera**, y la
   autoridad pasa al snapshot del servidor (§6, §15).

#### No es una segunda aritmética: es la misma

La proyección **no escribe reglas económicas nuevas**. Reutiliza
`src/domain/effects/derive.ts` —`derivePersonalExpense`, `derivePersonalIncome`—
y `src/domain/effects/balance.ts` —`deriveBalance`, `deriveEconomicTotal`—, que
son la implementación de referencia que la frontera del servidor **reproduce
exactamente** ([ADR-002](ADR-002-accounting-model.md) §7,
[ADR-009](ADR-009-authoritative-write-boundary.md) §1) y cuya paridad afirman los
vectores compartidos de `tests/vectors/` **en los dos lados**.

Esto es lo que convierte la excepción en controlada en vez de en un agujero: si
la proyección y el servidor divergieran, los vectores fallarían antes.

Toda la aritmética es **entera y exacta**, sobre `bigint` en unidades mínimas,
por `sumMoney`, que rechaza mezclar definiciones monetarias con
`MONEY_CURRENCY_MISMATCH`. **No entra ningún `number` en el camino del dinero**,
así que la regla de frontera de `AGENTS.md` no se toca.

Lo único que la proyección añade por su cuenta es el **agrupamiento por
`category_id`** para el reparto y el donut. Es agrupamiento más suma exacta, no
regla nueva: la categoría no es un concepto del efecto —vive en
`core.expense_category`, por versión
([ADR-027](ADR-027-expense-only-categories.md))— así que no tiene sitio en
`domain/effects`.

#### Sin base confirmada no se fabrica ninguna cifra

En un arranque en frío sin red las intenciones pendientes **sobreviven y son
visibles**, pero los agregados confirmados que no puedan cargarse se declaran
**temporalmente no disponibles**. No se construye un Disponible a partir de las
intenciones locales solas.

La proyección devuelve, por tipo, uno de dos resultados:

```
{ base: 'available',   balance, incomeTotal, expenseTotal, categories, operations }
{ base: 'unavailable', operations }        ← sólo las intenciones locales
```

Es la misma disciplina que la regla de agregación del glosario: **antes que una
cifra dudosa, ninguna cifra**.

### 9. Reconciliación y retirada

Una entrada `confirmed` **sigue proyectándose hasta que se pueda demostrar que
el snapshot vigente ya la contiene**. La retirada es una consecuencia de esa
demostración, nunca un paso aparte, de modo que no existe ningún fotograma en
que la operación esté en las dos —duplicada— ni en ninguna —parpadeo a la baja.

La prueba es **una marca monótona de cliente**, no la aparición del
identificador en la página visible:

```
confirm_seq   se asigna al confirmar, desde un contador monótono de cliente
snapshot.seq  el valor de ese contador en el instante en que ARRANCÓ el refresco
retirada  ⇔  confirm_seq <= snapshot.seq
```

Si el refresco arrancó después de la confirmación, el servidor ya tenía la fila
confirmada cuando la consulta corrió, así que el snapshot la refleja.

> **La aparición del `result_operation_id` en el snapshot es un atajo
> suficiente, NUNCA un requisito.** Si el identificador aparece, se retira ya,
> sin esperar a nada. Pero exigirlo produciría **doble proyección**: esa prueba
> falla exactamente cuando la operación no cabe en la página o cae fuera del
> intervalo seleccionado —registrar la cena de ayer mirando `Día` es el caso
> corriente—, y la entrada quedaría proyectada para siempre sobre un Disponible
> que ya la incluye, con el saldo **duplicado**. La condición necesaria y
> suficiente es la marca monótona; el identificador sólo la adelanta.

**La clave de render es estable a través de la transición.** La fila del servidor
cuyo `operation_id` coincide con un `result_operation_id` conocido hereda el
`client_operation_id` como clave, así que la sustitución no remonta el componente
y no produce salto ni parpadeo.

### 10. Lo que una cifra proyectada no puede hacer

Ninguna cifra proyectada alimenta un comando. Dos consecuencias concretas, y las
dos son obligatorias:

- **`record_adjustment` declara siempre el Disponible CONFIRMADO**, nunca el
  proyectado. Y como los ajustes **no se encolan en F7** (§4), **«Fijar el
  Disponible» queda bloqueado mientras existan entradas sin reconciliar**. El
  protocolo de [ADR-022](ADR-022-balance-target-and-serialization.md) hace que
  la persona declare el saldo que dice tener y el servidor derive el delta bajo
  lock; con intenciones en vuelo, esa declaración es ambigua y el delta saldría
  mal.
- **Corregir y anular una fila todavía no reconciliada quedan bloqueados**: no
  tiene `operation_id` ni versión vigente, así que no hay CAS que enviar.

**Los dos bloqueos son temporales y se explican en la interfaz**, con su motivo
y su condición de salida —«cuando termine de sincronizarse»—. Un control
apagado y mudo describiría un permiso que no existe; lo que hay es una espera.
Y ninguno de los dos amplía el alcance de F7: ajustes, correcciones y
anulaciones **siguen sin encolarse** (§4).

### 11. Conectividad, disponibilidad y taxonomía de errores

**NetInfo es un disparador y un supresor, nunca una prueba.** Sin enlace no se
intenta —no se gasta batería en un fallo seguro— y **no se marca nada como
fallido**. La clasificación final sale siempre del transporte o de la respuesta
de la frontera.

Siete clases, y ninguna se colapsa con otra. La columna que decide el
tratamiento no es la gravedad, sino **si la respuesta permite demostrar que la
operación no produjo efectos**:

| Clase                         | Origen típico                                                                            | ¿Ausencia de efectos demostrable? | Estado            | ¿Reintenta la entrada?    |
| ----------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------- | ----------------- | ------------------------- |
| Transporte y disponibilidad   | sin red, DNS/TCP, 408, 429, 5xx, plazo agotado, respuesta perdida                        | **No** — pudo ejecutarse          | `retryable`       | **sí, misma clave**       |
| Autenticación recuperable     | sesión local no `signed-in`; 401; JWT caducado                                           | sin llegar a enviarse             | `blocked_session` | al volver, misma clave    |
| **Autorización permanente**   | denegación real de privilegio o RLS **con sesión válida y fresca**                       | **Sí**                            | `rejected`        | **no** (§15)              |
| Payload inválido              | `PAYLOAD_INVALID · 400`                                                                  | **Sí**                            | `rejected`        | no (§15)                  |
| Rechazo de dominio            | `CATEGORY_NOT_USABLE`, `OPERATION_CLASS_MISMATCH`, códigos de `src/domain/errors.ts`     | **Sí**                            | `rejected`        | no (§15)                  |
| **Conflicto de idempotencia** | `IDEMPOTENCY_KEY_REUSED · 409`                                                           | **No**                            | **`review`**      | no, y **sin clave nueva** |
| Conflicto monetario           | `CURRENCY_CONVERSION_UNSUPPORTED` · `CURRENCY_NOT_SUPPORTED` · `CURRENCY_CODE_AMBIGUOUS` | **Sí**                            | `conflict`        | no (§14)                  |

**Cualquier respuesta que no se pueda clasificar con certeza cae en la fila más
conservadora que le aplique**: si el resultado es desconocido, `retryable` con
la misma clave; si el servidor respondió de forma terminal pero no se puede
demostrar ausencia de efectos, `review`. **Nunca al revés.**

> **`42501` no es sinónimo de sesión caducada.** También significa una denegación
> real de privilegio, que no se arregla volviendo a entrar y que reintentar sólo
> convierte en un bucle. La clase se decide con **los tres datos que sí existen**:
> estado HTTP, código de frontera y **estado local de la sesión**. Si la sesión
> local no está `signed-in`, es autenticación; si lo está y acaba de refrescarse,
> es autorización.

**Una entrada terminal no se reintenta jamás**, ni finitas ni infinitas veces.
Lo que §15 ofrece tras un `rejected` **no es un reintento de esa entrada**: es
una intención nueva, decidida por la persona.

### 12. Reintentos, orden y backoff

- **Una petición en vuelo**, y **FIFO por actor**. El servidor ya serializa los
  ámbitos bajo un orden ascendente de locks (ADR-022), así que el paralelismo
  sobre el mismo ámbito no compra nada, y un worker serie hace deterministas las
  afirmaciones de orden.
- **Backoff exponencial con jitter y con suelo efectivo.** El jitter completo
  puede devolver un retardo prácticamente nulo y convertir el backoff en un
  bucle, así que la fórmula lleva mínimo:

  ```
  techo    = min(base · 2^intentos, tope)
  retardo  = minimo + aleatorio() · (techo − minimo)
  ```

  con `base` y `minimo` de 1 s y `tope` de 5 minutos. El generador aleatorio y el
  reloj **se inyectan**, y las pruebas fijan los extremos `aleatorio() = 0` y
  `aleatorio() = 1`.

- **Los intentos no se limitan a un número.** Un tope silencioso tiraría dinero ya
  declarado.
- **Disparadores:** al encolar · al volver a primer plano, sobre el `AppStatePort`
  que ya existe y **no un segundo listener** · al recuperar conectividad · al
  recuperar sesión · al vencer `next_attempt_at`.
- **Sobre una entrada cuyo resultado es desconocido** —`queued`, `sending`,
  `retryable`, `blocked_session`—, **un reintento manual sólo adelanta
  `next_attempt_at`**: nunca crea otra entrada ni otra clave, porque el servidor
  pudo haberla ejecutado. Es la única forma de reintento que existe.
- **Sobre una entrada terminal no hay reintento de ninguna clase.** El
  `Reintentar` de §15 se llama así **para la persona**, que sólo quiere repetir
  su gasto; por dentro es una **intención nueva**, y sólo se ofrece cuando la
  ausencia de efectos es demostrable.

### 13. Sesión, cierre de sesión y aislamiento por actor

Cada entrada lleva el `sub` del JWT del momento de encolar. **Toda lectura y todo
envío filtran por la identidad actual.**

- Sin sesión válida, la entrada queda **bloqueada conservando su proyección y sus
  datos**, y se reanuda **únicamente bajo el mismo actor**. **Jamás se envía con
  la sesión de otra persona.**
- **Cerrar sesión se permite**, con **aviso previo** cuando haya pendientes. Las
  entradas se **conservan**, aisladas por `actor_id`. Otra cuenta **no puede
  verlas ni enviarlas**. Al volver a entrar la misma cuenta, se rehidratan,
  reaparece su proyección **cuando exista el snapshot necesario** —si no, §8
  declara los agregados no disponibles— y la sincronización continúa.
- **Nunca se descartan automáticamente.**
- El coste se dice en el aviso: `signOut({ scope: 'local' })` revoca el refresh
  token **de este dispositivo**, así que las entradas sólo podrán salir cuando esa
  misma cuenta vuelva a entrar **aquí**.
- **La cola no lee, no copia y no guarda el token.** El refresco sigue siendo de
  `auth-js`, y nadie escribe un segundo temporizador.

### 14. El conflicto monetario de ADR-003 §7

Una operación capturada bajo la moneda base anterior que llega después del cambio
**conserva su importe, su moneda y su fecha efectiva**, **no produce ningún
efecto** y **entra en revisión**. Está prohibido interpretarla bajo la moneda
nueva, cambiarle cualquier dato, aceptarla en silencio o generar efectos antes de
resolverla.

Ruta real, con números:

```
1  Ámbito personal recién creado, moneda base EUR (escala 2), sin ningún efecto
2  Sin red: «Cena · 42,80 · Restauración · 2026-09-03 21:40»
   se encola con amount '4280', currency_definition_id = <EUR>, foto { EUR, 2 }
3  Vuelve la red; antes de drenar, la persona cambia la base a USD
   api.set_personal_base_currency('USD')  →  permitido: el ámbito no tiene efectos
4  El worker envía  →  sec.assert_no_conversion: <USD> ≠ <EUR>
                    →  CURRENCY_CONVERSION_UNSUPPORTED · 422  →  estado `conflict`
```

**Lo que F7 puede ofrecer, y sólo eso:** revisar y **crear conscientemente una
intención nueva**, con `client_operation_id` **nuevo**, compatible con la moneda
actual · descartar de forma explícita. **Nunca conversión automática.** La
operación original queda **resuelta explícitamente**, en un sentido o en otro.

> **Por qué el conflicto NO usa el `Reintentar` de §15**, aunque su ausencia de
> efectos sí sea demostrable: allí `Reintentar` reencola **el mismo payload
> congelado**, y aquí ese payload **no puede** salir adelante bajo la moneda
> nueva — volvería a ser rechazado, y ofrecerlo sería ofrecer algo que se sabe
> que falla. Lo que hace falta es que la persona **introduzca o confirme
> conscientemente** una intención distinta, y eso es revisión, no reintento. Por
> eso el conflicto toma la **forma excepcional** de §15, `Revisar` y
> `Descartar`, y es la única excepción visible del producto.

> **Un límite honesto.** ADR-003 §7 pide además enseñar la derivación bajo la
> configuración actual, calculada con la política histórica para la fecha
> efectiva. Eso exige **FX resuelto por el servidor**, diferido a **F11**, y su
> ausencia es justamente por lo que la frontera responde 422. F7 **no** puede
> ofrecer «convertir», y no finge poder hacerlo.

### 15. Incidencias: la campana, y ningún segundo almacén

Sólo una entrada **terminal** genera incidencia. Al alcanzar un estado terminal
se **retira toda su proyección optimista** y se crea una **incidencia visible en
la campana** contigua a Perfil, como notificación **interna de Nomey** —no push,
ni integración nativa.

**Un fallo transitorio o una respuesta ambigua no son una incidencia**, y esto
es lo primero porque es lo que más se confunde: sin red, timeout, DNS/TCP, 408,
429, 5xx o respuesta perdida, la operación **permanece proyectada con
normalidad**, **conserva su entrada, su clave y su payload**, se reintenta sola
con backoff, **no se revierte** y **no se anuncia como «no realizada» mientras
su resultado siga siendo desconocido**. El servidor pudo haberla ejecutado.

#### La regla que gobierna toda esta sección

**La taxonomía de §11 es interna y no se traslada a la interfaz.** Ni una sola
de sus palabras aparece en pantalla: la persona no ve —ni debe deducir—
_intención_, _clave_, _cola_, _estado terminal_, _entrada_, _operación nueva_,
_reintento automático_, `client_operation_id` ni ningún código de la frontera.
Lo que ve es su gasto y qué le ha pasado.

**Sólo existen dos formas visibles de incidencia**, y no se añade una tercera.

#### Forma ordinaria — el movimiento no se realizó, y consta

Cubre `rejected`: el servidor rechazó y **la ausencia de efectos es
demostrable**.

```
Gasto de 12 € en Supermercado no realizado. ¿Quieres volver a intentarlo?
                                              [ Reintentar ]   [ No ]
```

**Para la persona, `Reintentar` significa repetir ese gasto. Nada más.** Por
dentro **no reintenta la entrada rechazada**: produce una intención nueva, y las
tres cosas ocurren **en una sola transacción**, de modo que no existe ningún
instante con las dos entradas ni con ninguna:

1. se crea una entrada **completamente nueva**, con `client_operation_id`
   **nuevo**, estado `queued`, `attempts` a cero y **el mismo payload
   congelado** —importe, concepto, categoría, fecha, hora y definición
   monetaria—;
2. se **elimina la entrada rechazada** y se resuelve su incidencia;
3. se **despierta al worker**.

**`No` cierra la incidencia y elimina la entrada rechazada.** No se crea ningún
movimiento.

**La entrada rechazada no se conserva como historial.** Lo resuelto desaparece
en los dos caminos; el historial de lo que sí ocurrió vive en el servidor (§18).

**Si la intención nueva vuelve a ser rechazada, se genera una incidencia nueva.
Nunca un bucle automático:** cada intento adicional nace de una pulsación, no
del sistema.

> **Por qué una clave nueva y no la original.** Reutilizarla dependería de que
> el rechazo hubiera revertido también el reclamo del comando, que es una
> propiedad transaccional distinta según el error y que habría que medir caso
> por caso; y la ganancia sería nula, porque una clave nueva sobre una operación
> que **demostradamente** no existe no puede duplicar nada. Lo que **sí** sería
> peligroso es lo contrario, y por eso está prohibido justo debajo.

#### Forma excepcional — repetir el mismo gasto no puede funcionar

Es la única excepción visible, y no es una segunda interfaz para los fallos
habituales: es una situación que **ADR-003 §7 exige** tratar aparte. Ofrece
`Revisar` y `Descartar`, nunca `Reintentar`, porque repetir **exactamente el
mismo gasto volvería a fallar**.

Cubre dos estados internos, por el mismo motivo visible:

- **`conflict`** — la moneda base se movió bajo la operación (§14). El payload
  congelado **no puede** salir adelante bajo la configuración actual.
- **`review`** — `IDEMPOTENCY_KEY_REUSED · 409` y cualquier respuesta terminal
  que **no permita demostrar ausencia de efectos**. Aquí `Reintentar` sería
  crear otra clave sobre una operación que **podría existir**, es decir
  **duplicar dinero**: exactamente el fallo que toda esta decisión existe para
  impedir. El texto dice que no se ha podido confirmar si el movimiento quedó
  registrado y pide comprobarlo.

`Revisar` abre el movimiento precargado para que la persona **decida
conscientemente**; si confirma, es una intención nueva con clave nueva.
`Descartar` cierra la incidencia y elimina la entrada, **sin tocar nada del
servidor**.

> **`Descartar` es seguro incluso cuando no se puede demostrar ausencia de
> efectos**, y conviene ver por qué: no borra nada del servidor. Si la operación
> existiera pese a todo, sigue en la lista de la persona, porque la autoridad es
> el snapshot y no esta entrada. Lo peligroso nunca fue descartar: era
> **reenviar** o **crear otra clave** sin saber qué pasó, y eso es justo lo que
> esta forma no ofrece.

> **Reusar la forma del conflicto para `review` es deliberado.** La alternativa
> era una tercera forma visible para explicar una distinción —«demostrable» vs
> «no demostrable»— que sólo importa por dentro. Las dos piden lo mismo a la
> persona: mira, y decide tú.

#### Dónde viven

**El estado terminal de la propia cola es la fuente durable de estas
incidencias.** No se crea un segundo almacén de notificaciones, ni un contador,
ni una etiqueta en la lista: **la campana es la única entrada**.

### 16. El catálogo de categorías se cachea

El catálogo visible se guarda localmente tras cada carga correcta. **Es
información de presentación y selección, no una caché económica**, y por eso no
toca la tercera capa de ADR-013 §1.

Si la persona **nunca** ha cargado categorías en ese dispositivo y está sin
conexión, Nomey **lo explica y no permite registrar un gasto sin conexión**. No se
encola un gasto sin categoría —sería `PAYLOAD_INVALID`— y **no se inventa
ninguna**.

Si una categoría cacheada ha dejado de ser utilizable cuando se sincroniza,
**decide el servidor** —`CATEGORY_NOT_USABLE · 422`— y la operación entra en
revisión.

### 17. Plazo de petición

Las escrituras procesadas por la cola llevan **plazo real, con cancelación del
transporte** cuando la versión instalada del cliente lo permita.

Agotar el plazo **conserva la entrada y su `client_operation_id`** y **nunca
genera otra intención**. La objeción histórica al plazo —que un `Promise.race`
deja la petición viva y puede duplicar— **no aplica aquí**: si la petición
abandonada llega a escribir, el reintento con la misma clave recibe
`already_processed`.

**La deuda del plazo de autenticación no se cierra aquí.** La autenticación
carece de esta garantía idempotente y sigue separada.

### 18. Retención

Una entrada `confirmed` se conserva hasta que un refresco demuestre que el
snapshot ya la contiene (§9). Entonces **se retira, sin doble contabilización**.

Una entrada **terminal** se conserva **sólo hasta que la persona resuelve su
incidencia**, y desaparece en los dos caminos: sustituida por la intención nueva
o eliminada al cerrarla (§15). **Una entrada rechazada no es historial
permanente.**

**No se mantiene historial local de ninguna clase.** El historial definitivo
vive en el servidor, y los payloads guardados contienen importes y conceptos:
cuanto menos duren en el dispositivo, mejor (§19).

### 19. Privacidad y registro

- La cola **nunca** guarda tokens, refresh tokens, claves ni ningún secreto. Un
  test de superficie sobre el fuente lo afirma, como el que ya cubre el bundle.
- **No se registra jamás el contenido de una entrada.** Sólo identificadores,
  según `AGENTS.md` §8. Ni el payload, ni el importe, ni el concepto entran en un
  log ni en un informe de errores.

---

## Alternativas consideradas

**A · Hacer durable sólo la clave, sin cola.** Persistir el
`client_operation_id` junto al borrador y dejar que la pantalla reintente.
**Descartada:** cierra el duplicado pero no da entrada sin conexión, ni reintento
en segundo plano, ni proyección, que son tres de los cuatro criterios de cierre de
la fase. Además deja la intención colgando de una pantalla montada, que es el
defecto de origen.

**B · La cola sobre SecureStore troceado, ya instalado.** **Descartada** por tres
motivos medidos sobre el propio `chunked-storage`: el techo de **65.536 unidades
UTF-16 por valor** es un muro duro para una cola de dinero; una cola en un solo
valor obliga a reescribirla entera en cada transición, así que no hay atomicidad
por entrada; y su modo de fallo documentado —**degradar a «no hay nada»**— es
exactamente el equivocado cuando lo que se pierde es dinero ya declarado. Se añade
que la cola **no guarda secretos**, de modo que el cifrado en reposo no es lo que
se estaría comprando.

**C · Cola clave-valor (`AsyncStorage` o `expo-sqlite/kv-store`).**
**Descartada:** quita el techo de tamaño pero no da transacción entre claves ni
consulta filtrada por actor y estado, y deja la migración local a mano. Se acabaría
escribiendo un índice sobre un almacén sin índices.

**D · Optimismo parcial: fila pendiente etiquetada y cifras confirmadas
intactas.** Era la recomendación inicial, por respetar sin excepciones la regla de
que el cliente no calcula cifras contables. **Descartada por decisión de
producto**, y el motivo se registra porque es real: quien apunta un café sin red
vería el Disponible sin moverse, y una entrada de cinco segundos que no cambia la
cifra que la persona vino a mirar no cumple el pilar. El coste de descartarla es
esta excepción, y §8 es lo que la acota.

**E · Caché persistente de agregados confirmados**, para tener base sobre la que
proyectar en un arranque en frío sin red. **Descartada:** es literalmente la
tercera capa que ADR-013 §1 declara vacía en v1, y su introducción exige medición,
no previsión. El precio es el estado `base: 'unavailable'` de §8, que es preferible
a una cifra fabricada.

**F · Deduplicar por huella del payload.** **Descartada, y es peligroso:** dos
gastos reales idénticos —dos cafés el mismo día, con el mismo concepto y la misma
categoría— se fusionarían en uno, y el segundo desaparecería **sin que nada
fallara**. Es el mismo razonamiento por el que ADR-010 §3 prohíbe devolver el
original ante una intención distinta.

**G · Que cada superficie calcule su propio optimismo.** **Descartada:**
Disponible, tarjetas de flujo, tarjeta de categorías y donut tendrían cuatro
implementaciones de la misma suma, y la primera divergencia sería una pantalla que
se contradice a sí misma sin que nada falle. Una proyección compartida es lo que
hace la excepción auditable.

**H · `react-query` con mutaciones optimistas.** **Descartada para F7:** su
optimismo es de caché en memoria y no de intención duradera, así que no cubre el
reinicio ni el arranque sin conexión, que es el caso que importa; y añadiría una
dependencia grande para resolver la mitad fácil. `lib/query` sigue reservado y esta
decisión no lo prejuzga.

**I · Enrutar todos los comandos por la cola desde F7.** **Descartada:**
corrección y anulación llevan `expected_version_id`, y una corrección encolada
puede quedar obsoleta antes de drenar y aterrizar como `VERSION_CONFLICT`. Qué
significa un CAS diferido es una decisión propia y no se toma por analogía.

---

## Consecuencias

### A favor

- **ADR-010 §1 se cumple de verdad.** La clave existe en disco antes del primer
  intento, así que el duplicado por reinicio o por respuesta perdida deja de ser
  posible en lugar de ser improbable.
- **Un solo camino de escritura.** La ruta en línea también encola, de modo que el
  caso sin conexión deja de ser una rama especial y las garantías se prueban una
  vez.
- **El defecto latente del ajuste desaparece** al congelar el payload: la intención
  canónica es idéntica en todos los intentos.
- **La entrada en ~5 segundos deja de depender de la red**, que es lo que hace
  medible el criterio de cierre.
- **La excepción de la proyección es auditable**: una función pura, compartida,
  sobre las mismas reglas que los vectores ya verifican en los dos lados.

### En contra

- **Se introduce una excepción a una regla que estaba escrita sin excepciones.**
  Aunque §8 la acote, a partir de aquí hay que leer tres documentos para saber qué
  cifra es un hecho y cuál una proyección. El coste es real y permanente.
- **La confirmación silenciosa esconde el fallo hasta que ocurre.** Si la
  proyección y el servidor divergieran por un defecto, la persona vería una cifra
  correcta durante segundos y luego un salto. Lo mitiga la paridad de vectores, no
  lo elimina.
- **Dos dependencias de runtime más**, con su peso, su superficie y su
  mantenimiento.
- **Importes y conceptos quedan en claro en el sandbox local** mientras la entrada
  vive. Es información personal que antes no se almacenaba en el dispositivo.
- **«Fijar el Disponible» se bloquea con pendientes** (§10). Es correcto y es una
  función menos disponible justo cuando la red falla.
- **Un arranque en frío sin red enseña movimientos y no enseña Disponible.** Es la
  consecuencia directa de descartar la alternativa E, y se verá como una carencia
  aunque sea la respuesta honesta.
- **La cola tiene su propia deuda:** correcciones y anulaciones siguen sin
  durabilidad de clave hasta que alguien decida qué significa un CAS diferido.
- **La forma excepcional de §15 es deliberadamente incómoda.** Ante un
  `IDEMPOTENCY_KEY_REUSED` la persona tiene que ir a mirar si su gasto está o no
  está, y Nomey no se lo puede decir. Es feo, y es preferible a las dos
  alternativas: adivinar y duplicar, o descartar y perder un gasto real.
- **Dos causas internas muy distintas comparten forma visible.** Un conflicto de
  moneda y una respuesta indemostrable piden lo mismo —mira y decide— pero no
  son lo mismo, y quien depure un caso real tendrá que ir al estado interno para
  saber cuál era. Es el precio de no inventar una tercera pantalla.

### Riesgos que quedan abiertos

- **El mapa exacto `(estado HTTP, código, SQLSTATE) → clase` no está
  determinado**, y determinarlo por deducción sería inventar. Es la puerta de
  aceptación de abajo. **Y la columna que más importa no es la clase, sino si la
  respuesta demuestra ausencia de efectos**: de ella depende que se pueda ofrecer
  una intención nueva, y equivocarse ahí **duplica dinero**. Cualquier respuesta
  no clasificada cae en `retryable` o en `review`, nunca en `rejected`.
- **La retirada por marca monótona depende de que el refresco arranque después de
  la confirmación.** Es cierto por construcción en el worker, y una prueba lo
  afirma; cualquier futuro refresco disparado desde otro sitio tiene que
  respetarlo.
- **El comportamiento de `expo-sqlite` bajo Hermes**, y la supervivencia de la base
  a una recarga de Expo Go, **se miden antes de escribir el store**.

---

## Invariantes que introduce

1. **La clave de idempotencia existe en almacenamiento duradero antes de la primera
   petición**, siempre.
2. **La identidad de una intención es su entrada, nunca su contenido.** Está
   prohibido deduplicar por huella del payload.
3. **El payload se congela al encolar** y no se modifica jamás. Una entrada
   terminal tampoco se modifica: lo que se crea es otra entrada.
4. **`sending` en disco se relee como `queued`.** El cliente no intenta distinguir
   «no llegó» de «no me enteré».
5. **Mientras el resultado sea desconocido, se reintenta con la MISMA clave y no
   se crea ninguna otra intención.** Un fallo transitorio, un plazo agotado o una
   respuesta perdida nunca producen una clave nueva.
6. **Una clave nueva sólo se crea cuando la ausencia de efectos es demostrable**,
   y siempre por una decisión explícita de la persona. Ante una respuesta que no
   lo permita demostrar, **nunca**.
7. **Ninguna cifra proyectada alimenta un comando, una conversión, una validación
   contable ni una escritura.**
8. **Nada optimista se persiste.** Sólo el comando.
9. **Una entrada se retira de la proyección cuando se demuestra que el snapshot
   ya la contiene, o cuando alcanza un estado terminal** — y entonces la
   autoridad es el snapshot.
10. **Las entradas están aisladas por actor** y no se envían nunca con la sesión
    de otra persona.
11. **Una entrada terminal no se reintenta**, y ninguna cadena de rechazos avanza
    sin una pulsación por cada paso. No hay bucle automático.
12. **La cola no guarda secretos y su contenido no se registra.**
13. **La maquinaria no se ve.** Un movimiento pendiente se pinta como un
    movimiento normal —sin etiqueta, sin contador, sin acción propia—, la campana
    es la única entrada a las incidencias, y el vocabulario interno de este ADR
    no aparece en ninguna pantalla.

---

## Compatibilidad con las fuentes normativas vigentes

**Este ADR no reemplaza a ninguno**, y ningún ADR aceptado queda contradicho.
Lo que sí hace es obligar a que unas frases vigentes se lean con una precisión
que hoy no tienen:

| Fuente                                     | Relación                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md` · regla de frontera del dinero | **Intacta.** La proyección es aritmética entera exacta sobre `bigint` y ningún `number` toca el dinero; nada proyectado realimenta un valor de registro |
| `AGENTS.md` §3 · idempotencia              | **Intacta, y por fin cumplida.** Ya exigía una clave «generated **and persisted** by the client before the first attempt»                               |
| `data-model.md` · invariante 19            | **Intacto y reforzado.** La garantía efectiva para el origen cliente pasa de depender de una pantalla montada a depender del disco                      |
| `data-model.md` · invariante 20            | **Intacto.** «El cliente no escribe efectos» — la proyección no escribe: muestra                                                                        |
| `data-model.md` · invariante 11            | **Intacto**, con la precisión añadida en el mismo PR: una proyección local no es un saldo                                                               |
| `data-model.md` · invariante 28            | **Se implementa** en §14: la operación conserva importe, moneda y fecha, y no se reinterpreta                                                           |
| ADR-003 §2, §3, §6                         | **Intactos.** Unidades mínimas enteras, definición monetaria con su identidad, y nada monetario cruza JSON como número                                  |
| ADR-003 §7                                 | **Se implementa** en §14, con su límite de FX dicho                                                                                                     |
| ADR-010 §1, §2, §3                         | **Se cumple** §1 por fin; §2 y §3 siguen siendo del servidor y el cliente no canonicaliza ni compara nada                                               |
| ADR-010 §6                                 | **Se usa** la puerta que dejó abierta, en los términos que dejó escritos                                                                                |
| ADR-011 §5                                 | **Intacto.** La unidad de idempotencia sigue siendo el comando, y el `command_type` local es un espejo del suyo, no una fuente                          |
| ADR-013 §1 · tercera capa vacía            | **Intacta.** ADR-013 define caché como «se persistiría»; aquí no se persiste ningún agregado                                                            |
| ADR-013 §9 · proyección canónica           | **Intacta.** La vigencia se sigue resolviendo en `core.current_effect` y no se reimplementa en el cliente                                               |
| ADR-022                                    | **Intacto y reforzado:** §10 impide declarar un `target_balance` sobre una cifra proyectada                                                             |
| ADR-024                                    | **Intacto.** La anulación sigue siendo terminal y no se encola (§4)                                                                                     |
| `PROJECT_STATE.md` · invariantes 1 y 6     | **Requieren precisión**, no reversión: el servidor deriva lo que **cuenta**; el cliente proyecta lo que **se ve**. Se ajustan al cerrar F7              |

---

## Puerta de aceptación

Antes de escribir la taxonomía en código, **se mide contra el stack real**, por
HTTP y con JWT auténtico, la tripleta `(estado HTTP, código de frontera,
SQLSTATE)` que devuelve cada una de las siete clases de §11 — incluidas, por
separado, la sesión ausente, el JWT caducado y una denegación real de privilegio.
La evidencia se deja donde ya viven las sondas del proyecto y el mapa se escribe
**desde lo medido**, no desde lo deducido.

Se mide también, en las dos plataformas: que la base de `expo-sqlite` sobrevive a
una recarga de Expo Go, y el comportamiento de apertura síncrona frente a
asíncrona bajo Hermes.

---

## Fuera de alcance

Correcciones, anulaciones y ajustes en la cola · comandos de Grupos · FX y
conversión, que son de **F11** · caché persistente de agregados confirmados ·
compartición con widgets por App Groups, que exige configuración nativa y es de
**F16** · notificaciones push · el plazo de las operaciones de autenticación, que
sigue siendo deuda abierta y separada.
