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
| **F6.C** | Saldo objetivo, observación y anulación      | No empezado                         |
| **F6.D** | Superficie de lectura                        | No empezado                         |
| **F6.E** | Inicio · **y el cableado del provisioning**  | No empezado                         |
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

### Para F6.C — de F6.B

- **Decidir si el ajuste declara hora efectiva.** Hoy `effective_time` es nula en
  las seis clases que no la piden, y por eso una lista mixta ordenaría los
  movimientos por hora y los ajustes por `created_at`. Se dice en vez de
  rellenarse; F6.C tiene el contexto para decidirlo, porque es quien trae el
  ajuste por saldo objetivo.
- **El ajuste sigue sin concepto ni categoría**, y es correcto: su línea de
  historial la deriva el producto —«Saldo ajustado a X»— y no la escribe nadie.
  Si F6.C quisiera darle una, sería una fila de `core.movement_detail` y una
  familia nueva en `core.category`, no un valor sintético.

### Para F6.C

- El bloqueo de la dimensión saldo debe usar **el mismo orden global ascendente**
  que ya usa el protocolo de deuda de ADR-013 §11.
  `api.set_personal_base_currency` **ya bloquea** con ese criterio, de modo que el
  ADR de serialización **extiende** en vez de corregir. Ninguna función queda
  huérfana del protocolo.
- La observación de saldo y el bloqueo operan sobre la **unión de los ámbitos
  afectados por la versión nueva y por la que sustituye** — mismo principio que
  ADR-013 §11 ya fija para la deuda. Sin eso, **una anulación no dejaría
  observación**, porque no tiene efectos propios de los que derivar el ámbito.

### Para F6.D

- Decidir cómo se expone —si se expone— «¿este ámbito ha tenido algún efecto?».
  Es lo que quedó fuera de `api.personal_scope`.
- La unidad de lectura es la **operación**, no el efecto. `api.personal_effect`
  se conserva **para su propósito técnico existente** y no se convierte en lista
  de movimientos.
- Las anuladas se excluyen de la superficie normal, y debe existir una vía
  interna comprobable de que la trazabilidad permanece.

### Para F6.E — obligatoria, y **antes** de que Inicio consuma el ámbito

**El cableado del provisioning en el cliente es de F6.E.** F6.A dejó la función
lista y **la app no la llama**. Cuatro requisitos, y el cuarto es el que evita el
fallo silencioso:

1. **Invocar o asegurar el provisioning al entrar en la experiencia autenticada**
   correspondiente, no en el arranque a ciegas.
2. **Reintento seguro**, que la idempotencia por estado ya permite: repetir la
   llamada no crea un segundo ámbito ni deshace la moneda elegida.
3. **Estado de fallo visible y recuperable**, con salida. La forma ya existe en
   el proyecto: `unavailable` de F5.B es exactamente ese patrón —error
   recuperable, no callejón sin salida.
4. **No dar por hecho que el Modo Personal existe** hasta que el provisioning
   haya terminado. Una pantalla que asuma el ámbito antes de tiempo pintará
   cifras de un ámbito que todavía no está, y no fallará: leerá cero filas.

- La moneda recomendada sale de `expo-localization`: `getLocales()[0].currencyCode`
  es el de la **Region**, y `languageCurrencyCode` el del **idioma**. Es la misma
  distinción que F4.B ya fijó para el formato; usar el segundo sería el error.

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
