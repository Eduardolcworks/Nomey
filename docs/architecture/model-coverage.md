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

| Categoría      | Significa                                                                  |
| -------------- | -------------------------------------------------------------------------- |
| **Persistido** | Hay una relación física en `core` que lo almacena                          |
| **Derivable**  | Se calcula de lo persistido. **No hay caché económica en v1** (ADR-013 §1) |
| **Proyección** | Existe como vista o función de lectura, hoy                                |
| **Runtime**    | Vive en la frontera autoritativa o en la RLS; no es un dato almacenado     |
| **Aplazado**   | Decidido que **no** pertenece a F3, con su fase o decisión de destino      |

**Lo aplazado no se implementa aquí.** Cada entrada dice qué es, por qué no es de
F3, y dónde queda.

---

## 1 · Operación y efecto (§1)

| Concepto                                       | Categoría      | Dónde                                               |
| ---------------------------------------------- | -------------- | --------------------------------------------------- |
| Operación: identidad, clase, autoría, instante | **Persistido** | `core.operation`                                    |
| Versión inmutable y su linaje                  | **Persistido** | `core.operation_version`                            |
| Vigencia                                       | **Persistido** | `operation.current_version_id` (ADR-013 §4)         |
| Efecto y sus tres dimensiones                  | **Persistido** | `core.effect` — saldo · económica · deuda           |
| Ámbito, clase contable, moneda del efecto      | **Persistido** | Cabecera de `core.effect`                           |
| Efectos que cuentan económicamente             | **Proyección** | `core.current_effect` (ADR-013 §9)                  |
| Visibilidad de un efecto                       | **Runtime**    | RLS por membresía del ámbito; no es columna         |
| Aplicación inmediata, sin estados intermedios  | **Runtime**    | Una transacción por operación (ADR-009 §7)          |
| Concepto, categoría y hora de un movimiento    | **Persistido** | `core.movement_detail` + `effective_time` (ADR-020) |
| Catálogo de categorías, sistema y propias      | **Persistido** | `core.category` (ADR-021)                           |

---

## 2 · Ámbitos financieros (§2)

| Concepto                                        | Categoría      | Dónde                                                 |
| ----------------------------------------------- | -------------- | ----------------------------------------------------- |
| Los tres ámbitos                                | **Persistido** | `core.scope.kind`, vocabulario cerrado                |
| Propiedad durable del Modo Personal             | **Persistido** | `core.scope.owner_user_id` (ADR-016)                  |
| Moneda base del ámbito                          | **Persistido** | `core.scope.base_currency_definition_id`              |
| Inmutabilidad de la moneda base tras la 1.ª op. | **Runtime**    | Estructural: FK compuesta de `core.effect`            |
| Saldo de un ámbito                              | **Derivable**  | Suma de `balance_amount` sobre la proyección canónica |
| Estadísticas por ámbito                         | **Derivable**  | Solo `ingreso` y `gasto`, lista de admitidos          |
| `Disponible actual` · `Disponible tras saldar`  | **Derivable**  | ADR-013 §1: derivados sin excepción, sin caché en v1  |

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
lo migrado — [ADR-020](../adr/ADR-020-version-content-and-time.md).

---

## 4 · Escenarios resueltos (§4)

| Escenario                                            | Estado                                            |
| ---------------------------------------------------- | ------------------------------------------------- |
| 4.1 · 4.2 · 4.3 · 4.4 · 4.5 · 4.6 · 4.7 · 4.8 · 4.11 | **Ejecutables** por las siete funciones           |
| «gasto de grupo con tres monedas»                    | **Aplazado** — necesita FX (§7 de este documento) |
| 4.9 · 4.10 · 4.12 · 4.13 · 4.14                      | **Aplazado** — Modo Pareja                        |

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
> reparto final reutiliza `exact_amounts` (ADR-013 §5). Lo que falta es
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
| Reclamación retroactiva | **Proyección** | `api.claimed_dimension()` (ADR-016)                    |

**Aplazado — el mecanismo de claim.**
Qué constituye prueba de autorización para vincular un participante con una
cuenta: token de un solo uso, invitación verificada, aprobación de un miembro, o
una combinación. También la revocación, el _unlink_ y la fusión de participantes.
→ No es de F3: ADR-012 fija el **invariante** —el claim exige prueba— y delega
expresamente el mecanismo. → Queda en **F10**, sobre relaciones que ya existen.
`core.participant_user_link` no tiene ruta de escritura por eso.

**Aplazado — acceso residual.**
Qué puede ver y hacer quien abandona un ámbito con saldo distinto de cero. → No
es de F3: ningún ADR lo decide y ninguna relación migrada lo prejuzga. → Queda
abierto en el handoff §11, sin fase asignada.

