# F10/ADR-001 — Ciclo de vida de una instancia propia de vínculo cuenta ↔ identidad contextual

- **Estado:** Propuesto
- **Fecha:** 2026-09-14
- **Alcance:** qué es una **instancia** de vínculo entre una cuenta y un
  participante de Grupo, cómo se identifica y de dónde procede, cuándo y cómo
  su titular puede **dejarla**, qué queda escrito al hacerlo, y el principio
  que gobierna todo lo anterior: **ninguna cuenta adjudica unilateralmente la
  identidad de otra cuenta**. Cubre los tres orígenes de vínculo que existen
  —creador, «Soy nuevo» y reclamación— y fija la regla económica que impide
  usar la baja del vínculo para desprenderse de actividad generada bajo él.
- **No cubre:** la cesión consentida de una identidad entre dos cuentas ni la
  fusión de dos participantes sin cuenta (`F10/ADR-002`), la revocación del
  vínculo ajeno, la expulsión, los roles, la identidad anónima ni la
  recuperación global de cuenta (fuera de F10 por decisión de producto,
  [`phase-10-opening.md`](../../architecture/phase-10-opening.md) §1).
- **Supera** de [F09/ADR-006](../F09/ADR-006-unclaim-participant.md): §1 (el
  ancla `claim_command_id` y la restricción a vínculos nacidos de una
  reclamación) y §2 en su caso C (hoy se permite rectificar aunque durante el
  vínculo haya nacido deuda nueva). **Supera** de
  [F09/ADR-009](../F09/ADR-009-associate-ghost-to-own-account.md) el bloqueo
  absoluto `UNCLAIM_BLOCKED_MERGE`. Todo lo demás de ambos sigue en pie.
- **Se apoya en** [F03/ADR-009](../F03/ADR-009-participant-identity.md)
  (participante contextual; el vínculo en su relación; los efectos nombran
  participantes; §10 auditabilidad; §11 «el camino normal no reasigna»),
  [F03/ADR-008](../F03/ADR-008-operation-version-model.md) (versiones
  inmutables; sólo cuenta la vigente), [F03/ADR-010](../F03/ADR-010-persisted-vs-derived.md)
  §9 y §11 (proyección canónica; bloquear antes de leer),
  [F03/ADR-013](../F03/ADR-013-economic-attribution.md) (atribución por
  vínculo), [F09/ADR-001](../F09/ADR-001-group-model-and-permissions.md) §2
  (sin roles), [F09/ADR-002](../F09/ADR-002-client-provisioning-idempotency.md)
  (idempotencia por clave del provisioning), [F09/ADR-003](../F09/ADR-003-leaving-a-group.md)
  (salir conserva el vínculo), [F09/ADR-004](../F09/ADR-004-group-invitations.md)
  (la invitación autoriza; reclamar = vincular), [F09/ADR-008](../F09/ADR-008-departed-obligation-immutable.md)
  (comparación de atribución por versión con ids crudos) y
  [F09/ADR-010](../F09/ADR-010-rejoin-after-departure.md) (volver es por
  vínculo).

## Contexto

### Lo que hay

- `core.participant_user_link (participant_id PK, scope_id, user_id, linked_at, claim_command_id)`.
  Lo crean `create_group`, `redeem_invitation` (`claim` y `new`) y nadie más;
  lo borra sólo `unclaim_participant`, y sólo el propio titular. Todas las
  políticas del provisioner sobre el vínculo y sobre `core.membership` son
  `user_id = sec.request_actor_id()` (medido en el catálogo). `rejoin` no crea
  vínculo: reabre presencia y membresía sobre el que ya había.
- `api.unclaim_participant` (F09/ADR-006) deshace **sólo** un vínculo nacido de
  una reclamación, anclado en `claim_command_id`, si no hay caja vigente en el
  Personal del actor por operaciones del grupo; borra vínculo y membresía y
  deja el hecho `core.participant_unclaim`. Rehúsa si el actor es destino de
  una fusión (`UNCLAIM_BLOCKED_MERGE`).
- La atribución económica de un participante vive en `core.effect` por
  versión: `economic_participant_id/economic_amount`, `debt_debtor/creditor/debt_amount`.
  La caja no nombra participante. Clases: `expense` y `novation` escriben deuda
  **positiva**; `settlement` escribe deuda **negativa** sobre el mismo par
  (medido: `settlement` entre −2000 y −100). Sólo cuenta `current_version_id`.
- `core.participant_merge` (F09/ADR-009) es una superposición **de lectura**:
  `core.current_effect` resuelve `economic_participant_id`, deudor y acreedor
  por `sec.canonical_participant`; los ids persistidos en `core.effect` no
  cambian. Un origen nunca es destino y un destino nunca es origen (medido:
  `PARTICIPANT_MERGED`, `PARTICIPANT_LINKED`).
- Toda función que atribuye algo a un participante de Grupo —`record_group_expense`,
  `record_debt_settlement`, `record_settlement_by_transfer`,
  `record_group_payment`, `annul_operation`, la novación de salida y el núcleo
  de retirada— toma `sec.lock_participant_claims(G)` antes de escribir (rango 1
  del protocolo de `20260912150000`). Los writers personales no nombran
  participantes.

### Lo que falla, medido (F10.A0 y F10.A1, sondas con `ROLLBACK` contra las funciones reales)

