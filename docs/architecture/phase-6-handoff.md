# Punto de entrada — Fase 6 · Modo Personal

> **Documento vivo de la fase, y NO normativo.** Recoge dónde está la Fase 6, qué
> queda decidido bloque a bloque y qué obligaciones hereda el siguiente. Las
> decisiones viven en [`docs/adr/`](../adr/README.md), en
> [`data-model.md`](data-model.md) y en el [roadmap](../product/roadmap.md); si
> este documento los contradice, mandan ellos.

Antes de nada, y en este orden: [`AGENTS.md`](../../AGENTS.md) ·
[`PROJECT_STATE.md`](../PROJECT_STATE.md) · este documento.

---

## 1 · Dónde está la fase

| Bloque   | Qué es                                       | Estado                              |
| -------- | -------------------------------------------- | ----------------------------------- |
| **F6.A** | Fundación: catálogo monetario y provisioning | **Cerrado como fundamento backend** |
| **F6.B** | Anatomía del movimiento                      | **Cerrado como fundamento backend** |
| **F6.C** | Saldo objetivo, observación y anulación      | **Cerrado como fundamento backend** |
| **F6.D** | Superficie de lectura                        | **Cerrado como fundamento backend** |
| **F6.E** | Inicio · **y el cableado del provisioning**  | **Cerrado**                         |
| **F6.F** | Alta, edición y eliminación                  | No empezado                         |
| **F6.G** | Cierre de fase                               | No empezado                         |

**F6.A no tiene pantalla, y es deliberado.** Sus criterios se verifican por check
SQL y por HTTP con JWT real, no por vista.

> **Y por eso su cierre es de backend, no de producto.** La función existe y es
> segura; **la app todavía no la invoca**. El cableado —cuándo se llama, qué se
> ve si falla y qué no se puede dar por hecho hasta que termine— es de **F6.E**,
> y va **antes** de que Inicio consuma el ámbito. Ver §4.

---

## 2 · Qué promete la Fase 6

Del [roadmap](../product/roadmap.md), sin interpretación:

> **Alcance.** Ingresos, gastos, categorías, listado e historial, corrección por
> versionado del propio registro, y saldo derivado. El sistema de diseño crece
> aquí, a partir de un caso real.

Y sus cinco criterios de cierre: registrar, consultar y corregir un ingreso y un
gasto de principio a fin · la corrección versiona y **no muta** · saldo y
estadísticas **derivados**, sin saldo almacenado como segunda fuente · solo
`ingreso` y `gasto` alimentan estadísticas · tests de dominio en el mismo PR que
la lógica.

**F6 es el primer hito enseñable.**

---

## 3 · Qué entregó F6.A

### Lo que existe ahora y antes no

```
core.currency_definition   20 definiciones sembradas, con identidad FIJA
nomey_provisioner          tercer rol: NOLOGIN, NOBYPASSRLS, no propietario

api.ensure_personal_scope(payload)       crea ámbito + membresía. Idempotente
api.set_personal_base_currency(payload)  cambia la moneda si nunca hubo efecto
api.personal_scope                       vista: el ámbito del actor y su moneda
api.currency_definition                  vista: el catálogo, para el selector
```

**El backend ya sabe crear el Modo Personal de una cuenta autenticada, y la app
todavía no se lo pide.** La distinción importa y conviene no borrarla:

- `api.ensure_personal_scope` **existe, es segura e idempotente**, y crea el
  ámbito con su membresía. Verificada por HTTP con JWT real y bajo concurrencia.
- **La aplicación no la invoca en ningún punto de su ciclo autenticado.** Hoy una
  cuenta recién confirmada **sigue sin** Modo Personal hasta que alguien llama a
  la función.

Esa integración es de **F6.E** (§4), y **F6.A no la incluye a propósito**: es
fundamento de backend, sin pantalla.