---

## 7 · Correcciones y vigencia (§7)

| Concepto                               | Categoría      | Dónde                                        |
| -------------------------------------- | -------------- | -------------------------------------------- |
| Corregir crea versión nueva            | **Persistido** | `core.operation_version` con su predecesor   |
| Atribución por versión                 | **Persistido** | `operation_version.created_by`               |
| Contrato de derivación de cada versión | **Persistido** | `operation_version.economic_rules_version`   |
| Solo cuenta la versión vigente         | **Proyección** | `core.current_effect`                        |
| Quién puede corregir                   | **Runtime**    | Membresía actual del ámbito (§7, 2026-08-26) |
| El predecesor es la vigente anterior   | **Runtime**    | Sale de la fila bloqueada (ADR-011 §11)      |
| Elegibilidad en la fecha efectiva      | **Runtime**    | `sec.assert_participant_eligible`            |

**Aplazado — previsualización de una corrección.**
ADR-013 §7 exige poder mostrar el resultado nuevo antes de confirmarlo. → No es
de F3: es una capacidad de **cliente**, y F3 no construye pantallas.
`src/domain/` ya conserva el cálculo para hacerlo sin conexión. → Queda en la
fase que construya la pantalla de corrección.

~~**Aplazado — anulación o revocación de una operación.**~~
**RESUELTO en la Fase 6.C** por [ADR-024](../adr/ADR-024-annulment.md): una
**versión nueva sin efectos**, con `current_version_id` como única autoridad de
vigencia y **sin borrar nada**. **El `UNIQUE (operation_id, supersedes_version_id)`
sigue sin añadirse**, y a propósito: ADR-011 §11 reservó ese invariante a la
frontera autoritativa, donde hoy lo garantizan el lock y el CAS.

---

## 8 · Permisos y efectos sobre otros (§8)

| Concepto                                       | Categoría      | Dónde                                           |
| ---------------------------------------------- | -------------- | ----------------------------------------------- |
| Derecho a producir los efectos que alcanza     | **Runtime**    | Autorización por clase en la frontera + RLS     |
| Solo el emisor origina una transferencia       | **Runtime**    | `record_internal_transfer`, invariante 14       |
| Solo el deudor paga su deuda por transferencia | **Runtime**    | `record_settlement_by_transfer`, por el vínculo |
| Atribución e historial                         | **Persistido** | `created_by` de operación y de versión          |

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
| Definición monetaria e identidad estable | **Persistido** | `core.currency_definition` (ADR-004)           |
| Importe original autoritativo            | **Persistido** | `operation_version.original_amount`            |
| Importes derivados por ámbito            | **Persistido** | `core.effect`, en la moneda base del ámbito    |
| Conversión congelada por valor           | **Persistido** | `core.frozen_conversion` (ADR-015)             |
| Importe convertido                       | **Derivable**  | No se persiste: se reproduce de sus entradas   |
| Agregación solo con la misma definición  | **Runtime**    | Estructural: FK compuesta de moneda del ámbito |
| El residuo de redondeo no genera efecto  | **Runtime**    | Una sola conversión, y el cálculo después      |

**Aplazado — resolución autoritativa del FX.** _(punto 3 del cierre)_
Qué catálogo, qué proveedor, qué granularidad, qué regla de selección y qué
ocurre si no hay tipo exacto para una fecha. → No es de F3: **ADR-003 §4 lo deja
expresamente fuera de alcance y ADR-009 §8 lo declara decisión de producto
pendiente**, añadiendo que este ADR «no atribuye a la frontera de escritura una
resolución automática por catálogo». El servidor **no tiene con qué resolverla**,
y el tipo que aporte el cliente no es autoritativo. → Queda como decisión de
producto, sin fase asignada. Hasta entonces las siete funciones exigen que la
moneda de la operación sea la base de **todos** los ámbitos alcanzados y, si no,
devuelven `CURRENCY_CONVERSION_UNSUPPORTED · 422` sin escribir nada.

> **Consecuencia medida:** `core.frozen_conversion` existe, con todas sus
> restricciones, y **no tiene ruta de escritura**. El writer no conserva `INSERT`
> sobre ella, y el check lo comprueba en cada ejecución. Volverá cuando exista la
> regla, no antes.

~~**Aplazado — siembra del catálogo de definiciones monetarias.**~~
**RESUELTO en la Fase 6.A** por [ADR-019](../adr/ADR-019-personal-provisioning.md)
§9: veinte definiciones sembradas por migración, con **identidades UUID fijas y
reproducibles** entre local, CI y producción. La escala sale de los minor units de
ISO 4217, que es la fuente que ADR-003 §3 designa, y **no** de una API externa.