1. **El escape ya existe.** Bea reclama a Luis; Edu paga una cena en la que
   Luis participa (Luis>Edu 100); Bea rectifica (`unclaim`, permitido por
   F09/ADR-006 caso C); entra de nuevo como «Bea» y **sale a neto cero**. La
   deuda queda en un fantasma que los miembros sólo pueden retirar sin dinero.
   Para `create` y `new` no hay función, pero el mismo borrado (simulado) deja
   el mismo resultado. Distinguir por origen del vínculo no cierra el agujero:
   lo cierra una regla sobre la **actividad generada bajo la instancia**.
2. **Los timestamps no atestiguan «bajo el vínculo».** `now()` es el inicio de
   la transacción y la serialización real es el cerrojo de rango 1: un gasto
   cuya transacción empezó antes que la reclamación pero entró al cerrojo
   después lleva `created_at < linked_at` aunque se escribió, a todos los
   efectos, bajo el vínculo (la carrera 1b/2a de F09/ADR-006). Y una versión
   nueva no es atribución nueva: corregir el concepto no genera nada.
3. **`|cur| ≤ |base|` es incorrecto con settlements negativos.** Deuda previa
   +100 y settlement previo −100 (par a cero); durante el vínculo el settlement
   se corrige a −50 o se anula: el par vuelve a 50 o a 100, y una comparación
   por valor absoluto lo tomaría por «reducción». Medido en los casos 4, 5 y 7
   de la sonda (deudor y acreedor).
4. **Una línea base resuelta por canónico cambia de significado.** La misma
   versión base decía `eco=100` para Luis; tras asociar a Gus (durante el
   vínculo) la resolución actual dice `eco=200`. Si después se corrige el
   gasto a Luis 150 y Gus 0, la comparación canónica ve 200 → 150 y
   **permitiría** la baja aunque la cuota propia de Luis subió 100 → 150. Con
   ids crudos y el conjunto de sujetos congelado al nacer, la comparación ve
   100 → 150 y bloquea.
5. **Un grupo puede quedar sin ninguna cuenta miembro** (F09/ADR-003 §9): el
   último sale a cero, una invitación viva es la única llave y nadie puede
   revocarla. Es un hecho heredado; este ADR no lo cambia y no crea un caso
   especial del «último miembro».

## Decisión

### §0 · Principio

> **Ninguna cuenta adjudica, revoca ni modifica unilateralmente la identidad
> vinculada de otra cuenta.** Una cuenta modifica **su propia** relación de
> identidad con un participante, y nada más.

Es una decisión de producto (2026-09-14), no una limitación técnica: Nomey no
dispone de una fuente autoritativa externa que permita decidir que una cuenta
tiene más derecho que otra sobre la identidad social de un participante, y
cualquier «revocar el vínculo de otro» es una primitiva de secuestro (revocar y
reclamar). Consecuencias: **no existe** la revocación del vínculo ajeno, la
expulsión ni ningún rol; las disputas sin consentimiento del titular (§13) se
declaran no resolubles con el modelo de confianza actual. El invariante es
estructural (§8) y comprobable en el catálogo.

### §1 · Modelo de instancia

Una **instancia de vínculo** es cada alta de `participant ↔ user`. Empieza al
crearse el vínculo y termina sólo con su baja (§6); **salir del grupo y volver
no la termina** (F09/ADR-003 conserva el vínculo; F09/ADR-010 vuelve por él).

`core.participant_user_link` pasa a tener:

| Columna             | Qué es                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `link_id`           | `uuid not null unique default gen_random_uuid()`. **Identidad estable e inmutable de la instancia.** Ancla del CAS, del replay y de la auditoría. La PK sigue siendo `participant_id`: un participante, un vínculo vigente                                                                                                                      |
| `origin_command_id` | `uuid` **nullable**, FK compuesta `(user_id, origin_command_id) → core.provisioning_command (created_by, client_command_id)`. **Procedencia**: el comando que creó la instancia — `group.create`, `invitation.redeem` con `choice = 'new'` o `'claim'`, y los que F10/ADR-002 añada. Nula sólo si no es demostrable (§11); **nunca se inventa** |
| `claim_command_id`  | **Deja de ser la fuente normativa** y se retira en el estado final (§12). «Nació de una reclamación» = el comando de origen es `invitation.redeem` con `choice = 'claim'`                                                                                                                                                                       |

Identidad y procedencia son dos conceptos y dos columnas: `link_id` responde
«¿qué instancia?», `origin_command_id` responde «¿cómo nació?». No se reutiliza
una para la otra.

**Lo que el cliente observa.** `api.group_participant` publica `link_id`
**sólo en la fila propia** (definer reducido, patrón de `my_claim_command_id`),
nunca en la de otros; `origin_command_id` **no se publica** a nadie. El comando
de baja cita el `link_id` observado.

**CAS y replay.** El comando de baja lleva `{scope_id, participant_id,
link_id}` como intención canónica, idempotente por `core.provisioning_command`
(`command_type = 'participant.unlink'`, F09/ADR-002). Bajo el cerrojo de
identidad, la instancia citada ha de ser **el vínculo vigente del propio actor
sobre ese participante en ese ámbito**; si no —porque no existe, porque es de
otra cuenta, o porque es otra instancia anterior o posterior—, la respuesta es
**uniformemente `LINK_SUPERSEDED · 409`**, sin distinguir cuál de las tres
(§8). El replay de una clave ya resuelta devuelve el resultado original sin
leer ni tocar la instancia que pueda existir ahora (F09/ADR-006 §1, conservado).

### §2 · La regla económica

> **Una cuenta puede dejar una instancia propia de vínculo únicamente si
> hacerlo no le permite desprenderse de actividad económica generada mientras
> esa instancia estuvo vigente. La historia anterior a la instancia no
> bloquea. La caja vigente bloquea siempre.**