Era la condición sin la cual F6 no podía abrir: sin `scope` con `owner_user_id`
**y** su fila de `core.membership` —las dos, invariante 11— el dueño no ve ni
sus propios efectos.

La decisión es [ADR-019](../adr/ADR-019-personal-provisioning.md). La evidencia
medida, [`supabase/e21/`](../../supabase/e21/README.md).

### Lo que hay que saber para construir encima

- **Hay tres fronteras de privilegio, no dos.** `nomey_writer` escribe
  contabilidad **debajo** de la RLS; `postgres` es owner de
  `api.claimed_dimension()` porque una lectura de reclamación debe
  **atravesarla**; y ahora `nomey_provisioner` crea ámbitos y membresías. **El
  escritor contable sigue sin poder crear un ámbito, y el provisioner no puede
  escribir ni un solo hecho contable.** No unificar ninguna de las tres.
- **La barrera del provisioner va acotada al actor**, no solo a
  `kind = 'personal'`. E21 midió que `sec.request_actor_id()` funciona dentro de
  un definer de ese rol **y dentro de una policy** evaluada durante él.
  `scope_provisioner_currency` lleva `owner_user_id = sec.request_actor_id()` en
  `USING` **y** en `WITH CHECK`, así que **ni un definer que ignorase la
  resolución por actor y apuntase a un `scope_id` arbitrario alcanzaría el Modo
  Personal de otra persona**: se comprobó, y devuelve cero filas sin tocar nada.
  El residuo real es más estrecho: un fallo del código podría cambiar la moneda
  del ámbito **propio** del actor cuando no debería, y en cuanto exista un solo
  efecto ni eso, porque la FK compuesta lo rechaza.
- **Las policies de `SELECT` del provisioner son parte de la corrección.** E21
  midió tres veces el mismo modo de fallo: con `GRANT` y sin policy aplicable, la
  lectura devuelve **cero filas sin error**. Y una de ellas es contraintuitiva:
  **el `WITH CHECK` de la membresía consulta `core.scope`, y esa subconsulta está
  sujeta a la RLS del propio provisioner**; sin su policy de lectura, el alta
  legítima se rechaza.
- **La moneda se elige, no se cambia.** Recomendada por la Region del
  dispositivo, con **fallback EUR** si el código no está en el catálogo, y
  modificable **mientras el ámbito nunca haya tenido un efecto**. Desde el primer
  movimiento queda bloqueada con `BASE_CURRENCY_LOCKED · 409`.
- **La autoridad de ese bloqueo es la FK compuesta**, no el `IF` del cuerpo.
  Medido: con un efecto existente PostgreSQL rechaza el `UPDATE` con `23503`
  ejecute el código lo que ejecute. La comprobación existe para **fallar bien**.
- **Se mira `core.effect`, nunca `core.current_effect`.** Un movimiento creado y
  luego anulado dejará la proyección vigente vacía y sus efectos históricos en la
  moneda vieja. Esto ya está escrito pensando en la anulación de F6.C.
- **Los UUID monetarios no se regeneran jamás.** Son la identidad. Regenerarlos
  divide los entornos en silencio: los importes cuadran dentro de cada uno y
  dejan de ser comparables entre ellos.
- **No se crea `core.participant` para el Modo Personal**, y no es un olvido: los
  efectos personales llevan participante legítimamente nulo y la atribución es
  por propiedad. Si F10 lo necesita, añadirlo es aditivo.
- **Ninguna de las dos funciones usa `core.client_command`.** Esa relación es la
  unidad de idempotencia del **comando contable**; el provisioning no crea
  ninguna operación. Son idempotentes **por estado**.

### Dos trampas que costaron descubrir, y no hay que repetir

**1 · `api.personal_scope` no puede llevar una columna «¿queda alguna huella
contable?».** La primera versión tenía un `is_currency_locked` resuelto con un
`EXISTS` sobre `core.effect`, y **la guarda de catálogo de ADR-013 §9 lo
rechazó**: la única relación autorizada a depender directamente de `core.effect`
es la proyección canónica. Y **no se arregla leyendo `core.current_effect`**,
porque sería incorrecto —lo que bloquea la moneda es haber tenido algún efecto
_alguna vez_—. Exponer esa pregunta es una decisión propia y pertenece a **F6.D**.

