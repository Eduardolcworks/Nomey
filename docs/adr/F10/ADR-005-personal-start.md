# F10/ADR-005 — Punto de inicio del Modo Personal tras el Invitado: incluir los movimientos de grupos, o empezar desde cero

- **Estado:** Aceptado (2026-09-16)
- **Fecha:** 2026-09-16
- **Alcance:** qué pasa con la historia de Grupos de una cuenta que nació como
  sesión Invitado ([F05/ADR-003](../F05/ADR-003-guest-session.md)) cuando esa
  cuenta abre por **primera vez** su Modo Personal. Fija que la decisión es
  **del usuario y una sola vez**, con dos opciones —incluir esa historia o
  empezar desde cero—, que queda **persistida en el modelo**, que «empezar
  desde cero» es un **punto de inicio** del ámbito personal y no un borrado ni
  un ajuste, qué lecturas lo respetan y cuáles no, y sobre qué instante se
  decide. Fija también que una cuenta sin historia relevante al primer acceso
  queda resuelta **automáticamente como incluir**, para que la pregunta no
  pueda aparecer más tarde.
- **No cubre:** un «reiniciar Modo Personal» general, borrar movimientos o
  grupos, o un reset de cuenta (no existen; §7 del encargo); la conversión
  Invitado → cuenta y el modo Invitado (F05/ADR-003, cerrados en A3); la
  economía de Grupos, los vínculos y las fusiones
  ([F09](../F09/README.md), [F10/ADR-002](ADR-002-permanent-identity.md),
  [F10/ADR-003](ADR-003-active-and-historical-link.md),
  [F10/ADR-004](ADR-004-identity-scope-closure.md)); la atribución económica
  ([F03/ADR-013](../F03/ADR-013-economic-attribution.md)), que no cambia.
- **Supera en parte** [F06/ADR-004](../F06/ADR-004-balance-target-and-serialization.md)
  y [F06/ADR-007](../F06/ADR-007-personal-read-surface.md) allí donde definen
  el Disponible como «la suma de **todos** los efectos de saldo vigentes del
  ámbito» y el historial como «**todas** las operaciones vigentes de la lista
  admitida»: pasan a ser la suma y la lista de los efectos y operaciones **que
  cuentan para el Personal** (§3), donde «incluir» —y la ausencia de decisión—
  es exactamente la definición anterior. Nada más de esos ADR cambia: el
  protocolo del `target_balance`, la observación y la anulación siguen tal
  cual, y por construcción leen la misma cifra que el usuario ve (§4).
- **Conserva** [F01/ADR-001](../F01/ADR-001-accounting-model.md) (caja ≠
  gasto económico ≠ deuda), [F03/ADR-010](../F03/ADR-010-persisted-vs-derived.md)
  (nada de esto es un caché: es una regla de lectura sobre hechos
  persistidos), [F06/ADR-005](../F06/ADR-005-balance-observation.md),
  [F06/ADR-006](../F06/ADR-006-annulment.md), [F06/ADR-008](../F06/ADR-008-personal-statistics.md)
  (las cuotas siguen siendo la dimensión económica atribuida por vínculo) y
  [F09/ADR-002](../F09/ADR-002-client-provisioning-idempotency.md) (el
  comando es de provisioning, con su clave).

## Contexto

Un invitado usa Grupos con normalidad: crea grupos, paga cenas, declara
pagos, contrae deudas. Su Modo Personal existe desde el primer arranque
(`ensure_personal_scope`, medido en la frontera HTTP §14) aunque la app no se
lo enseñe; y como el modelo escribe la **caja** del pagador en su Personal en
la misma transacción que el gasto (F3, F9), esa historia ya está allí. Medido
sobre `main` = `e2f7bee` con una cuenta que sólo usó Grupos (pagó 3000 entre
dos; otro pagó 5000 entre dos): al abrir Personal encuentra **Disponible
−3000**, un movimiento («Cena», `group_expense`), **Gastos 4000** en
estadísticas (sus dos cuotas), dos filas de «mis cuotas» y **−1000 en
Deudas**.

Tres vías, ninguna copia de otra:

| Vía                                                                                         | Quién la escribe                                                                                                               | Dónde se lee                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Caja**: `core.effect.balance_amount` con `scope_id` = mi Personal                         | `record_group_expense` (pagador), `record_group_payment` (pagador −, receptor +), `sec.incorporate_participant_cash` (asociar) | `api.personal_balance`, `api.personal_effect`, `api.personal_operation` (y `personal_operation_version`, `observed_balance`), y el writer: `sec.derive_balance` |
| **Cuota económica**: `economic_amount` con participante, en el grupo, atribuida por vínculo | nadie la copia: es lectura                                                                                                     | `sec.my_shared_expense_shares` → `api.personal_statistics` y `api.personal_expense_share`; `api.claimed_dimension()`                                            |
| **Deuda**: `debt_amount` en el grupo, atribuida por vínculo                                 | idem                                                                                                                           | `api.group_summary.net_position`, `api.group_pending_pair` (Deudas de Inicio); `api.claimed_dimension()`                                                        |

Dos hechos del modelo que esta decisión aprovecha, ambos medidos:

- **La deuda nunca entra en el saldo.** Un Disponible de «−80 € porque debo
  80» no puede ocurrir hoy; lo que sí ocurre es «−120 € porque pagué la
  cena».
- **Un efecto no tiene instante propio.** `core.effect` no lleva `created_at`;
  cuelga de una versión, que cuelga de una operación con su `created_at`. La
  caja que `incorporate_participant_cash` incorpora al asociar un fantasma
  **cuelga de la versión original** de la operación original: la asociación
  no crea operación ninguna (medido: `operations_created_after_cutoff = 0`).
  Un corte por operación es, por tanto, estructural: no depende de cuándo se
  incorporó nada.

El producto no quiere decidir esto implícitamente: la primera vez que esa
cuenta abre Personal, Nomey pregunta.

## Decisión

### §1 · Una decisión, del usuario, una sola vez, persistida

Un hecho por Modo Personal, **`core.personal_start`**:

| Columna             | Qué es                                                                  |
| ------------------- | ----------------------------------------------------------------------- |
| `scope_id`          | PK → `core.scope` de tipo `personal`                                    |
| `mode`              | `include` \| `fresh`                                                    |
| `started_at`        | el instante del corte, **hora de servidor** (`now()` de la transacción) |
| `automatic`         | `true` si lo resolvió el primer acceso sin historia (§2); informativo   |
| `decided_by`        | el dueño del ámbito                                                     |
| `client_command_id` | la clave de idempotencia del comando (F09/ADR-002)                      |

**Insert-only.** Ni `update` ni `delete` para ningún rol: no hay «volver a
decidir». Un solo escritor, `api.start_personal_scope(payload)`, comando de
provisioning bajo `nomey_provisioner` con `core.provisioning_command`: replay
con la misma clave → el resultado original; clave nueva con el **mismo** modo
ya decidido → el resultado existente (`already_processed: true`, idempotente
por estado, como `ensure_personal_scope`); clave nueva con **otro** modo →
`PERSONAL_START_DECIDED · 409`. El comando toma el cerrojo del ámbito
personal (`sec.lock_scopes`, el mismo que el writer toma para escribir caja en
ese Personal), así que una decisión y un gasto de grupo que toque esa caja se
serializan en un orden que los instantes reflejan.

### §2 · Cuándo se pregunta, y cuándo se resuelve solo

La cuenta debe **proceder de una sesión Invitado**. Lo que perdura después
de convertir no es un claim: es un hecho que Nomey escribe cuando es cierto.
`api.ensure_personal_scope` lee `is_anonymous` del JWT (medido: llega a SQL
como `request.jwt.claims`) y, al **crear** el ámbito bajo una sesión anónima,
deja **`core.scope.provisioned_as_guest = true`**. Nunca se pone a `false`.

Publicado por el servidor (en el resultado de `ensure_personal_scope` y en
`api.personal_scope`): `provisioned_as_guest`, `start_mode` (`null` mientras
no hay decisión) y `needs_start_decision` = `provisioned_as_guest` ∧ sin
decisión ∧ **historia previa relevante** (`sec.personal_group_history_exists`:
algún efecto de origen grupo en su Personal, o algún efecto de grupo
atribuido a la cuenta por vínculo — cuota o deuda).

Al **primer acceso** de una cuenta con `provisioned_as_guest` y sin decisión:

- **A · con historia relevante** → la pantalla de §6; el usuario elige
  `include` o `fresh`.
- **B · sin historia relevante** → no se pregunta; el cliente envía
  `start_personal_scope({ mode: 'include', automatic: true })` al montar
  Personal, y el hecho queda persistido igual. **Así la pregunta no puede
  aparecer días después**, cuando llegue la primera actividad de grupo: la
  decisión ya está tomada. El servidor **rehúsa** un `automatic` si en ese
  instante sí hay historia (`PERSONAL_START_DECISION_REQUIRED · 409`) —el
  cliente vuelve a leer y pregunta—, de modo que la autoridad sigue en el
  servidor y ningún GET escribe nada.