**Aplazado — conflicto por configuración monetaria anterior.**
Una operación creada bajo otra configuración «entra en conflicto y requiere
revisión» (invariante 28). → No es de F3: exige un estado de conflicto y un flujo
de revisión que ningún ADR modela. → Queda sin fase asignada; el invariante se
respeta por construcción, porque hoy nada reinterpreta en silencio: la FK
compuesta impide cambiar la moneda base con efectos existentes.

---

## 10 · Provisioning — el hueco transversal

**Aplazado — creación de Grupos, participantes y periodos.**
No es de F3: F3 cierra **la frontera de escritura contable**, y crear un ámbito no
es un hecho contable. Además, la creación de un participante y su vínculo dependen
del mecanismo de claim, que es F10. → Queda en **F9** y **F10**.

**El Modo Personal ya no está aquí: lo resolvió la Fase 6.A.**
[ADR-019](../adr/ADR-019-personal-provisioning.md) trae `api.ensure_personal_scope`,
que crea el ámbito **y su membresía en la misma transacción**, bajo un tercer rol
`nomey_provisioner` con la barrera RLS acotada al actor. **No crea participante**,
y eso es una decisión: los efectos personales llevan participante legítimamente
nulo y la atribución es por propiedad (ADR-016). Añadirlo en F10 sería aditivo.

> **Consecuencia que conviene no olvidar:** las tres clases de 7b siguen sin ser
> alcanzables de extremo a extremo por un cliente real, porque necesitan un Grupo
> y participantes. Los checks siembran ese estado como `postgres`. **El Modo
> Personal ya no lo necesita**: el check HTTP crea el suyo por la ruta real.

> **Y un detalle que costó un fallo descubrir:** la **membresía del propio Modo
> Personal no es redundante con la propiedad**. `owner_user_id` es atribución
> económica durable (ADR-016) y `core.membership` es autorización actual
> (ADR-007); la RLS de lectura se resuelve por membresía, así que sin esa fila el
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
**ADR-010 lo deja expresamente abierto**, y un origen distinto necesita su propia
garantía, no la misma relación. → Queda sin fase asignada; añadirla es aditivo y
no altera `core.client_command`.

---

## 12 · Los 28 invariantes

Ninguno queda sin sitio. Resumen de dónde vive cada uno:

| Invariantes          | Dónde se sostienen                                          |
| -------------------- | ----------------------------------------------------------- |
| 1 · 2 · 22 · 23 · 24 | **Estructural**: `bigint` en unidad mínima, FK de moneda    |
| 3 · 9 · 25           | **Runtime**: reparto y conversión, con vectores compartidos |
| 4 · 5 · 6 · 8 · 20   | **Runtime**: qué efectos produce cada clase                 |
| 7                    | **Derivable**: lista de admitidos de estadísticas           |
| 10                   | **Estructural**: el autor no entra en la derivación         |
| 11                   | **Persistido**: versiones inmutables + proyección canónica  |
| 12                   | **Estructural**: FK compuesta `(scope, currency)`           |
| 13 · 14 · 15         | 13 y 14 **runtime**; **15 aplazado** (notificación)         |
| 16 · 17 · 18         | **Aplazados**: Modo Pareja                                  |
| 19                   | **Runtime** para el origen cliente; **aplazado** el resto   |
| 21                   | **Fuera del dominio**: monetización (§12)                   |
| 26 · 27 · 28         | **Aplazados con el FX**; 27 parcialmente estructural        |

---

## 13 · Veredicto

**No queda ningún concepto de `data-model.md` en tierra de nadie.** Cada uno está
persistido, es derivable, tiene proyección, vive en la frontera, o está aplazado
**con su motivo y su destino escritos**.

Los aplazados, en una línea cada uno:

| Aplazado                                       | Destino              |
| ---------------------------------------------- | -------------------- |
| Modo Pareja completo (4.9, 4.10, 4.12–4.14)    | Su fase              |
| Atributos de Grupo                             | Su fase              |
| Resolución autoritativa del FX                 | Decisión de producto |
| ~~Siembra del catálogo monetario~~             | **Resuelto en F6.A** |
| ~~Provisioning del Modo Personal~~             | **Resuelto en F6.A** |
| Provisioning de Grupos y participantes         | F9 y F10             |
| Mecanismo de claim, revocación y fusión        | **F10**              |
| Acceso residual                                | Abierto              |
| Notificación                                   | Abierto              |
| ~~Anulación como concepto distinto~~           | **Resuelto en F6.C** |
| Idempotencia de otros orígenes                 | Abierto              |
| Previsualización de correcciones               | Fase de pantallas    |
| ~~Clase `ingreso` sin ruta~~                   | **Resuelto en F6.B** |
| Conflicto por configuración monetaria anterior | Abierto              |