**2 · Las retiradas de los scripts de concurrencia y de la frontera HTTP borraban
`core.currency_definition` sin filtro.** Desde F6.A el catálogo lo siembra una
migración, así que un borrado sin filtro lo arrasa y los checks siguientes dejan
de encontrarlo. Los tres scripts ahora **borran solo lo suyo**, y dos de ellos
comprueban al final que **las veinte definiciones siguen ahí**.

---

## 3 bis · Qué entregó F6.B

```
core.operation_version.effective_time   hora local, ANULABLE
core.category                           15 de sistema + personalizadas
core.movement_detail                    concepto y categoria, POR VERSION

api.record_personal_income(payload)     LA OCTAVA. Clase `income` real
api.record_personal_expense(payload)    + concepto, categoria y hora
api.category                            vista del catalogo visible
api.create_custom_category(payload)     alta de personalizada
api.rename_custom_category(payload)     renombrado, que alcanza al historico
api.set_custom_category_active(payload) baja y alta logicas
```

Seis cosas que conviene no volver a deducir:

- **Lo universal y lo que depende de la clase están separados.** `effective_time`
  es columna de la versión y es **anulable**: nulo significa «sin hora
  registrada», **nunca medianoche**. Concepto y categoría viven en
  `core.movement_detail`, presente solo donde el hecho existe — mismo patrón que
  `core.split`, y por el mismo motivo. **Ninguna clase se inventa nada.**
- **`Otros` es una fila real** en las dos familias, y es lo que permite que
  `category_id` sea `NOT NULL` sin que exista el caso nulo en ninguna parte.
- **Los catálogos de gasto y de ingreso son distintos**, y la FK compuesta
  `(category_id, applies_to) → category (id, applies_to)` lo hace **estructural**.
  Medido: sin la comprobación de frontera, la FK rechaza igual. La frontera
  existe para **fallar bien**, no para hacer cumplir la regla.
- **Renombrar alcanza al histórico y no crea versión.** Una categoría es una
  entidad, no una etiqueta copiada. **Dar de baja no borra**: retira del selector
  y el histórico la sigue resolviendo. Y una categoría inactiva **se conserva** al
  corregir aunque no pueda **asignarse** de nuevo — sin esa excepción, dar de baja
  dejaría incorregible todo lo que la usara.
- **Concepto, categoría y hora entran en la intención canónica.** Un reintento con
  cualquiera de los tres materialmente distinto es conflicto, no replay. Y
  `Mercadona` ≠ `MERCADONA`: la canonicalización recorta y normaliza a NFC, y
  **no pliega mayúsculas**.
- **`nomey_provisioner` no gana un rol hermano.** Su alcance real es **la
  frontera de las escrituras que no son contabilidad**, y las categorías son su
  segundo miembro. `authenticated` sigue sin escribir **nada** en `core`.

> **Y una trampa que costó descubrir:** `CREATE OR REPLACE FUNCTION` con un
> parámetro nuevo **no reemplaza** —crea una función distinta y conviven las
> dos—. Si la resolución de sobrecarga hubiera elegido la antigua
> `sec.persist_version`, las siete funciones previas habrían seguido escribiendo
> **sin la guarda de clase**. Se suelta explícitamente, y un check afirma que
> queda exactamente una.

---

## 3 quater · Qué entregó F6.D

```
api.personal_operation           la lista. UNA FILA POR OPERACION
api.personal_operation_version   el historial de correcciones, por version
api.personal_balance             el Disponible, derivado y ya agregado
api.observed_balance(uuid[])     la observacion de ADR-023, POR LOTE
```

