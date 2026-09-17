# Cobertura del modelo de datos · auditoría de cierre de la Fase 3

> **Evidencia de un criterio de cierre, no una decisión.** El roadmap exige, para
> cerrar F3, que **cada concepto de [`data-model.md`](data-model.md) quede
> mapeado a: hecho persistido · derivable · vista · temporal/runtime · o decisión
> aplazada con su motivo**. Este documento es esa auditoría.
>
> **No decide nada y no rehace arquitectura.** Si contradice a
> [`data-model.md`](data-model.md) o a un ADR, mandan ellos.

Escrita el **2026-08-27**, al cerrar la Fase 3 con `main` en `3787901`.

## Las cinco categorías

| Categoría      | Significa                                                                      |
| -------------- | ------------------------------------------------------------------------------ |
| **Persistido** | Hay una relación física en `core` que lo almacena                              |
| **Derivable**  | Se calcula de lo persistido. **No hay caché económica en v1** (F03/ADR-010 §1) |
| **Proyección** | Existe como vista o función de lectura, hoy                                    |
| **Runtime**    | Vive en la frontera autoritativa o en la RLS; no es un dato almacenado         |
| **Aplazado**   | Decidido que **no** pertenece a F3, con su fase o decisión de destino          |

**Lo aplazado no se implementa aquí.** Cada entrada dice qué es, por qué no es de
F3, y dónde queda.

---

## 1 · Operación y efecto (§1)

| Concepto                                       | Categoría      | Dónde                                                   |
| ---------------------------------------------- | -------------- | ------------------------------------------------------- |
| Operación: identidad, clase, autoría, instante | **Persistido** | `core.operation`                                        |
| Versión inmutable y su linaje                  | **Persistido** | `core.operation_version`                                |
| Vigencia                                       | **Persistido** | `operation.current_version_id` (F03/ADR-010 §4)         |
| Efecto y sus tres dimensiones                  | **Persistido** | `core.effect` — saldo · económica · deuda               |
| Ámbito, clase contable, moneda del efecto      | **Persistido** | Cabecera de `core.effect`                               |
| Efectos que cuentan económicamente             | **Proyección** | `core.current_effect` (F03/ADR-010 §9)                  |
| Visibilidad de un efecto                       | **Runtime**    | RLS por membresía del ámbito; no es columna             |
| Aplicación inmediata, sin estados intermedios  | **Runtime**    | Una transacción por operación (F03/ADR-006 §7)          |
| Concepto y hora de un movimiento               | **Persistido** | `core.movement_detail` + `effective_time` (F06/ADR-002) |
| Categoría de un gasto                          | **Persistido** | `core.expense_category`, por versión (F06/ADR-009)      |
| Catálogo de categorías, sistema y propias      | **Persistido** | `core.category` (F06/ADR-003)                           |

---

## 2 · Ámbitos financieros (§2)

| Concepto                                        | Categoría      | Dónde                                                    |
| ----------------------------------------------- | -------------- | -------------------------------------------------------- |
| Los tres ámbitos                                | **Persistido** | `core.scope.kind`, vocabulario cerrado                   |
| Propiedad durable del Modo Personal             | **Persistido** | `core.scope.owner_user_id` (F03/ADR-013)                 |
| Moneda base del ámbito                          | **Persistido** | `core.scope.base_currency_definition_id`                 |
| Inmutabilidad de la moneda base tras la 1.ª op. | **Runtime**    | Estructural: FK compuesta de `core.effect`               |
| Saldo de un ámbito                              | **Derivable**  | Suma de `balance_amount` sobre la proyección canónica    |
| Estadísticas por ámbito                         | **Derivable**  | Solo `ingreso` y `gasto`, lista de admitidos             |
| `Disponible actual` · `Disponible tras saldar`  | **Derivable**  | F03/ADR-010 §1: derivados sin excepción, sin caché en v1 |

> **Ninguno de los derivados tiene vista todavía, y es deliberado.** El handoff
> §11 bis lo decidió: su API pertenece a las fases que los consumen, y F3 solo
> debía demostrar **el camino** `core → security_invoker → texto → JSON string`.
> `api.personal_effect` lo demuestra.