Una cuenta que no procede del Invitado no ve la pantalla ni escribe el hecho:
el comando responde `PERSONAL_START_NOT_APPLICABLE · 409`. Su Personal es el
de siempre, sin cambios.

### §3 · Qué significa «empezar desde cero»: un punto de inicio, no un borrado

Con `mode = 'fresh'`, una operación **cuenta para el Personal** si y sólo si
**no es de origen grupo** o **fue creada en o después de `started_at`**.
«Origen grupo» es estructural: la operación tiene algún efecto en un ámbito
de tipo `group` (en cualquiera de sus versiones). Con `include`, o sin
decisión, **toda** operación cuenta: la definición anterior es el caso
particular.

Ese predicado es **una** función, `sec.counts_in_personal(scope, operation)`,
y la usan **todas** las lecturas del ámbito personal y la definición del
saldo que usa el writer:

| Respeta el corte                                                                                                                                                                                           | No lo respeta, a propósito                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `api.personal_balance`, `api.personal_effect`, `api.personal_operation` (y por composición `personal_operation_version`, `observed_balance`, las categorías de gastos personales de `personal_statistics`) | `api.group_summary`, `api.group_pending_pair`, todo Grupos: la historia real de Grupos es intacta |
| `sec.my_shared_expense_shares` (→ `personal_statistics.expense_total` y categorías, `personal_expense_share`)                                                                                              | `api.claimed_dimension()`: atribución (F03/ADR-013), no presentación del Personal                 |
| **`sec.derive_balance`**: la cifra contra la que `record_adjustment` deriva el delta de un `target_balance` y la que `observe_balances` fotografía                                                         | Deudas de Inicio: viven en los grupos y se leen de allí                                           |

Consecuencias que el producto pidió y que el predicado da sin más reglas:

- **Saldo inicial 0 aunque deba 80**: la caja anterior queda fuera; la deuda
  nunca estuvo en el saldo y sigue en Deudas.
- **Un pago posterior de esa deuda entra**: es una operación nueva
  (`created_at ≥ started_at`): Disponible −80, movimiento en historial, deuda
  a cero en el grupo.
- **Un gasto o pago de grupo posterior entra entero**: caja, cuota, categoría.
- **Una corrección o anulación posterior de una operación anterior sigue
  fuera**: es una versión nueva de la **misma** operación; Grupos y Deudas
  cambian con normalidad. Sin este criterio, editar un gasto antiguo lo
  resucitaría en Personal.
- **Asociar o reclamar después de `started_at` a un participante con historia
  anterior no la resucita**: la caja incorporada cuelga de las operaciones
  originales (medido); las posteriores entran.
- **Nada se borra, nada se compensa**: ni un ajuste de apertura, ni una
  versión, ni una fila menos.

### §4 · Por qué el corte va dentro de `sec.derive_balance`

Si la vista dijera 0 y el writer siguiera viendo −3000, el primer ajuste por
objetivo del usuario derivaría un delta contra una cifra que él no ve, y la
observación (`balance_before`/`balance_after`) contradiría al Disponible en
pantalla. La fuente de verdad del saldo personal tiene que ser **una**
función; el predicado vive en ella y las vistas la reproducen. Un check lo
mide: `personal_balance = derive_balance` antes y después de un ajuste sobre
un Personal con `fresh`.

### §5 · El instante: `core.operation.created_at` frente a `started_at`

- **No `effective_date`**: la elige el usuario, es retroactiva y editable. Un
  gasto registrado mañana con fecha de la semana pasada quedaría fuera, y
  re-fechar uno antiguo lo metería. Rompería «sólo la historia anterior».
- **No la versión vigente** (§3): la edición no cambia de lado.
- **No los conceptos existentes**: `core.link_baseline` (F10/ADR-001 §3) es un
  punto congelado, pero por instancia de vínculo y grupo, y sin lector de
  producto por decisión; `participant_period.valid_from` es elegibilidad por
  fecha; `balance_observation` es por versión. Ninguno significa esto.
- **Sí `created_at` de la operación**: un instante de servidor, inmutable,
  que nadie edita, y el único que las tres vías comparten (la cuota y la caja
  cuelgan de la misma operación).

Ambos instantes son `now()` de su transacción. Una decisión y un gasto de
grupo concurrentes que toquen la misma caja se serializan por el cerrojo del
ámbito (§1) y el resultado es siempre un orden serial que los instantes
reflejan: si el gasto empezó antes, queda antes del corte; si empezó después,
después. Medido con dos sesiones reales (`scripts/personal-start-race-evidence.sh`).

### §6 · La pantalla