**Cuatro objetos, ni uno más, y ningún `GRANT` nuevo sobre `core`** — que la
superficie no necesitara privilegios nuevos es la señal de que no está
preguntando nada que la RLS no hubiera previsto.

Cinco cosas que conviene no volver a deducir:

- **La observación sale por una función y no por una vista**, y no es
  preferencia: el check de ADR-023 exige **cero** vistas de `api` dependientes de
  `core.balance_observation`. Convertir ese cero en «exactamente una» habría
  debilitado el invariante literal; una función lo consigue **sin tocarlo**,
  porque ADR-013 §9 ya escribe las lecturas económicas con `BEGIN ATOMIC` para
  que el catálogo las cubra. La guarda nueva acota esa única vía.
- **El historial no puede publicar un importe firmado.** Los efectos de una
  versión superada están en `core.effect`, que ninguna vista puede leer, así que
  publica `original_amount` —el hecho declarado— y **no** se fabrica el signo con
  un `case` sobre la clase.
- **La lista blanca de clases es intención, no límite técnico.** Falsificado: sin
  ella, un `internal_transfer` entra en la lista.
- **La barrera de verdad es la proyección canónica.** Medido retirando capas:
  sin el predicado de propiedad pero con `security_invoker`, cero filas ajenas;
  sin `security_invoker` en la vista de `api`, **cero también**; sin él en
  `core.current_effect`, **se filtra**. Es el hallazgo de E19 reproducido sobre
  esta superficie.
- **La `api` es la única puerta del cliente**, y aquí se comprobó de frente:
  `authenticated` no tiene `USAGE` sobre `core`, y sin JWT PostgREST responde
  `401 / 42501` antes de que la RLS tenga nada que decidir.

La decisión es [ADR-025](../adr/ADR-025-personal-read-surface.md). Se verifica
con `supabase/checks/read-surface.sql` y con la **sección 11** de
`scripts/http-boundary-check.sh`, las dos en CI.

---

## 3 quinquies · Qué entregó F6.E

**El primer bloque de la fase con pantalla.** Inicio muestra saldo real,
selector de intervalo, ingresos y gastos desplegables, reparto por categoría e
historial con su «Editado» — y la app **por fin provisiona el Modo Personal**.

```
api.personal_statistics(p_from, p_to)   LA QUINTA superficie de lectura
src/features/personal/                  el dominio de Inicio, con su servicio
src/ui/components/fade-edge.tsx         el desvanecido bajo el dock
```

Seis cosas que conviene no volver a deducir:

- **El plan de consultas es el diseño**, no una consecuencia. Por visita: saldo
  y catálogo una vez —**no dependen del intervalo y no se refetchean al
  cambiarlo**—, estadísticas y operaciones por intervalo, versiones anteriores
  sólo si alguna fila las tiene, y observaciones **sólo al desplegar y para la
  página entera**. Ni una llamada por fila.
- **Cifras exactas, listas paginadas.** Los totales los agrega el servidor y son
  exactos a cualquier tamaño; la lista es una página y la pantalla **dice
  cuántas faltan** en vez de dejar que se lea como completa.
- **La quinta superficie existe porque se midió que hacía falta**: PostgREST
  16.1 rechaza los agregados con `PGRST123` y `max_rows` corta en 1000, así
  que agregar en cliente habría dado una cifra incompleta que no falla.
  [ADR-026](../adr/ADR-026-personal-statistics.md).
- **«Hoy» es el calendario del DISPOSITIVO, no el de UTC.** `effective_date` no
  lleva zona y el par fecha+hora es un reloj de pared (ADR-020 §3): leerlo en UTC
  movería de día los movimientos registrados de noche, y no fallaría nada.
- **El «Editado» compara importe declarado con importe declarado.** La versión
  anterior no tiene importe firmado, así que el signo lo pone la presentación a
  partir de la clase — seguro porque todas las versiones de una operación son de
  la misma clase, y comprobado contra el `balance_amount` de la vigente.