**Aplazado — atributos de Grupo y de Modo Pareja.**
Nombre, ajustes y ciclo de vida de un Grupo; saldo común y estado del Modo
Pareja. → No son de F3 porque el roadmap los asigna a sus propias fases y F3
diseña el núcleo «sabiendo que hay tres ámbitos», no construyendo los tres. →
Quedan en las fases de Grupo y de Modo Pareja, por migración.

---

## 3 · Clases contables (§3)

| Concepto                                                 | Categoría      | Dónde                                                 |
| -------------------------------------------------------- | -------------- | ----------------------------------------------------- |
| `ingreso · gasto · transferencia · ajuste · liquidación` | **Persistido** | `core.effect.accounting_class`, vocabulario abierto   |
| Qué clases alimentan estadísticas                        | **Derivable**  | `src/domain/effects/effect.ts`, lista de admitidos    |
| Transferencia interna y externa                          | **Persistido** | Clases de operación propias, con sus funciones        |
| Transferencia ≠ liquidación                              | **Runtime**    | Efectos separados en la misma versión; no se fusionan |
| Una liquidación no sobrepasa lo pendiente                | **Runtime**    | `record_debt_settlement`, tras el lock                |
| Una corrección no deja pendiente negativo                | **Runtime**    | `record_group_expense`, tras el lock                  |

~~**Aplazado — `ingreso` no tiene ruta de escritura.**~~
**RESUELTO en la Fase 6.B.** `api.record_personal_income` es la octava función:
saldo positivo y económica positiva sin participante, con sus vectores
compartidos. Como se anticipó, el vocabulario abierto no exigió cambiar nada de
lo migrado — [F06/ADR-002](../adr/F06/ADR-002-version-content-and-time.md).

---

## 4 · Escenarios resueltos (§4)

| Escenario                                            | Estado                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 · 4.2 · 4.3 · 4.4 · 4.5 · 4.6 · 4.7 · 4.8 · 4.11 | **Ejecutables** por las siete funciones. **4.6 y 4.8 cambian de contrato en F12.A0** (propuesta + aceptación, dos voluntades; F12/ADR-002/003): los efectos finales son los mismos; el writer de F3 se recrea al implementarlos |
| «gasto de grupo con tres monedas»                    | **Aplazado** — necesita FX (§7 de este documento)                                                                                                                                                                               |
| 4.9 · 4.10 · 4.12 · 4.13 · 4.14                      | **Aplazado** — Modo Pareja                                                                                                                                                                                                      |

**Aplazado — Modo Pareja (4.9, 4.10, 4.12, 4.13, 4.14).**
Gasto con saldo común, financiación personal de un gasto de pareja, retirada
ordinaria, reparto final bilateral y su corrección. → No es de F3 por dos
razones, y la segunda es la que manda: el roadmap lo asigna a su fase, y **el
invariante 18 exige un ciclo de vida de `Cierre`** —una transición que congela la
actividad y bloquea las retiradas unilaterales— que ninguna decisión de F3 ha
diseñado. Escribir en un `couple` sin esa maquinaria podría saltarse esa
protección, así que las siete funciones se restringen a `personal` y `group`
explícitamente, y no por omisión. → Queda en la fase de Modo Pareja, que deberá
traer el estado del ámbito, la bilateralidad y el reparto final.

> **El modelo ya lo soporta sin cambios**: `scope.kind` incluye `couple`, y el
> reparto final reutiliza `exact_amounts` (F03/ADR-010 §5). Lo que falta es
> **producto**, no estructura.

---

## 5 · Reparto de un gasto de grupo (§5)

| Concepto                                      | Categoría      | Dónde                                                   |
| --------------------------------------------- | -------------- | ------------------------------------------------------- |
| Método de reparto y pagador contextual        | **Persistido** | `core.split`                                            |
| Participante, ordinal, declarado y resuelto   | **Persistido** | `core.split_participant`                                |
| Orden estable de la operación                 | **Persistido** | `split_participant.ordinal`                             |
| Algoritmo de mayor resto y su desempate       | **Runtime**    | `sec.resolve_split` + `src/domain/split/`               |
| Participación calculada en cero               | **Persistido** | `resolved_amount = 0`, se conserva                      |
| El pagador puede no tener Modo Personal       | **Runtime**    | Se deriva del vínculo; si no hay, no hay efecto de caja |
| «Todo reparto tiene al menos un participante» | **Runtime**    | Invariante de la frontera, no de las tablas             |