#### 2.1 Definiciones

- **Sujetos.** `S0` = conjunto de participantes crudos que **al crear la
  instancia** resolvían hacia P según `core.participant_merge`: P más los
  orígenes ya fusionados en P. `S_now` = lo mismo **al evaluar**. Ambos se
  calculan bajo el cerrojo de identidad del grupo.
- **Atribución de un conjunto de sujetos `S` en una versión `v`**: un mapa de
  **identidad semántica → cantidad firmada**, sobre `core.effect` **con ids
  crudos** (nunca `sec.canonical_participant`), donde la operación `o` es la
  de `v`:

  | Identidad    | Cantidad                                                                    |
  | ------------ | --------------------------------------------------------------------------- |
  | `eco(o)`     | Σ `economic_amount` de los efectos de `v` con `economic_participant_id ∈ S` |
  | `owes(o, C)` | Σ `debt_amount` de los efectos de `v` con deudor ∈ S y acreedor = C (crudo) |
  | `owed(o, C)` | Σ `debt_amount` de los efectos de `v` con acreedor ∈ S y deudor = C (crudo) |

  Las contrapartes son **crudas**: la deuda «a Gus» sigue siendo a Gus aunque
  Gus se fusione después; una fusión de la contraparte no cambia lo que P
  debe. Los pares internos a `S` (P con un origen suyo) **no se excluyen**: se
  comparan como cualquier otro. La caja no forma parte del mapa (2.4).

- **Línea base** de la instancia (§3): para cada operación `o` del grupo cuya
  versión vigente al nacer nombraba a algún sujeto de `S0`, la versión
  `base(o)`. `m_base(o)` = atribución de `S0` en `base(o)`; ∅ si `o` no está
  en la línea base. Las versiones son inmutables, así que `m_base` es
  recomputable e idéntica en cualquier momento posterior.
- **Estado vigente**: para cada operación `o` del grupo cuya versión vigente
  nombra a algún sujeto de `S_now`, `m_cur(o)` = atribución de `S_now` en
  `current_version_id(o)`.
- Ausente = 0 en ambos mapas.

#### 2.2 Capa necesaria — invariante de integridad económica

> **Bloquea si existe una operación `o` y una identidad `k ∈ {eco(o)} ∪ {owes(o, C)}`
> con `m_cur(o)[k] > m_base(o)[k]`.**

Comparación **firmada y direccional**, sin valor absoluto. Cubre exactamente lo
que permitiría el escape: obligación nueva (0 → +x), aumento (+100 → +150),
**reducción que se deshace** (settlement −100 → −50, o −100 → 0 por anulación:
`cur > base`), y consumo nuevo o mayor. Permite: reducción real (+100 → +50,
o desaparición), settlement nuevo (0 → −50: `cur < base`), y la vuelta exacta a
la línea base. `owed` no entra en esta capa: que a P le deban más o menos no
deja a la cuenta desprenderse de nada propio, y un aumento de crédito por
gasto lo captura `eco` o la caja. Esta capa **no se relaja** sin un ADR que
demuestre que el escape queda cerrado de otro modo.

#### 2.3 Política conservadora v1 — decisión de producto, relajable

> **Además, bloquea si existe una operación `o` y una identidad `k` de
> cualquier dimensión con `m_cur(o)[k] ≠ 0` y `m_base(o)[k] = 0`**: nada que
> durante la instancia haya empezado a atribuir algo a esa identidad —una
> operación nueva, o una identidad nueva dentro de una operación histórica—
> bloquea mientras esa atribución siga vigente.

Alcanza a settlements y pagos nuevos que reduzcan una deuda histórica, a
posiciones `owed` nuevas (en operaciones nuevas o por cambio de dirección en
una histórica) y a lo absorbido por una fusión durante la instancia (§4). Es deliberadamente más estricta que 2.2: se prefiere que la cuenta
rectifique o anule primero la actividad que generó ocupando esa identidad, y
que después la suelte; relajar esto con evidencia real es fácil, recuperar
procedencia perdida no. **No** significa que toda modificación de una
operación histórica bloquee: una atribución presente en la línea base puede
disminuir o desaparecer según 2.2. Esta capa puede relajarse por decisión de
producto sin tocar 2.2.

#### 2.4 Caja — guarda separada, sin cambios

Bloquea si existe **caja vigente** en un ámbito personal del actor cuya
operación tenga efectos en el grupo (`sec.unclaim_blocking_operations`,
F09/ADR-006 §2, evidencia D/F): un gasto pagado como ese participante, un pago
en el que fue parte, o caja incorporada por F09/ADR-009. Sin vínculo esa caja
quedaría huérfana y esas operaciones inanulables (`annul_operation` exige
membresía en todos los ámbitos alcanzados). La regla se reutiliza tal cual.

#### 2.5 Casos que fija este ADR (medidos; pasan a checks en A2)

Con P deudor salvo indicación; `base` y `cur` son mapas crudos por operación.