En Inicio, para una sesión con cuenta (nunca un invitado), cuando el ámbito
resuelto dice `needs_start_decision`. Ocupa el lugar del Personal; Grupos y
Perfil siguen accesibles. Título **«¿Cómo quieres empezar tu Modo
Personal?»**; cuerpo **«Ya tienes movimientos de tus grupos. Puedes incluirlos
en tu Modo Personal o empezar desde cero. Tus deudas pendientes seguirán
disponibles en ambos casos.»**; dos opciones excluyentes:

- **Incluir mis movimientos de grupos** — «Tu saldo, historial y estadísticas
  tendrán en cuenta también los movimientos que ya hiciste en tus grupos.»
- **Empezar desde cero** — «Tus movimientos anteriores de grupos no contarán
  en tu saldo, historial ni estadísticas del Modo Personal. Solo conservarás
  las deudas que sigan pendientes.»

y **«Continuar»**, deshabilitado hasta elegir. La palabra «migrar» no aparece.
El cliente no guarda ningún estado de «ya decidido»: la siguiente lectura del
ámbito lo dice.

## Alternativas consideradas

- **No preguntar y mantener el comportamiento actual (siempre incluir).**
  Rechazada por producto: es decidir implícitamente por el usuario.
- **Un ajuste de apertura** que compense la caja anterior. Rechazada: no saca
  los movimientos del historial ni de las estadísticas, deja un movimiento
  fantasma en el historial, y desplaza el problema a la cuota; el filtrado
  seguiría haciendo falta.
- **Cortar por `effective_date`.** Rechazada (§5): retroactiva y editable.
- **Cortar por versión** («la versión vigente se creó después del corte»).
  Rechazada (§3): editar un gasto antiguo lo resucitaría.
- **Un booleano de cliente** para «ya preguntado». Rechazada: no es durable,
  no es autoridad, y otro dispositivo volvería a preguntar.
- **Escribir el auto-`include` desde una lectura** (que `ensure_personal_scope`
  lo decida sola al primer acceso). Rechazada: convertiría un arranque en una
  escritura implícita sin clave ni intención; el comando explícito con
  `automatic: true` deja el hecho persistido con la misma disciplina que los
  demás y con el servidor decidiendo si procede.
- **No cerrar el caso «sin historia al primer acceso»** (preguntar cuando
  aparezca actividad). Rechazada: la pregunta llegaría días después de
  empezar a usar Personal, cuando ya no tiene sentido.

## Consecuencias

- **Migración `20260919120000_personal_start`**: `core.scope.provisioned_as_guest`;
  `core.personal_start` con su RLS y grants mínimos (select del dueño y del
  provisioner; insert sólo del provisioner sobre su propio ámbito; nada de
  update/delete); `sec.counts_in_personal`, `sec.personal_group_history_exists`;
  `api.start_personal_scope`; `api.ensure_personal_scope` (marca y publica);
  `sec.derive_balance`, `api.personal_balance`, `api.personal_effect`,
  `api.personal_operation`, `sec.my_shared_expense_shares` y
  `api.personal_scope` recreados con el predicado. Sin datos que migrar: sin
  fila, todo lee como antes, y los 31 checks anteriores siguen valiendo tal
  cual.
- **Cuentas convertidas antes de esta migración** (ninguna en producción; en
  local, una) no tienen la marca: nunca verán la pantalla y su Personal es el
  de siempre. Aceptado y documentado.
- **`api.personal_scope` y el resultado de `ensure_personal_scope` crecen** con
  tres campos; `src/types/database.ts` se regenera.
- **Lo que un `fresh` deja fuera no es recuperable**: la decisión es una y no
  se revierte (no hay «volver a incluir»). Es el precio de que no exista un
  reset y de que la pregunta se haga una sola vez. La pantalla lo dice en
  su copy y el ADR lo fija.
- **Una lectura más por efecto** en las vistas del Personal y en
  `derive_balance` (la operación y, con `fresh`, sus ámbitos). Medido en los
  checks sin cambio apreciable; sin fila el `case` corta en la primera rama.
- **La observación de saldo de operaciones anteriores al corte** conserva sus
  cifras de entonces: es historia, y `observed_balance` no las publica porque
  cuelga de `personal_operation`.
- **Checks nuevos:** `supabase/checks/personal-start.sql` (§2 A/B, §3, §4,
  §5, idempotencia y autorización, guardas de catálogo), frontera HTTP §15
  (invitado real → conversión → decisión con JWT real) y una carrera real de
  dos sesiones. Cliente: pantalla, servicio y guardia, con sus tests
  estructurales y puros.