---

## 6 · Participantes y ciclo de vida (§6)

| Concepto                | Categoría      | Dónde                                                  |
| ----------------------- | -------------- | ------------------------------------------------------ |
| Participante del grupo  | **Persistido** | `core.participant`, contextual                         |
| Usuario vinculado       | **Persistido** | `core.participant_user_link`                           |
| Membresía activa        | **Persistido** | `core.membership`, presencia pura                      |
| Elegibilidad histórica  | **Persistido** | `core.participant_period`                              |
| Participante histórico  | **Derivable**  | Los efectos apuntan al participante; permanece siempre |
| Reclamación retroactiva | **Proyección** | `api.claimed_dimension()` (F03/ADR-013)                |

**~~Aplazado~~ Resuelto en F9 — el mecanismo de claim.** La prueba es una
invitación válida (F09/ADR-004); reclamar es vincular más membresía, sin tocar
hechos; la rectificación propia (F09/ADR-006), la asociación de un fantasma
(F09/ADR-009) y la reincorporación (F09/ADR-010) también están.
`core.participant_user_link` la escriben `create_group` y `redeem_invitation`,
`leave_group` la **termina** (`ended_at`, `departure_id`: activo → histórico) y
`redeem_invitation` con `rejoin` la reactiva (F10/ADR-003; quien salió es
historia, no un participante sin cuenta), y **ninguna función la borra**: la
identidad es permanente (F10/ADR-002; el `unclaim` de F9 y el `unlink` de F10.A2 se retiraron); cada instancia lleva `link_id` y `origin_command_id`, con su `S0` y su línea base (`core.link_baseline_subject`, `core.link_baseline`) como auditoría. **Cerrado por
[F10/ADR-004](../adr/F10/ADR-004-identity-scope-closure.md)**: no hay cesión
de identidad entre cuentas ni fusión nueva (cuenta ↔ cuenta, fantasma ↔
fantasma); fantasma → cuenta es reclamar o asociar; las cadenas de fusión son
un invariante prohibido. **Revocar el vínculo de otro está prohibido** por
principio ([`phase-10-opening.md`](phase-10-opening.md)).

~~**Aplazado — acceso residual.**~~
**CERRADO en F9 y confirmado en F12.A0 (2026-09-17).** Nadie sale de un grupo
con neto ≠ 0 (F09/ADR-007 C5/C8), así que no existe «quien abandona con saldo
pendiente»; quien salió conserva sólo el acceso acotado a sus propios pagos
(F09/ADR-007 C6) y su vínculo histórico (F10/ADR-003). F12 no lo reabre.

---

## 7 · Correcciones y vigencia (§7)

| Concepto                               | Categoría      | Dónde                                        |
| -------------------------------------- | -------------- | -------------------------------------------- |
| Corregir crea versión nueva            | **Persistido** | `core.operation_version` con su predecesor   |
| Atribución por versión                 | **Persistido** | `operation_version.created_by`               |
| Contrato de derivación de cada versión | **Persistido** | `operation_version.economic_rules_version`   |
| Solo cuenta la versión vigente         | **Proyección** | `core.current_effect`                        |
| Quién puede corregir                   | **Runtime**    | Membresía actual del ámbito (§7, 2026-08-26) |
| El predecesor es la vigente anterior   | **Runtime**    | Sale de la fila bloqueada (F03/ADR-008 §11)  |
| Elegibilidad en la fecha efectiva      | **Runtime**    | `sec.assert_participant_eligible`            |

**Aplazado — previsualización de una corrección.**
F03/ADR-010 §7 exige poder mostrar el resultado nuevo antes de confirmarlo. → No es
de F3: es una capacidad de **cliente**, y F3 no construye pantallas.
`src/domain/` ya conserva el cálculo para hacerlo sin conexión. → Queda en la
fase que construya la pantalla de corrección.