| Caso                                                            | `base`                  | `cur`                   | 2.2                    | 2.3                    |
| --------------------------------------------------------------- | ----------------------- | ----------------------- | ---------------------- | ---------------------- |
| Deuda previa +100 intacta                                       | `E{eco=100 owes:A=100}` | igual                   | pasa                   | pasa                   |
| Deuda previa +100 → +50                                         | `owes:A=100`            | `owes:A=50`             | pasa                   | pasa                   |
| Deuda previa +100 → +150                                        | `owes:A=100`            | `owes:A=150`            | **bloquea**            | —                      |
| Settlement previo −100 → −50                                    | `S{owes:A=-100}`        | `S{owes:A=-50}`         | **bloquea**            | —                      |
| Settlement previo −100 → 0 (anulado)                            | `S{owes:A=-100}`        | `S{∅}`                  | **bloquea**            | —                      |
| Settlement nuevo −50 sobre deuda previa                         | `E{…}`                  | `E{…} S{owes:A=-50}`    | pasa                   | **bloquea**            |
| Operación nueva que nombra a P                                  | ∅                       | `Y{…≠0}`                | **bloquea** (eco/owes) | **bloquea**            |
| Sustitución: la previa desaparece, nace otra del mismo importe  | `X{owes:A=100}`         | `X{∅} Y{owes:A=100}`    | **bloquea**            | —                      |
| Cambio de acreedor (A → B, mismo importe)                       | `X{owes:A=100}`         | `X{owes:B=100}`         | **bloquea**            | —                      |
| Cambio de dirección (P pasa a acreedor)                         | `X{owes:A=100}`         | `X{owed:A=100}`         | pasa (owed)            | **bloquea**            |
| P deja de figurar (cambio de deudor a otro)                     | `X{owes:A=100}`         | `X{∅}`                  | pasa                   | pasa                   |
| Cuota nueva en operación histórica                              | `X{owes:A=100}`         | `X{eco=50 owes:A=100}`  | **bloquea**            | —                      |
| Cuota añadida y revertida exactamente                           | `m`                     | `m`                     | pasa                   | pasa                   |
| Dos cuotas (P y un origen de `S0`) consolidadas en P            | `X{eco=200}`            | `X{eco=200}`            | pasa                   | pasa                   |
| Creada durante y corregida varias veces                         | ∅                       | `Y{…≠0}`                | **bloquea**            | —                      |
| Anulación o corrección que elimina lo nacido durante            | ∅                       | `Y{∅}`                  | pasa                   | pasa                   |
| P acreedor: +100 → +150 (paga más)                              | `E{eco=100 owed:A=100}` | `E{eco=150 owed:A=150}` | **bloquea** (eco)      | —                      |
| P acreedor: settlement recibido −100 → −50                      | `S{owed:A=-100}`        | `S{owed:A=-50}`         | pasa                   | pasa (misma op)        |
| P acreedor: settlement recibido nuevo −50                       | `E{…}`                  | `E{…} S{owed:A=-50}`    | pasa                   | **bloquea**            |
| P acreedor: `owed` preexistente que **sube** (X, Ana: 50 → 100) | `X{owed:Ana=50}`        | `X{owed:Ana=100}`       | pasa                   | pasa (misma identidad) |

Sobre «cambio de dirección» y «settlement recibido que se reduce»: 2.2 los
deja pasar porque no permiten desprenderse de nada propio; el primero lo
bloquea 2.3 por ser una identidad `owed` nueva (y en la práctica un cambio de
pagador hacia P lleva caja, 2.4); el segundo pasa también 2.3 porque la
identidad ya estaba en la línea base. Si producto quisiera que cualquier
cambio de `owed` bloquee, sería una ampliación de 2.3, nunca de 2.2.

**Aumento de un `owed` preexistente — explícito.** Con el contrato de este
ADR, una identidad `owed` que ya estaba en la línea base puede **aumentar**
durante la instancia sin bloquear: `owed(X, Ana) = 50` en la base y `= 100`
ahora **no bloquea por la regla de atribución**, porque la cuenta no se
desprende de deuda ni de consumo propios (2.2 no cubre `owed`) y la identidad
no es nueva (2.3 no aplica). La consecuencia es que, al dejar la identidad,
**ese crédito permanece en el participante fantasma**: es una consecuencia
deliberada del modelo —lo que se protege es que nadie escape de sus
obligaciones, no que nadie renuncie a lo que le deben—, no un fallo del
operador, y **no se cambia el operador para bloquearlo**. Si ese aumento vino
acompañado de caja (P pagó más), la guarda de caja (2.4) sigue mandando.

### §3 · La línea base: qué se persiste, cuándo y bajo qué cerrojo

Dos relaciones insert-only, escritas **en la misma transacción que el vínculo
y bajo `sec.lock_participant_claims(G)`**, que todas las escrituras de
atribución del grupo sostienen: el corte es consistente **sin reloj**.

```
core.link_baseline         (link_id → participant_user_link.link_id,
                            operation_id → operation, baseline_version_id → operation_version,
                            PK (link_id, operation_id))
core.link_baseline_subject (link_id, participant_id → participant, PK (link_id, participant_id))
```

- `link_baseline_subject` = `S0`: P y todo origen con `participant_merge.target = P`
  en ese momento. Se escribe **siempre**, también cuando `S0 = {P}`.
- `link_baseline` = para cada operación del grupo cuya versión vigente nombra
  (económica o deuda) a algún sujeto de `S0`, esa versión. Para `create` y
  `new` es **vacía por construcción**: el participante nace en la misma
  transacción que el vínculo y ningún efecto puede nombrarlo antes. Para
  `claim` es la historia real del participante al ser reclamado.
- Se **conservan tras la baja**: son la historia de la instancia y lo que hace
  demostrable a posteriori su estado original, con independencia de las
  fusiones que ocurran después (Contexto 4).
- Quien crea vínculos —`create_group`, `redeem_invitation` y lo que añada
  F10/ADR-002— escribe la línea base; una guarda de catálogo falla si alguna
  función inserta en `participant_user_link` sin insertar en
  `link_baseline_subject` en el mismo cuerpo.