- **No hay biblioteca de gráficos ni de SVG**, y no se añadió ninguna: el
  diagrama de sectores y el desvanecido inferior se construyen con `View`.
  Añadir una dependencia de runtime exige aprobación explícita.

---

## 4 · Obligaciones que F6.A y F6.B dejan a los bloques siguientes

### ~~Para F6.B — obligatoria~~ · **RESUELTA en F6.B**

Era: `sec.lock_and_cas` comprobaba existencia y CAS, y **no** que la clase de la
operación coincidiera con la función invocada. Con `record_personal_income`
dejaba de ser teórico, porque su payload es de **forma idéntica** al del gasto.

**Cerrada.** La guarda vive en `sec.persist_version`, que **ya recibía la clase**
y por la que pasan las ocho funciones para existir: no hay parámetro que olvidar
ni función que pueda quedarse fuera. Corre **después del CAS**, de modo que no es
un oráculo de la clase de una operación ajena. `OPERATION_CLASS_MISMATCH · 422`.

**Falsificada:** retirando la guarda, el writer de ingreso corrige un gasto y
G7 mide la corrupción —dos efectos vigentes con clase contable ajena a la de su
operación—. Ver [ADR-020](../adr/ADR-020-version-content-and-time.md) §6.

### ~~Para F6.C~~ · **RESUELTAS en F6.C**

- **La hora del ajuste**: sí, y **obligatoria**. Un ajuste por objetivo es por
  naturaleza una observación en un instante, y una lista mixta necesita **un**
  criterio de orden. Sigue **sin concepto ni categoría**, como decidió ADR-020.
- **El bloqueo del saldo** usa el mismo orden global ascendente que la deuda, y
  `sec.lock_debt_scopes` pasó a `sec.lock_scopes`: **un mecanismo, un nombre, un
  orden**. Ninguna función queda huérfana del protocolo — participan las **siete**
  que producen saldo, no solo el ajuste.
- **La unión de ámbitos** —nueva versión y sustituida— gobierna el lock y la
  observación, así que **una anulación sí deja observación** pese a no tener
  efectos propios.

### ~~Para F6.D~~ · **RESUELTAS en F6.D**

Las siete, y tres con un matiz que conviene leer entero:

- **La unidad es la operación**, y `api.personal_effect` se conservó intacta
  para su propósito de ADR-016.
- **Las anuladas fuera de la superficie normal.** Y con un matiz medido: lo que
  hoy las excluye es la **proyección canónica** —una anulación no tiene efectos,
  así que no aporta fila—. La cláusula `version_kind = 'record'` es
  **redundante**: se falsificó, y el check pasa igual. Se conserva porque el
  criterio tiene que estar **declarado** y no implícito, y una comprobación
  textual impide retirarla por «código muerto».
- **La vía interna de la trazabilidad NO es el cliente leyendo `core`.**
  `authenticated` no tiene `USAGE` sobre ese schema, así que `api` es su única
  puerta. La vía es que el hecho permanece íntegro en `core` bajo acceso
  privilegiado, más la legibilidad bajo RLS que ADR-024 §D6 ya falsificó.
- **`observed_balance_after` sale por una FUNCIÓN**, `api.observed_balance`, y
  jamás por una vista: la guarda de ADR-023 sigue exigiendo cero vistas. Lo que
  se añadió es una guarda **nueva** que acota a una sola función.
- **La línea del ajuste** compone el objetivo —`target_balance`, en la lista— y
  el «antes» —`observed_balance_before`, en la función—. Dos fuentes, como
  estaba decidido.
- **«¿Ha tenido algún efecto alguna vez?» NO se expone**, y es decisión tomada,
  no olvido: `core.effect` está cerrado a vistas **y a funciones** (ADR-013 §9),
  `core.current_effect` responde a otra pregunta, y ningún consumidor de F6 la
  necesita. La autoridad sigue siendo `api.set_personal_base_currency` con su
  `BASE_CURRENCY_LOCKED · 409`.