~~**Aplazado — anulación o revocación de una operación.**~~
**RESUELTO en la Fase 6.C** por [F06/ADR-006](../adr/F06/ADR-006-annulment.md): una
**versión nueva sin efectos**, con `current_version_id` como única autoridad de
vigencia y **sin borrar nada**. **El `UNIQUE (operation_id, supersedes_version_id)`
sigue sin añadirse**, y a propósito: F03/ADR-008 §11 reservó ese invariante a la
frontera autoritativa, donde hoy lo garantizan el lock y el CAS.

---

## 8 · Permisos y efectos sobre otros (§8)

| Concepto                                       | Categoría      | Dónde                                                                                                                                                           |
| ---------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Derecho a producir los efectos que alcanza     | **Runtime**    | Autorización por clase en la frontera + RLS                                                                                                                     |
| Solo el emisor origina una transferencia       | **Runtime**    | `record_internal_transfer`, invariante 14. **Precisado en F12.A0**: originar = autorizar por propuesta; nace con dos voluntades (F12/ADR-002)                   |
| Solo el deudor paga su deuda por transferencia | **Runtime**    | `record_settlement_by_transfer`, por el vínculo. **Superado en F12.A0**: transferencia de grupo con dos voluntades, cualquier dirección, sin tope (F12/ADR-003) |
| Atribución e historial                         | **Persistido** | `created_by` de operación y de versión                                                                                                                          |

**Aplazado — notificación.**
Toda operación con efectos sobre otro usuario **genera notificación**
(invariante 15). → No es de F3: es infraestructura de entrega —push, correo,
bandeja— y ninguna decisión de F3 la modela. La condición que la dispara **sí**
es derivable hoy de los efectos y su atribución, así que añadirla después no
exige reescribir nada. → Queda sin fase asignada; el invariante permanece.

**Aplazado — bilateralidad y estado `Cierre`.**
Ver §4 de este documento: Modo Pareja.

---

## 9 · Moneda, importe y tipo de cambio (§10)

| Concepto                                 | Categoría      | Dónde                                          |
| ---------------------------------------- | -------------- | ---------------------------------------------- |
| Definición monetaria e identidad estable | **Persistido** | `core.currency_definition` (F03/ADR-001)       |
| Importe original autoritativo            | **Persistido** | `operation_version.original_amount`            |
| Importes derivados por ámbito            | **Persistido** | `core.effect`, en la moneda base del ámbito    |
| Conversión congelada por valor           | **Persistido** | `core.frozen_conversion` (F03/ADR-012)         |
| Importe convertido                       | **Derivable**  | No se persiste: se reproduce de sus entradas   |
| Agregación solo con la misma definición  | **Runtime**    | Estructural: FK compuesta de moneda del ámbito |
| El residuo de redondeo no genera efecto  | **Runtime**    | Una sola conversión, y el cálculo después      |

~~**Aplazado — resolución autoritativa del FX.**~~ _(punto 3 del cierre)_
**DECIDIDO en F11.A** por [F11/ADR-001](../adr/F11/ADR-001-fx-rate-resolution.md): tipos
de referencia del BCE sobre un catálogo propio; el tipo del día X es el último
disponible al comenzar X en hora de Fráncfort, fijado una sola vez —por moneda y
con un límite de una publicación de antigüedad en
[F11/ADR-002](../adr/F11/ADR-002-per-currency-daily-rate.md)—; y
la cobertura es por moneda y par. **La implementación es de F11.B**: hasta entonces, las nueve
funciones de escritura que llaman a `sec.assert_no_conversion` —y
`sec.incorporate_participant_cash`, que lanza el mismo código— siguen exigiendo
que la moneda sea la base de **todos** los ámbitos alcanzados y, si no,
devuelven `CURRENCY_CONVERSION_UNSUPPORTED · 422` sin escribir nada. Tras F11.B
esa negativa sólo desaparece para el gasto y el ingreso personales; las demás
clases la conservan, y el gasto de grupo en moneda extranjera espera a F11.D.