- La evaluación (2.1–2.3) la hace un definer de `postgres` (cruza RLS para
  leer `core.effect` por versión, como `api.claimed_dimension()`), ejecutable
  sólo por el provisioner, que devuelve las operaciones que bloquean.

### §4 · Fusiones

- **Fusión previa a la instancia.** Los orígenes ya absorbidos están en `S0`;
  su atribución histórica forma parte de la línea base y **no bloquea por
  haber sido fusionada**. Medido (M4): quitar después la cuota del origen es una
  reducción y pasa.
- **Fusión durante la instancia.** La fila `participant_merge` **no bloquea
  por sí misma**. Bloquea si la fusión hace que la instancia absorba atribución
  que no estaba en la línea base (operaciones del origen: `o ∉` base con
  `m_cur ≠ ∅`, 2.3; o cuotas y deudas del origen que elevan `eco`/`owes` de una
  operación de la base, 2.2). Medido (M5): absorber a Gus con historial bloquea;
  un origen sin ninguna atribución económica no bloquea sólo por el hecho.
- Esto **supera** el bloqueo absoluto `UNCLAIM_BLOCKED_MERGE` de F09/ADR-009.
  `participant_merge.merged_by` y la policy de incorporación del writer quedan
  como autoría y como barrera de la incorporación, que sólo ocurre al asociar.

### §5 · Qué significa «dejar mi identidad», por situación

| Situación                                             | Resultado                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create` o `new`, miembro vigente                     | Línea base vacía: **cualquier atribución vigente** a la identidad bloquea (2.2/2.3). Se desbloquea cuando las operaciones se corrigen o anulan hasta que no exista atribución. La ruta «entro como nuevo → genero → dejo → vuelvo limpio» **no es válida**  |
| `claim`, miembro vigente                              | La historia anterior no bloquea; lo nacido durante, el aumento de lo histórico y la caja sí; la reducción de lo histórico y la vuelta exacta a la base pasan. Conserva «reclamé por error a alguien que ya debía» y elimina el escape de F09/ADR-006 caso C |
| Salido del grupo con vínculo (sin membresía)          | **Rehusado** (`NOT_AUTHORIZED`): el vínculo sostiene su Personal (F09/ADR-003 §8) y su reincorporación (F09/ADR-010), y un participante inactivo no es reclamable por nadie. Para soltarlo: volver y dejar                                                  |
| Destino de fusión                                     | Según §4                                                                                                                                                                                                                                                    |
| Con pares de deuda pendientes                         | Los decide la regla económica, no el neto: no se exige neto cero (eso es «salir»)                                                                                                                                                                           |
| Con cuotas, pagos u operaciones corregidas o anuladas | Según 2.2–2.4: sólo la versión vigente cuenta                                                                                                                                                                                                               |
| Identidad sin ninguna atribución vigente ni caja      | Pasa                                                                                                                                                                                                                                                        |

### §6 · Efecto exacto de la baja

En una transacción, tras las comprobaciones de §2 y §8:

| Relación / concepto                                                                                                                                       | Efecto                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.participant_user_link`                                                                                                                              | **Se borra** la fila del actor (`link_id` citado)                                                                                                                                              |
| `core.membership`                                                                                                                                         | **Se borra** la del actor en ese grupo. Es una decisión de producto explícita y sobre uno mismo: dejar la identidad es dejar el grupo; el estado «miembro sin identidad» no se hace alcanzable |
| `core.participant_period`                                                                                                                                 | **Intacta.** No se cierra ni se reescribe; el participante sigue **activo** como fantasma                                                                                                      |
| `core.participant`                                                                                                                                        | Intacto                                                                                                                                                                                        |
| Operaciones, versiones, efectos, `current_version_id`, `client_command`, `split_participant`, `payment_detail`, `payment_allocation`, `participant_merge` | Intactos: reclamar no escribió hechos y dejar tampoco                                                                                                                                          |
| Deudas y cuotas del participante                                                                                                                          | Siguen al participante; dejan de atribuirse a la cuenta **por lectura** (`claimed_dimension`, `personal_expense_share`, `my_group_payment`, `my_group_expense_context`, `my_reopened_debt`)    |
| Caja del Personal                                                                                                                                         | No existe por ese grupo (2.4 lo garantiza)                                                                                                                                                     |
| `core.link_baseline*`                                                                                                                                     | Se conservan                                                                                                                                                                                   |
| Hecho                                                                                                                                                     | `core.participant_unlink` (§7)                                                                                                                                                                 |
| Avisos                                                                                                                                                    | `identity_released` a los miembros que quedan (§10)                                                                                                                                            |
| Invitaciones emitidas por el actor                                                                                                                        | Intactas (como al salir)                                                                                                                                                                       |
| Volver a entrar                                                                                                                                           | Con invitación válida: `claim` (del mismo participante, si sigue disponible, o de otro) o `new`. **Nunca `rejoin`**: ya no hay vínculo                                                         |
| El participante                                                                                                                                           | Vuelve a estar **disponible** (`participant_available`): reclamable por quien tenga invitación, retirable por los miembros (F09/ADR-005)                                                       |

Sin rango 2: la baja no escribe filas de ámbito ni efectos.

### §7 · Auditoría

`core.participant_unclaim` se sustituye por el hecho general, insert-only:

```
core.participant_unlink (
  id                 uuid pk,
  link_id            uuid not null,        -- la instancia exacta; sin FK: el vínculo ya no existe
  participant_id     uuid not null → participant,
  scope_id           uuid not null → scope,
  user_id            uuid not null,        -- titular de la instancia
  unlinked_by        uuid not null,        -- actor
  origin_command_id  uuid,                 -- procedencia, copiada del vínculo (nula si no era demostrable)
  reason             text not null check (reason = 'self'),
  client_command_id  uuid not null unique, -- el comando de baja
  unlinked_at        timestamptz not null default now()
)
```

Con las altas en `provisioning_command`, la línea base y este hecho, la
secuencia de instancias de una cuenta en un grupo es reconstruible: qué
instancia terminó, participante, ámbito, titular, actor, procedencia, comando
e instante. **En F10, `unlinked_by = user_id` siempre**: es un `CHECK` de la
relación y una guarda de catálogo, para que la no adjudicación (§0) sea
comprobable como dato y no sólo como ausencia de función.

### §8 · Seguridad: el invariante y sus capas

> **Ninguna cuenta puede modificar el vínculo ni la membresía de otra.**

| Capa               | Cómo lo sostiene                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Función            | `api.unlink_participant(payload)` (provisioner): clave → cerrojo → membresía del actor (`NOT_AUTHORIZED`) → vínculo **propio** con ese `link_id` (`LINK_SUPERSEDED`) → regla económica → caja → hecho → borrados. Ninguna función de `api` recibe un `user_id`                                                                                                                                |
| RLS                | Las policies existentes del provisioner sobre `participant_user_link` (`insert`/`delete`/`select`) y `membership` (`insert`/`delete`) siguen siendo `user_id = sec.request_actor_id()`; nuevas: `participant_unlink` insert `with check (user_id = actor and unlinked_by = actor)`; `link_baseline*` insert `with check (exists vínculo del actor con ese link_id)`, select sobre las propias |
| Grants             | El provisioner gana `insert` en `participant_unlink` y `link_baseline*` y `select` en `link_baseline*`; **sigue sin `update`** sobre el vínculo y sin `delete` ajeno. `authenticated` no alcanza ninguna de las cuatro relaciones                                                                                                                                                             |
| Definers           | El evaluador económico y el de caja son de `postgres` (cruzan RLS para leer efectos) y sólo los ejecuta el provisioner; el comando corre **bajo** RLS (segunda barrera, E16)                                                                                                                                                                                                                  |
| CAS                | Por `link_id`, uniforme: un `link_id` inexistente, ajeno o sustituido responde **lo mismo**, `LINK_SUPERSEDED · 409`, sin escribir; no se revela si existe, de quién es ni si fue sustituido                                                                                                                                                                                                  |
| Publicación        | `link_id` sólo en la fila propia de `api.group_participant`; `origin_command_id` nunca                                                                                                                                                                                                                                                                                                        |
| Guarda de catálogo | Toda policy de `authenticated` o `nomey_provisioner` sobre `participant_user_link`, `membership`, `participant_unlink` y `link_baseline*` compara una columna de usuario con `sec.request_actor_id()`; no existe `update` sobre el vínculo; `participant_unlink.unlinked_by = user_id`; toda función que inserte vínculo inserta sujetos de línea base                                        |
| HTTP con JWT real  | Una cuenta B intenta la baja con el `link_id` de A: `LINK_SUPERSEDED`, nada escrito; B intenta borrar la membresía de A por cualquier vía de `api`: no existe                                                                                                                                                                                                                                 |

### §9 · Concurrencia

Orden, según el protocolo real de `20260912150000`: **0** clave de
idempotencia (`provisioning_command`) → **1** `sec.lock_participant_claims(G)`
→ lecturas (membresía, vínculo, `S0`/`S_now`, línea base, versiones vigentes,
caja) → escrituras (hecho, borrados, avisos). Sin rangos 2 ni 3. La línea base
se toma en el mismo orden al crear el vínculo. `unlink_participant` entra en
la lista de `group-identity-lock.sql`, junto con `associate_participant`.

Carreras que A2 mide con dos sesiones reales, en los dos órdenes, y cuyo
resultado debe coincidir con un orden serial: baja ↔ gasto nuevo que nombra a
P · baja ↔ corrección que sube, baja o quita a P · baja ↔ settlement o pago
con P como parte · baja ↔ anulación de una operación que nombraba a P · baja ↔
`leave` · baja ↔ `rejoin` (imposible tras la baja) · baja ↔ `claim` ajeno de P
(el segundo ve el estado del primero) · baja ↔ `associate` de un fantasma a P
· baja ↔ `retire` de P por otro miembro · doble baja con la misma clave
(replay) y con clave distinta (`LINK_SUPERSEDED`) · replay contra una
instancia posterior (otra cuenta reclamó a P después): devuelve el resultado
original y no toca la nueva instancia.

### §10 · Avisos

`kind` nuevo en `core.group_notice`: **`identity_released`**. Destinatarios:
los miembros que quedan, **excluido el actor**. `subject_id` =
`participant_unlink.id`; `api.group_notice` resuelve `participant_id` y
`participant_display_name` como hace con `departure`, y `by_me` como siempre.
**No publica** `user_id`, `link_id`, procedencia ni nada de la cuenta que lo
dejó más allá de lo que el grupo ya conocía: el nombre contextual del
participante y que vuelve a estar disponible. No se reutiliza `departure`:
diría «salió» de un participante que sigue activo.