La decisión completa es [ADR-025](../adr/ADR-025-personal-read-surface.md).

### Para F6.E y F6.F — de F6.D

- **Una página son TRES consultas, y hay que hacerlas así.** La lista; después
  `personal_operation_version?operation_version_id=in.(…)` con los
  `previous_version_id` de la página, para la línea tachada del «Editado»; y
  `observed_balance([…ids])` para el «antes» del ajuste. **Nunca una llamada por
  fila**: la función toma un array precisamente para eso.
- **El predecesor es `previous_version_id`, no `version_no - 1`.** ADR-011 §11
  no hizo estructural que el predecesor sea la versión anterior.
- **Los dos importes no son el mismo dato.** `balance_amount` es lo que la
  operación mueve en el saldo, firmado; `original_amount` es el importe
  declarado de la versión. La línea tachada del historial **sólo** tiene
  `original_amount`, así que la comparación «antes / ahora» se hace entre
  `original_amount`, y el signo lo pone la presentación a partir de
  `operation_class` —seguro, porque todas las versiones de una operación son de
  la misma clase.
- **El orden es contrato del cliente**, porque una vista no se lo puede imponer
  a PostgREST:
  `effective_date desc, effective_time desc nulls last, operation_created_at desc, operation_id desc`.
  El desempate es el de la **operación** y no el de la versión, para que corregir
  no reordene la lista.
- **El saldo devuelve UNA fila siempre**, con `0` si el ámbito no tiene efectos.
  No hay que tratar «cero filas» como saldo cero — y si llegan cero filas, lo que
  falta es el **ámbito**, que es el caso de F6.E.
- **La observación se rotula como observación del sistema**, nunca como «el saldo
  que tenías aquel día»: corregir hoy un movimiento de hace tres meses observa el
  saldo de hoy (ADR-023 §5).
- **La categoría se resuelve contra `api.category`**, que la lista sólo publica
  por `category_id`. Es lo que hace que renombrar alcance al histórico sin que
  nadie propague nada, y lo que permite que una categoría dada de baja siga
  resolviendo su nombre.
- **El ajuste no tiene concepto ni categoría, y no hay que inventárselos.** Su
  línea la compone el producto: con objetivo, «Saldo ajustado a X»; por delta,
  `original_amount` con su signo.
- **Ampliar la lista blanca de clases es deliberado y le toca a la fase que traiga
  la clase.** Y ojo: la lista blanca acota **la lista**, nunca el **saldo**, así
  que desde F9 la suma de lo listado puede no explicar el Disponible.

### ~~Para F6.E~~ · **RESUELTA en F6.E**

Los cuatro requisitos, cumplidos: se invoca al entrar en la rama autenticada ·
el reintento es seguro y **no automático** —un fallo espera a que la persona lo
pida, en vez de machacar un backend caído— · el fallo es `unavailable` con
salida, la misma forma de F5.B · y **nada se pinta hasta que el ámbito está**,
que es el requisito que evita el fallo silencioso.

La moneda sale de `getLocales()[0].currencyCode`, la de la **Región**. Y una
nota que costó descubrir al escribirlo: el efecto **no puede** hacer `setState`
síncrono —`react-hooks/set-state-in-effect` lo rechaza y encadena renders—, así
que el estado inicial `idle` hace de «resolviéndose» y sólo `retry`, que es un
manejador, anuncia el vuelo.

### Para F6.F — de F6.E

- **La pantalla ya tiene los botones y no tiene las acciones.** Editar, eliminar
  y ajustar existen como affordance y hoy responden que aún no están. F6.F
  conecta `api.record_personal_expense`, `api.record_personal_income`,
  `api.record_adjustment` y `api.annul_operation` **detrás de esos mismos
  controles**, sin rehacerlos.