**Aplazado — dos casos de la conversión sin decidir.** _(F11.D)_ → Qué hace
`sec.incorporate_participant_cash` con la caja de un gasto de grupo en otra
moneda pagado por un fantasma que se asocia (hoy rechaza si las bases difieren y,
con bases iguales, escribiría el importe original como si fuera la base), y cómo
se traslada a la base del Grupo un `exact_amounts` declarado en moneda
extranjera. → Ni F11/ADR-001 ni ninguna decisión de producto los cubre. → Quedan
**abiertos en F11.D**, y F11.B no habilita moneda extranjera en
`record_group_expense` hasta decidirlos: es una condición de seguridad, no una
decisión sobre el comportamiento
([seguimiento de F11](phase-11-progress.md#decisiones-abiertas)).

> **Consecuencia medida, todavía vigente:** `core.frozen_conversion` existe, con
> todas sus restricciones, y **no tiene ruta de escritura**. El writer no conserva
> `INSERT` sobre ella, y el check lo comprueba en cada ejecución. Vuelve con
> F11.B.

~~**Aplazado — siembra del catálogo de definiciones monetarias.**~~
**RESUELTO en la Fase 6.A** por [F06/ADR-001](../adr/F06/ADR-001-personal-provisioning.md)
§9: veinte definiciones sembradas por migración, con **identidades UUID fijas y
reproducibles** entre local, CI y producción. La escala sale de los minor units de
ISO 4217, que es la fuente que F02/ADR-001 §3 designa, y **no** de una API externa.

~~**Aplazado — conflicto por configuración monetaria anterior.**~~
**DECIDIDO en F11.A** por [F11/ADR-001](../adr/F11/ADR-001-fx-rate-resolution.md) §10: el
payload lleva la base del ámbito asumida al capturar, y si no es la vigente la
frontera responde conflicto y no convierte. La cola y la revisión ya existen
(F07/ADR-001 §14); la comprobación en la frontera es de F11.B. Hasta entonces el
invariante se sigue respetando por construcción: no existe ninguna conversión.

---

## 10 · Provisioning — el hueco transversal

**Aplazado — creación de Grupos, participantes y periodos.**
No es de F3: F3 cierra **la frontera de escritura contable**, y crear un ámbito no
es un hecho contable. → **Resuelto en F9**: `api.create_group` y
`api.redeem_invitation` crean grupo, participantes, vínculos y periodos.

**El Modo Personal ya no está aquí: lo resolvió la Fase 6.A.**
[F06/ADR-001](../adr/F06/ADR-001-personal-provisioning.md) trae `api.ensure_personal_scope`,
que crea el ámbito **y su membresía en la misma transacción**, bajo un tercer rol
`nomey_provisioner` con la barrera RLS acotada al actor. **No crea participante**,
y eso es una decisión: los efectos personales llevan participante legítimamente
nulo y la atribución es por propiedad (F03/ADR-013). Añadirlo en F10 sería aditivo.

> **Ya no hay clase inalcanzable por falta de provisioning:** desde F9 un
> cliente real crea el grupo y sus participantes por la ruta real, y
> `scripts/http-boundary-check.sh` ejercita la frontera de F9 con JWT real.
> Algunos checks siguen sembrando estados como `postgres` cuando necesitan una
> forma que ningún comando produce (p. ej. el legado de F09/ADR-003).

> **Y un detalle que costó un fallo descubrir:** la **membresía del propio Modo
> Personal no es redundante con la propiedad**. `owner_user_id` es atribución
> económica durable (F03/ADR-013) y `core.membership` es autorización actual
> (F03/ADR-004); la RLS de lectura se resuelve por membresía, así que sin esa fila el
> dueño no ve sus propios efectos. **El provisioning crea las dos**, y un check lo
> comprueba por separado.

---

## 11 · Idempotencia (§11, invariante 19)

| Concepto                                    | Categoría      | Dónde                             |
| ------------------------------------------- | -------------- | --------------------------------- |
| Comando del cliente, unidad de idempotencia | **Persistido** | `core.client_command`             |
| Intención canónica                          | **Persistido** | `client_command.canonical_intent` |
| Replay y conflicto                          | **Runtime**    | `sec.begin_command`               |

**Aplazado — idempotencia de recurrencias, importaciones y backend.**
`core.client_command` es la unidad del **origen cliente**. → No es de F3:
**F03/ADR-007 lo deja expresamente abierto**, y un origen distinto necesita su propia
garantía, no la misma relación. → Queda sin fase asignada; añadirla es aditivo y
no altera `core.client_command`.

---

## 12 · Los 28 invariantes

Ninguno queda sin sitio. Resumen de dónde vive cada uno:

| Invariantes          | Dónde se sostienen                                                                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 · 2 · 22 · 23 · 24 | **Estructural**: `bigint` en unidad mínima, FK de moneda                                                                                                                                                                                                             |
| 3 · 9 · 25           | **Runtime**: reparto y conversión, con vectores compartidos                                                                                                                                                                                                          |
| 4 · 5 · 6 · 8 · 20   | **Runtime**: qué efectos produce cada clase                                                                                                                                                                                                                          |
| 7                    | **Derivable**: lista de admitidos de estadísticas                                                                                                                                                                                                                    |
| 10                   | **Estructural**: el autor no entra en la derivación                                                                                                                                                                                                                  |
| 11                   | **Persistido**: versiones inmutables + proyección canónica                                                                                                                                                                                                           |
| 12                   | **Estructural**: FK compuesta `(scope, currency)`                                                                                                                                                                                                                    |
| 13 · 14 · 15         | 13 y 14 **runtime**; **15 aplazado** (notificación)                                                                                                                                                                                                                  |
| 16 · 17 · 18         | **Aplazados**: Modo Pareja                                                                                                                                                                                                                                           |
| 19                   | **Runtime** para el origen cliente; **aplazado** el resto                                                                                                                                                                                                            |
| 21                   | **Fuera del dominio**: monetización (§12)                                                                                                                                                                                                                            |
| 26 · 27 · 28         | 26 **decidido en F02/ADR-001 §5**; 27 **en F02/ADR-001 §4**, con la regla del día de F11/ADR-001 §3 (por moneda en F11/ADR-002) y las correcciones de F03/ADR-010 §6; 28 **en F11/ADR-001 §10**; implementación en F11.B, F11.C y F11.D; 27 parcialmente estructural |

---

## 13 · Veredicto

**No queda ningún concepto de `data-model.md` en tierra de nadie.** Cada uno está
persistido, es derivable, tiene proyección, vive en la frontera, o está aplazado
**con su motivo y su destino escritos**.

Los aplazados, en una línea cada uno:

| Aplazado                                                                                    | Destino                                                                                                                                 |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Modo Pareja completo (4.9, 4.10, 4.12–4.14)                                                 | Su fase                                                                                                                                 |
| Atributos de Grupo                                                                          | Su fase                                                                                                                                 |
| ~~Resolución autoritativa del FX~~                                                          | **Decidida en F11.A** — F11/ADR-001                                                                                                     |
| ~~Siembra del catálogo monetario~~                                                          | **Resuelto en F6.A**                                                                                                                    |
| ~~Provisioning del Modo Personal~~                                                          | **Resuelto en F6.A**                                                                                                                    |
| ~~Provisioning de Grupos y participantes~~                                                  | **Resuelto en F9**                                                                                                                      |
| ~~Mecanismo de claim~~ · ~~ciclo de vida del vínculo, cesión y fusión fantasma ↔ fantasma~~ | **Resuelto en F9** · **F10, cerrada (ADR-002/003; cesión y fusiones fuera por ADR-004; inicio del Personal tras el Invitado, ADR-005)** |
| ~~Acceso residual~~                                                                         | **Cerrado en F9 (F09/ADR-003, F09/ADR-007 C5/C6/C8) y confirmado en F12.A0**                                                            |
| Notificación                                                                                | Abierto                                                                                                                                 |
| ~~Anulación como concepto distinto~~                                                        | **Resuelto en F6.C**                                                                                                                    |
| Idempotencia de otros orígenes                                                              | Abierto                                                                                                                                 |
| Previsualización de correcciones                                                            | Fase de pantallas                                                                                                                       |
| ~~Clase `ingreso` sin ruta~~                                                                | **Resuelto en F6.B**                                                                                                                    |
| ~~Conflicto por configuración monetaria anterior~~                                          | **Decidido en F11.A** — F11/ADR-001 §10                                                                                                 |
| Caja del fantasma asociado en un gasto de grupo en otra moneda                              | **F11.D**, sin decidir                                                                                                                  |
| `exact_amounts` en moneda extranjera                                                        | **F11.D**, sin decidir                                                                                                                  |