**El aviso forma parte del mismo resultado autoritativo de la baja.** Se
crea **únicamente cuando la baja se materializa por primera vez**, en la
misma transacción y ligado al hecho `participant_unlink` (`subject_id`); un
replay con el mismo `client_command_id` devuelve el resultado original y **no
genera un segundo `identity_released`**; una baja rechazada —por `LINK_SUPERSEDED`,
atribución, caja o autorización— **no genera aviso**, porque no escribe nada.
El constraint o índice concreto que lo haga estructural (una fila por
destinatario y hecho, como el `on conflict` de `departure`) lo decide A2.

### §11 · Vínculos existentes — arquitectura normativa e instrucciones de entorno

**Normativo.** Ningún vínculo existe sin `link_id` ni sin sujetos de línea
base; `origin_command_id` se rellena **sólo** cuando es demostrable a partir
de `provisioning_command` (exactamente un comando candidato del mismo actor y
ámbito), y queda nulo en otro caso; **nunca** se escribe una línea base vacía o
inventada para que una migración pase.

- `create`: la línea base vacía es demostrable por datos
  (`canonical_intent.creator_participant_id` = el participante).
- `new`: la línea base vacía es demostrable por la semántica del único writer
  del comando (`invitation.redeem new` crea el participante en la misma
  transacción); el ADR lo acepta como demostración y A2 lo deja escrito en la
  migración.
- `claim`: la línea base real no es reconstruible sin usar el reloj como
  autoridad. **La migración rehúsa aplicarse** si encuentra un vínculo cuyo
  origen es una reclamación (o no es demostrable) y no tiene línea base.

**Instrucciones de entorno (no normativas).** Medido el 2026-09-14 en la base
local: 14 vínculos, 13 con origen `create`/`new` inequívoco y 1 reclamación.
No hay producción; la base local es material de pruebas manuales que se
reconstruye desde cero en CI. Para ese vínculo se **reinicia o recrea la base
local** (runbook), en vez de mantener un estado legacy artificial en el
esquema.

### §12 · Estado final y transición

Estado final, aprobado: `claim_command_id` retirada del vínculo, del payload y
de `api.group_participant`; `api.unclaim_participant` retirada;
`core.participant_unclaim` sustituida por `core.participant_unlink` (0 filas
en local: no hay historia que conservar fuera de la estructura nueva; si A2
encontrara alguna, se traslada con `reason = 'self'`).

Transición, permitida a A2/A3 si el reparto entre PR lo exige para no dejar
`main` con el cliente roto: `api.unclaim_participant` como **wrapper** sobre la
semántica nueva y `claim_command_id` como columna **derivada** de
`origin_command_id` en la vista, mientras exista **una sola semántica
autoritativa**, **ninguna segunda implementación** y un plazo explícito en la
propia PR para retirar la superficie antigua. El reparto exacto entre A2 y A3
depende del código generado y del cliente y se decide allí.

### §13 · Disputas sin consentimiento

Titular con la cuenta perdida, inactivo, que reclamó por error y no deshace, o
que se niega: **no resolubles** con el modelo de confianza actual, por §0. Lo
que sí existe: revocar la invitación para que nadie más entre; entrar como
«Soy nuevo» dejando la historia en la identidad tomada; corregir gasto a gasto
entre activos mientras el titular sea miembro; y, si sale, F09/ADR-008 congela
lo suyo. Las alternativas y las capacidades que exigirían quedan documentadas
en [`phase-10-opening.md`](../../architecture/phase-10-opening.md) §5.4
(propietario o moderador, quorum, challenge, soporte administrativo,
recuperación externa); ninguna entra en F10.

### §14 · Errores

`PAYLOAD_INVALID · 400` · `NOT_AUTHORIZED · 403` (sin membresía) ·
`LINK_SUPERSEDED · 409` (uniforme, §1/§8) · `UNLINK_BLOCKED_ATTRIBUTION · 409`
con `details.operations` (las operaciones que bloquean por 2.2 o 2.3, con lo
que el actor ya ve como miembro: clase, concepto, importe declarado, fecha) ·
`UNLINK_BLOCKED_CASH · 409` con `details.operations` (2.4; sucede a
`UNCLAIM_BLOCKED_CASH`) · `COMMAND_IN_FLIGHT · 409` · `IDEMPOTENCY_KEY_REUSED · 409`.
Un intento rehusado no escribe nada, tampoco la clave.

## Alternativas consideradas

- **Revocación del vínculo ajeno por cualquier miembro, acotada** (procedencia
  de reclamación, sin caja, con auditoría y avisos). Rechazada por producto:
  aun acotada es una primitiva de secuestro (revocar y reclamar) y no hay
  fuente autoritativa que decida quién «es» un participante.
- **Sólo `unclaim` como está**, sin generalizar. Rechazada: deja el escape de
  F09/ADR-006 caso C y no cubre `create`/`new`.
- **Neto cero para todos los orígenes** como condición. Rechazada: pierde el
  caso B de F09/ADR-006 (historia anterior a la reclamación) y no distingue
  historias distintas con el mismo saldo.
- **`created_at between linked_at and unlinked_at`** como criterio. Rechazada:
  el reloj no atestigua la serialización bajo el cerrojo y una versión nueva
  no es atribución nueva.
- **Comparación por valor absoluto** (`|cur| ≤ |base|`). Rechazada por
  medición: deshacer un settlement negativo pasaría por reducción.
- **Comparación por multiconjunto de cadenas** (F09/ADR-008 tal cual).
  Rechazada como operador: 100 → 50 no es «el mismo elemento» y bloquearía una
  reducción legítima; se conserva como patrón de lectura por versión.