- **La confirmación de borrado se construye CON la acción, no antes.** Se dejó
  fuera de F6.E a propósito: una confirmación que no confirma nada es peor que
  no tenerla. El patrón existe ya en el proyecto —`sign-out-confirmation.ts`,
  el diálogo como dato— y es el que toca reutilizar.
- **El CAS es `current_version_id`**, que la lista ya publica. No hace falta
  una consulta extra para corregir ni para anular.
- **Anular es terminal** (ADR-024 §6): una operación anulada no admite versiones
  nuevas y responde `OPERATION_ANNULLED · 409`. La interfaz no debe ofrecer
  «restaurar», que es producto que nadie ha diseñado.
- **Tras escribir hay que refrescar, y el hook ya tiene la puerta:**
  `usePersonalHome().refresh()`. Lo que **no** se puede hacer es actualizar la
  cifra en el cliente sumando el importe recién escrito — el saldo y los totales
  los deriva el servidor, y una suma optimista es una segunda aritmética. El
  optimismo de verdad es de F7, con su cola.
- **Una escritura invalida las observaciones de la página**, porque cambia el
  saldo: no reutilizar las que ya estaban cargadas.

### Para la fase que traiga clases nuevas — de F6.E

- **La lista blanca de `api.personal_operation` acota la LISTA, y
  `accounting_class` acota los TOTALES.** Hoy describen el mismo conjunto de
  hechos y el check lo afirma comparando la suma del reparto con
  `expense_total`. Desde F9 no tiene por qué seguir siendo así, y ese check es
  quien lo dirá.
- **Y el saldo nunca estuvo acotado por ninguna de las dos.** El `Disponible`
  se deriva de todos los efectos vigentes, así que desde F9 la suma de lo
  listado puede legítimamente no explicarlo.

---

## 5 · Reglas de F5 y F4 que siguen vigentes

- **No añadir un `getSession()`**, no suscribirse otra vez a `onAuthStateChange`,
  no copiar el token, y no tratar `displayName` como identidad.
- **Nada de `router.replace`**, ni al entrar ni al salir.
- **Toda UI nueva pasa por i18n y por `lib/format`.** Un test falla si una
  pantalla incrusta una cadena, un símbolo monetario o una fecha.
- **`src/ui/` no puede importar de `lib/`**, y `features/` no importa `features/`.
- **El `Intl` de Hermes no es el de Node.** Nada que corra en el dispositivo se da
  por verificado porque pase en Vitest.
- **El color nunca es la única señal**, y ningún efecto se cobra contraste
  ([`design-direction.md`](../product/design-direction.md) §8).
- **Ninguna credencial privada de backend en el bundle**, con sus tres capas.

---

## 6 · Fuera de la Fase 6, y conviene que se vea

Premium, entitlements, paywall y análisis avanzado (**F14/F15**) · FX y
multimoneda operativa (**F11**) · transferencias reales (**F12/F13**) · Grupos
(**F9**) · claim (**F10**) · cola offline y optimismo (**F7**) · widgets
(**F16**).

**F6 sí deja affordances visuales inertes** cuando ya forman parte del diseño
aprobado —el botón de calendario y la opción `⇄`—, sin lógica detrás y sin
comprobar ningún plan.

---

## 7 · Cómo se verifica F6.A

```bash
# los nueve checks SQL, con el stack levantado
docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
  -X -q -v ON_ERROR_STOP=1 < supabase/checks/personal-provisioning.sql

# concurrencia real: dos provisionings simultáneos
./scripts/provisioning-concurrency.sh

# la frontera entera, por HTTP y con JWT real
./scripts/http-boundary-check.sh
```

La medición que sostiene el diseño se reproduce con:

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
  -X -q -v ON_ERROR_STOP=1 < supabase/e21/privilege-boundary.sql
```

**Los tres primeros los ejecuta CI en cada PR**, sobre un stack levantado desde
cero. E21 no: es evidencia, y se ejecuta a mano cuando haga falta releerla.