- **Línea base resuelta por `sec.canonical_participant`**. Rechazada por
  medición: una fusión posterior cambia su significado y permite el escape
  (M2).
- **Snapshot semántico** (copiar las atribuciones normalizadas al nacer).
  Rechazada: duplica lo derivable de efectos inmutables, abre dos verdades y
  la pregunta de la contraparte «de entonces» frente a «de hoy». `S0` congela
  lo único que no es inmutable: quién contaba como P.
- **Sello por versión** (`version_link_context`) o **época por ámbito**.
  Rechazadas para esta regla: tocan todos los writers de grupo —que F11
  recrea en paralelo— y siguen necesitando línea base y operador. Quedan como
  extensión posible si alguna necesidad futura exige «bajo qué instancia se
  escribió cada hecho».
- **Reutilizar `claim_command_id` como ancla generalizada**. Rechazada:
  mezcla identidad de instancia con procedencia y significaría cosas que no
  son reclamaciones.
- **Dejar la identidad conservando la membresía** («miembro sin identidad»).
  Rechazada en F10: estado nuevo sin superficie que lo contemple; exigiría un
  comando de adopción de identidad siendo miembro. Registrada como extensión.
- **Permitir la baja a quien salió** (sin membresía). Rechazada: borra su
  historia del Personal, rompe la reincorporación y libera un participante
  que nadie puede reclamar.
- **Bloquear por la mera existencia de una fusión** (`UNCLAIM_BLOCKED_MERGE`).
  Superada: lo que importa es si se absorbió atribución.
- **Línea base vacía «por conservadurismo» para vínculos legacy de
  reclamación.** Rechazada: no es neutra; presentaría la historia anterior
  como nacida bajo el vínculo y rompería el caso legítimo.
- **Regla especial del «último miembro»** al dejar la identidad. Rechazada:
  el estado ya es alcanzable por `leave` (F09/ADR-003 §9); si producto lo
  cambia, es una decisión sobre invitaciones, no sobre identidad.

## Consecuencias

### A favor

- El escape «genero obligación → dejo la identidad → vuelvo limpio» queda
  cerrado para los tres orígenes, sin tocar un solo hecho contable, sin reloj
  y sin depender de la resolución canónica.
- Cada instancia de vínculo tiene identidad, procedencia, línea base y hecho
  de baja: la historia de identidades de una cuenta en un grupo es
  reconstruible y demostrable a posteriori, también tras fusiones.
- La no adjudicación pasa de ausencia de función a invariante comprobable en
  catálogo y como dato (`unlinked_by = user_id`).
- Ningún writer cambia; `core.current_effect` no cambia; F11 no se ve
  afectada.
- Capa necesaria y política v1 quedan separadas: se puede relajar la segunda
  sin debilitar la primera.

### En contra

- Una identidad `create`/`new` con cualquier participación vigente **no puede
  dejarse**; su única salida es corregir o anular, o la cesión de
  F10/ADR-002. Es lo decidido, y hay que decirlo en la interfaz.
- La política v1 bloquea también a quien sólo recibió o hizo un pago o una
  liquidación durante la instancia, y a quien absorbió un fantasma con
  historial: más rechazos de los estrictamente necesarios, a cambio de no
  perder procedencia.
- Un crédito (`owed`) que crece durante la instancia sobre una identidad ya
  presente en la línea base **no bloquea** y se queda en el fantasma al dejar
  la identidad (2.5): deliberado, porque el modelo protege contra escapar de
  obligaciones, no contra renunciar a créditos; la caja, si la hubo, sí
  bloquea.
- Dos relaciones y una columna más; una guarda de catálogo más; el evaluador
  es una consulta por operación que nombra a la identidad (lineal en su
  historial, bajo el cerrojo del grupo).
- Se retira una API y una columna que el cliente usa; la transición debe
  coordinarse entre PR (§12).
- El único vínculo `claim` de la base local no se migra: se reinicia la base
  de desarrollo.
- La disputa sin consentimiento sigue sin salida dentro del producto; queda
  declarada, no resuelta.

### Lo que A2 decide, y sólo esto

Son decisiones de implementación que no cambian el contrato: nombre de las
policies y del definer evaluador; si el evaluador devuelve además el motivo
(2.2 o 2.3) por operación; el texto de los mensajes; cómo se traslada la
matriz de §2.5, M1–M6 y las carreras de §9 a `supabase/checks/` y a
`scripts/`; si `api.unclaim_participant` sobrevive una PR como wrapper (§12);
el orden de las columnas nuevas en `api.group_participant`; la forma exacta de
la guarda de catálogo; el runbook del reinicio local (§11).

### Evidencia que A2 debe producir antes de que este ADR pase a Aceptado

Checks contra las funciones reales: los 19 casos de §2.5 para deudor y
acreedor; M1–M6 (línea base con y sin fusión previa, fusión durante con y sin
atribución absorbida, cadena rehusada); baja de `create`, `new` y `claim` con
el escape rehusado y el caso B permitido; caja (D/E/F de F09/ADR-006); `LINK_SUPERSEDED`
uniforme; `unlinked_by = user_id`; presencia intacta y participante disponible
tras la baja; `rejoin` rehusado y `claim`/`new` permitidos después; aviso
`identity_released` sin datos de la cuenta; guarda de catálogo que falla al
quitar `unlink_participant` o `associate_participant` de la lista del cerrojo,
al añadir un `update` sobre el vínculo o una policy sin `request_actor_id()`;
carreras de §9 con dos sesiones; HTTP con JWT ajeno.
