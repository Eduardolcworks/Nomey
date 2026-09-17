# Architecture Decision Records

Registro de las decisiones arquitectónicas de Nomey y, sobre todo, de **por qué**
se tomaron con la información disponible entonces.

## Organización por fases (desde el 2026-09-14)

Los ADR viven en **una carpeta por fase del roadmap**, `F00` … `F19`, y cada
fase numera los suyos **de forma independiente** empezando por `ADR-001`:

```
docs/adr/F09/ADR-001-descripcion.md
docs/adr/F11/ADR-001-descripcion.md
```

**La identidad completa de una decisión es fase y número — `F09/ADR-001`—,
nunca «ADR-001» a secas.** Cada carpeta tiene un `README.md` con su alcance,
su índice y las decisiones de otras fases que aplica. Así varias personas
pueden trabajar en fases distintas sin disputarse un número.

### Reglas para trabajar en paralelo

1. **Un ADR se crea en la carpeta de la fase que origina la decisión**, no en
   la que después la usa. Si una decisión sirve a varias fases, tiene **una
   sola ubicación principal**, justificada, y las demás la **citan**.
2. **Antes de elegir número, consulta el índice de esa fase** (`FNN/README.md`)
   y toma el siguiente libre. No se reservan números.
3. **Referencia siempre fase y número** (`F03/ADR-009`), en documentos,
   comentarios, pruebas y scripts.
4. **No se renumera una decisión existente para insertar otra.** Los números
   no se reutilizan, ni siquiera si un ADR se abandona.
5. **Si dos ramas crean el mismo identificador dentro de una fase**, se
   resuelve **antes de integrar**: una de las dos toma el siguiente número
   libre y actualiza sus referencias. Nunca se integran dos `FNN/ADR-MMM`
   distintos con el mismo identificador.
6. **Un ADR de otra fase se cita; no se copia ni se redefine silenciosamente.**
   Cambiar lo que decide exige un ADR nuevo en la fase que lo cambia, con la
   relación de sustitución explícita en ambos.

Usa la skill `adr` (`.claude/skills/adr/`) para redactar uno.

## Estados

| Estado                        | Significado                                     |
| ----------------------------- | ----------------------------------------------- |
| `Propuesto`                   | Redactado, pendiente de decisión humana         |
| `Aceptado`                    | Vigente. **Inmutable.**                         |
| `Reemplazado por FNN/ADR-MMM` | Sustituido. Se conserva como registro histórico |

**En un ADR aceptado, el contenido y el razonamiento son inmutables.** No se
corrigen, no se matizan ni se actualizan: registran el razonamiento de un
momento concreto con la información de entonces, no el estado actual. Eso es
justamente lo que los hace útiles.

Lo único que sí se actualiza es la **metadata**: la línea `Estado:` puede pasar
a `Reemplazado por FNN/ADR-MMM`, puede añadirse el enlace al ADR que lo
sustituye, y el identificador y las referencias cruzadas siguen la convención
vigente (la reorganización del 2026-09-14 cambió títulos, rutas y enlaces, y
añadió `Identificador anterior`; el razonamiento no se tocó). Si la decisión
cambia, se escribe un ADR nuevo; el antiguo se queda como estaba, solo marcado.

Un ADR en estado `Propuesto` sí se edita libremente: todavía no es un registro
de nada.

## Plantilla

```markdown
# FNN/ADR-MMM — Título

- **Estado:** Propuesto
- **Fecha:** AAAA-MM-DD

## Contexto

Qué problema existe y qué restricciones aplican.

## Decisión

Qué se decide, en presente y sin ambigüedad.

## Alternativas consideradas

Cada una con por qué se descartó. Obligatorio.

## Consecuencias

Lo bueno y lo malo. Qué se vuelve más fácil y qué más difícil.
```

Dos reglas de calidad:

- **Sin alternativas reales no hay ADR**, hay una preferencia documentada.
- **Las consecuencias incluyen las malas.** Si no hay contrapartidas, o la
  decisión es trivial o el análisis está incompleto.

## Índice general

| Fase                 | Nombre                                           | ADR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [F00](F00/README.md) | Cimientos del repositorio                        | [ADR-001](F00/ADR-001-licensing.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| [F01](F01/README.md) | Modelo contable y reglas de dominio              | [ADR-001](F01/ADR-001-accounting-model.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [F02](F02/README.md) | Representación exacta del dinero                 | [ADR-001](F02/ADR-001-money-representation.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [F03](F03/README.md) | Persistencia y frontera de datos                 | [ADR-001](F03/ADR-001-currency-definition-identity.md) · [ADR-002](F03/ADR-002-schema-topology.md) · [ADR-003](F03/ADR-003-privilege-model.md) · [ADR-004](F03/ADR-004-membership-rls.md) · [ADR-005](F03/ADR-005-exact-data-boundary.md) · [ADR-006](F03/ADR-006-authoritative-write-boundary.md) · [ADR-007](F03/ADR-007-client-operation-idempotency.md) · [ADR-008](F03/ADR-008-operation-version-model.md) · [ADR-009](F03/ADR-009-participant-identity.md) · [ADR-010](F03/ADR-010-persisted-vs-derived.md) · [ADR-011](F03/ADR-011-data-api-schema-exposure.md) · [ADR-012](F03/ADR-012-frozen-rate-physical-representation.md) · [ADR-013](F03/ADR-013-economic-attribution.md) |
| [F04](F04/README.md) | Arquitectura UX e internacionalización           | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [F05](F05/README.md) | Identidad y sesión                               | [ADR-001](F05/ADR-001-secure-session-storage.md) · [ADR-002](F05/ADR-002-ephemeral-recovery-session.md) · [ADR-003](F05/ADR-003-guest-session.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [F06](F06/README.md) | Modo Personal                                    | [ADR-001](F06/ADR-001-personal-provisioning.md) · [ADR-002](F06/ADR-002-version-content-and-time.md) · [ADR-003](F06/ADR-003-category-catalogue.md) · [ADR-004](F06/ADR-004-balance-target-and-serialization.md) · [ADR-005](F06/ADR-005-balance-observation.md) · [ADR-006](F06/ADR-006-annulment.md) · [ADR-007](F06/ADR-007-personal-read-surface.md) · [ADR-008](F06/ADR-008-personal-statistics.md) · [ADR-009](F06/ADR-009-expense-only-categories.md)                                                                                                                                                                                                                            |
| [F07](F07/README.md) | Entrada rápida, offline y sincronización         | [ADR-001](F07/ADR-001-offline-command-queue-and-optimistic-projection.md) · [ADR-002](F07/ADR-002-incident-labels-and-review-destination.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [F08](F08/README.md) | Distribución interna y entornos                  | [ADR-001](F08/ADR-001-native-code-model.md) · [ADR-002](F08/ADR-002-environments-and-variants.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [F09](F09/README.md) | Grupos, gastos compartidos y deudas              | [ADR-001](F09/ADR-001-group-model-and-permissions.md) · [ADR-002](F09/ADR-002-client-provisioning-idempotency.md) · [ADR-003](F09/ADR-003-leaving-a-group.md) · [ADR-004](F09/ADR-004-group-invitations.md) · [ADR-005](F09/ADR-005-retire-unlinked-participant.md) · [ADR-006](F09/ADR-006-unclaim-participant.md) · [ADR-007](F09/ADR-007-group-payments-and-exit-without-debt.md) · [ADR-008](F09/ADR-008-departed-obligation-immutable.md) · [ADR-009](F09/ADR-009-associate-ghost-to-own-account.md) · [ADR-010](F09/ADR-010-rejoin-after-departure.md)                                                                                                                            |
| [F10](F10/README.md) | Identidad contextual y ciclo de vida del vínculo | [ADR-001](F10/ADR-001-link-instance-lifecycle.md) · [ADR-002](F10/ADR-002-permanent-identity.md) · [ADR-003](F10/ADR-003-active-and-historical-link.md) · [ADR-004](F10/ADR-004-identity-scope-closure.md) · [ADR-005](F10/ADR-005-personal-start.md)                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| [F11](F11/README.md) | Multimoneda operativa                            | [ADR-001](F11/ADR-001-fx-rate-resolution.md) · [ADR-002](F11/ADR-002-per-currency-daily-rate.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [F12](F12/README.md) | Capacidades compartidas avanzadas                | [ADR-001](F12/ADR-001-username-public-account-identity.md) · [ADR-002](F12/ADR-002-two-will-user-transfers.md) · [ADR-003](F12/ADR-003-group-transfers.md) · [ADR-004](F12/ADR-004-payment-request-links.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [F13](F13/README.md) | Modo Pareja                                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [F14](F14/README.md) | Premium y entitlements                           | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [F15](F15/README.md) | Presupuestos e insights                          | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [F16](F16/README.md) | Superficies nativas                              | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [F17](F17/README.md) | Integración bancaria                             | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [F18](F18/README.md) | Endurecimiento global                            | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [F19](F19/README.md) | Producción y lanzamiento                         | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Por identificador

| ADR                                                                           | Título                                                                                                                                                                  | Estado    | Fecha      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| [F00/ADR-001](F00/ADR-001-licensing.md)                                       | Licencia de Nomey y avisos de terceros                                                                                                                                  | Propuesto | 2026-08-17 |
| [F01/ADR-001](F01/ADR-001-accounting-model.md)                                | Modelo contable de Nomey                                                                                                                                                | Aceptado  | 2026-08-18 |
| [F02/ADR-001](F02/ADR-001-money-representation.md)                            | Representación exacta del dinero                                                                                                                                        | Aceptado  | 2026-08-19 |
| [F03/ADR-001](F03/ADR-001-currency-definition-identity.md)                    | Identidad física de la definición monetaria                                                                                                                             | Aceptado  | 2026-08-23 |
| [F03/ADR-002](F03/ADR-002-schema-topology.md)                                 | Topología de schemas y frontera de la Data API                                                                                                                          | Aceptado  | 2026-08-23 |
| [F03/ADR-003](F03/ADR-003-privilege-model.md)                                 | Modelo de privilegios y frontera de lectura `api` → `core`                                                                                                              | Aceptado  | 2026-08-24 |
| [F03/ADR-004](F03/ADR-004-membership-rls.md)                                  | Comprobación de membresía y estrategia de RLS                                                                                                                           | Aceptado  | 2026-08-24 |
| [F03/ADR-005](F03/ADR-005-exact-data-boundary.md)                             | Frontera de datos exactos                                                                                                                                               | Aceptado  | 2026-08-24 |
| [F03/ADR-006](F03/ADR-006-authoritative-write-boundary.md)                    | Frontera autoritativa de escritura                                                                                                                                      | Aceptado  | 2026-08-24 |
| [F03/ADR-007](F03/ADR-007-client-operation-idempotency.md)                    | Idempotencia de las operaciones originadas por el cliente                                                                                                               | Aceptado  | 2026-08-24 |
| [F03/ADR-008](F03/ADR-008-operation-version-model.md)                         | Modelo físico de operaciones, versiones y comandos cliente                                                                                                              | Aceptado  | 2026-08-24 |
| [F03/ADR-009](F03/ADR-009-participant-identity.md)                            | Identidad de participantes sin cuenta y vínculo con usuarios                                                                                                            | Aceptado  | 2026-08-24 |
| [F03/ADR-010](F03/ADR-010-persisted-vs-derived.md)                            | Persistido frente a derivado, reparto contextual y proyección canónica                                                                                                  | Aceptado  | 2026-08-24 |
| [F03/ADR-011](F03/ADR-011-data-api-schema-exposure.md)                        | Exposición definitiva de schemas de la Data API                                                                                                                         | Aceptado  | 2026-08-25 |
| [F03/ADR-012](F03/ADR-012-frozen-rate-physical-representation.md)             | Representación física del tipo de cambio congelado                                                                                                                      | Aceptado  | 2026-08-25 |
| [F03/ADR-013](F03/ADR-013-economic-attribution.md)                            | Atribución económica de efectos a un usuario                                                                                                                            | Aceptado  | 2026-08-26 |
| [F05/ADR-001](F05/ADR-001-secure-session-storage.md)                          | Persistencia segura de la sesión en el dispositivo                                                                                                                      | Aceptado  | 2026-08-27 |
| [F05/ADR-002](F05/ADR-002-ephemeral-recovery-session.md)                      | La sesión de recuperación es efímera y no se promociona                                                                                                                 | Aceptado  | 2026-08-28 |
| [F05/ADR-003](F05/ADR-003-guest-session.md)                                   | La sesión de invitado es una sesión anónima real de Auth, y se convierte en cuenta sin cambiar de identidad                                                             | Aceptado  | 2026-09-15 |
| [F06/ADR-001](F06/ADR-001-personal-provisioning.md)                           | Provisioning del Modo Personal y siembra del catálogo monetario                                                                                                         | Aceptado  | 2026-08-28 |
| [F06/ADR-002](F06/ADR-002-version-content-and-time.md)                        | Contenido no monetario y grano temporal de la versión                                                                                                                   | Aceptado  | 2026-08-28 |
| [F06/ADR-003](F06/ADR-003-category-catalogue.md)                              | Catálogo de categorías y su autorización                                                                                                                                | Aceptado  | 2026-08-28 |
| [F06/ADR-004](F06/ADR-004-balance-target-and-serialization.md)                | Ajuste por saldo objetivo y serialización de la dimensión saldo                                                                                                         | Aceptado  | 2026-08-29 |
| [F06/ADR-005](F06/ADR-005-balance-observation.md)                             | Observación histórica de saldo                                                                                                                                          | Aceptado  | 2026-08-29 |
| [F06/ADR-006](F06/ADR-006-annulment.md)                                       | Anulación de una operación                                                                                                                                              | Aceptado  | 2026-08-29 |
| [F06/ADR-007](F06/ADR-007-personal-read-surface.md)                           | Superficie de lectura del Modo Personal                                                                                                                                 | Aceptado  | 2026-08-30 |
| [F06/ADR-008](F06/ADR-008-personal-statistics.md)                             | Estadísticas agregadas del Modo Personal                                                                                                                                | Aceptado  | 2026-08-31 |
| [F06/ADR-009](F06/ADR-009-expense-only-categories.md)                         | La categoría es del gasto, y el icono es una clave semántica                                                                                                            | Aceptado  | 2026-09-01 |
| [F07/ADR-001](F07/ADR-001-offline-command-queue-and-optimistic-projection.md) | Cola de escritura sin conexión, durabilidad de la clave y proyección optimista                                                                                          | Aceptado  | 2026-09-03 |
| [F07/ADR-002](F07/ADR-002-incident-labels-and-review-destination.md)          | Etiquetas visibles de la incidencia, y a dónde lleva «Revisar»                                                                                                          | Aceptado  | 2026-09-04 |
| [F08/ADR-001](F08/ADR-001-native-code-model.md)                               | Modelo de código nativo: CNG con config plugins                                                                                                                         | Aceptado  | 2026-09-04 |
| [F08/ADR-002](F08/ADR-002-environments-and-variants.md)                       | Contrato de entornos, variantes y separación de configuración                                                                                                           | Aceptado  | 2026-09-04 |
| [F09/ADR-001](F09/ADR-001-group-model-and-permissions.md)                     | Modelo de Grupo y contrato de permisos                                                                                                                                  | Aceptado  | 2026-09-06 |
| [F09/ADR-002](F09/ADR-002-client-provisioning-idempotency.md)                 | Idempotencia por clave del provisioning iniciado por cliente                                                                                                            | Aceptado  | 2026-09-06 |
| [F09/ADR-003](F09/ADR-003-leaving-a-group.md)                                 | Salir de un Grupo, y dar por saldado a quien salió                                                                                                                      | Aceptado  | 2026-09-10 |
| [F09/ADR-004](F09/ADR-004-group-invitations.md)                               | Invitaciones a un Grupo y unión directa                                                                                                                                 | Aceptado  | 2026-09-10 |
| [F09/ADR-005](F09/ADR-005-retire-unlinked-participant.md)                     | Retirar a un participante sin cuenta                                                                                                                                    | Aceptado  | 2026-09-11 |
| [F09/ADR-006](F09/ADR-006-unclaim-participant.md)                             | Rectificar una reclamación («Me equivoqué de participante»)                                                                                                             | Aceptado  | 2026-09-11 |
| [F09/ADR-007](F09/ADR-007-group-payments-and-exit-without-debt.md)            | Pagos registrados en el grupo, su anulación, y salir sin pendientes                                                                                                     | Aceptado  | 2026-09-12 |
| [F09/ADR-008](F09/ADR-008-departed-obligation-immutable.md)                   | La obligación de quien salió del grupo es intocable                                                                                                                     | Aceptado  | 2026-09-12 |
| [F09/ADR-009](F09/ADR-009-associate-ghost-to-own-account.md)                  | Asociar un participante sin cuenta a la propia cuenta (fusión de identidades contextuales)                                                                              | Aceptado  | 2026-09-14 |
| [F09/ADR-010](F09/ADR-010-rejoin-after-departure.md)                          | Volver a entrar en un grupo tras salir voluntariamente                                                                                                                  | Aceptado  | 2026-09-14 |
| [F10/ADR-001](F10/ADR-001-link-instance-lifecycle.md)                         | Ciclo de vida de una instancia propia de vínculo cuenta ↔ identidad contextual                                                                                          | Aceptado  | 2026-09-14 |
| [F10/ADR-002](F10/ADR-002-permanent-identity.md)                              | Identidad permanente en el grupo: el vínculo cuenta ↔ participante no se deshace (supera en parte a F10/ADR-001)                                                        | Aceptado  | 2026-09-15 |
| [F10/ADR-003](F10/ADR-003-active-and-historical-link.md)                      | Vínculo activo y vínculo histórico: salir termina la identidad, volver la reactiva o elige otra (supera F09/ADR-010 en parte)                                           | Aceptado  | 2026-09-15 |
| [F10/ADR-004](F10/ADR-004-identity-scope-closure.md)                          | Cierre de alcance de la identidad contextual: sin cesiones, sin fusiones nuevas y sin `identity_handover` (supera las referencias a B0 de F10/ADR-001/002/003)          | Aceptado  | 2026-09-16 |
| [F10/ADR-005](F10/ADR-005-personal-start.md)                                  | Punto de inicio del Modo Personal tras el Invitado: incluir los movimientos de grupos o empezar desde cero (supera en parte F06/ADR-004 y F06/ADR-007)                  | Aceptado  | 2026-09-16 |
| [F11/ADR-001](F11/ADR-001-fx-rate-resolution.md)                              | Resolución autoritativa del tipo de cambio                                                                                                                              | Aceptado  | 2026-09-13 |
| [F11/ADR-002](F11/ADR-002-per-currency-daily-rate.md)                         | Tipo del día por moneda, fijación única y límite de antigüedad                                                                                                          | Aceptado  | 2026-09-16 |
| [F12/ADR-001](F12/ADR-001-username-public-account-identity.md)                | Username: la identidad pública de una cuenta (precisa F03/ADR-003 en el rol `supabase_auth_admin`)                                                                      | Aceptado  | 2026-09-17 |
| [F12/ADR-002](F12/ADR-002-two-will-user-transfers.md)                         | Transferencias entre usuarios con dos voluntades (precisa F01/ADR-001 §10 e invariante 14; supera el contrato de F3 de `record_internal_transfer`)                      | Aceptado  | 2026-09-17 |
| [F12/ADR-003](F12/ADR-003-group-transfers.md)                                 | Transferencias dentro de un Grupo: propuesta + aceptación → `settlement_by_transfer`, deuda algebraica (supera de forma acotada `data-model.md` §3 y el contrato de F3) | Aceptado  | 2026-09-17 |
| [F12/ADR-004](F12/ADR-004-payment-request-links.md)                           | Solicitudes de pago mediante enlace: capability al portador, un solo uso, 7 días → `internal_transfer` del pagador al solicitante                                       | Aceptado  | 2026-09-17 |

> **F02/ADR-001 cumplió su puerta de aceptación el 2026-08-19.** El experimento
> **E11** se ejecutó contra un stack Supabase local real: confirmó los supuestos
> de almacenamiento del ADR y demostró que su contingencia T8 es necesaria para
> hacer cumplir T7. La evidencia reproducible vive en
> [`supabase/e11/`](../../supabase/e11/README.md).

## Tabla de equivalencias (permanente)

Hasta el 2026-09-14 los ADR tenían una numeración única `ADR-001` … `ADR-041`.
Esta tabla es la referencia **permanente** para leer cualquier mención antigua:
migraciones, checks SQL, el SQL de las sondas `supabase/e*` y los vectores
compartidos **conservan la numeración antigua** a propósito (su integridad
importa más que un comentario), y se resuelven aquí; las notas (`README.md`) de
las sondas sí enlazan a las rutas nuevas. Cada ADR tiene
su identificador anterior como metadato (`Identificador anterior`).

| Antes   | Título                                                                                     | Ahora           | Ruta                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| ADR-001 | Licencia de Nomey y avisos de terceros                                                     | **F00/ADR-001** | [`F00/ADR-001-licensing.md`](F00/ADR-001-licensing.md)                                                                             |
| ADR-002 | Modelo contable de Nomey                                                                   | **F01/ADR-001** | [`F01/ADR-001-accounting-model.md`](F01/ADR-001-accounting-model.md)                                                               |
| ADR-003 | Representación exacta del dinero                                                           | **F02/ADR-001** | [`F02/ADR-001-money-representation.md`](F02/ADR-001-money-representation.md)                                                       |
| ADR-004 | Identidad física de la definición monetaria                                                | **F03/ADR-001** | [`F03/ADR-001-currency-definition-identity.md`](F03/ADR-001-currency-definition-identity.md)                                       |
| ADR-005 | Topología de schemas y frontera de la Data API                                             | **F03/ADR-002** | [`F03/ADR-002-schema-topology.md`](F03/ADR-002-schema-topology.md)                                                                 |
| ADR-006 | Modelo de privilegios y frontera de lectura `api` → `core`                                 | **F03/ADR-003** | [`F03/ADR-003-privilege-model.md`](F03/ADR-003-privilege-model.md)                                                                 |
| ADR-007 | Comprobación de membresía y estrategia de RLS                                              | **F03/ADR-004** | [`F03/ADR-004-membership-rls.md`](F03/ADR-004-membership-rls.md)                                                                   |
| ADR-008 | Frontera de datos exactos                                                                  | **F03/ADR-005** | [`F03/ADR-005-exact-data-boundary.md`](F03/ADR-005-exact-data-boundary.md)                                                         |
| ADR-009 | Frontera autoritativa de escritura                                                         | **F03/ADR-006** | [`F03/ADR-006-authoritative-write-boundary.md`](F03/ADR-006-authoritative-write-boundary.md)                                       |
| ADR-010 | Idempotencia de las operaciones originadas por el cliente                                  | **F03/ADR-007** | [`F03/ADR-007-client-operation-idempotency.md`](F03/ADR-007-client-operation-idempotency.md)                                       |
| ADR-011 | Modelo físico de operaciones, versiones y comandos cliente                                 | **F03/ADR-008** | [`F03/ADR-008-operation-version-model.md`](F03/ADR-008-operation-version-model.md)                                                 |
| ADR-012 | Identidad de participantes sin cuenta y vínculo con usuarios                               | **F03/ADR-009** | [`F03/ADR-009-participant-identity.md`](F03/ADR-009-participant-identity.md)                                                       |
| ADR-013 | Persistido frente a derivado, reparto contextual y proyección canónica                     | **F03/ADR-010** | [`F03/ADR-010-persisted-vs-derived.md`](F03/ADR-010-persisted-vs-derived.md)                                                       |
| ADR-014 | Exposición definitiva de schemas de la Data API                                            | **F03/ADR-011** | [`F03/ADR-011-data-api-schema-exposure.md`](F03/ADR-011-data-api-schema-exposure.md)                                               |
| ADR-015 | Representación física del tipo de cambio congelado                                         | **F03/ADR-012** | [`F03/ADR-012-frozen-rate-physical-representation.md`](F03/ADR-012-frozen-rate-physical-representation.md)                         |
| ADR-016 | Atribución económica de efectos a un usuario                                               | **F03/ADR-013** | [`F03/ADR-013-economic-attribution.md`](F03/ADR-013-economic-attribution.md)                                                       |
| ADR-017 | Persistencia segura de la sesión en el dispositivo                                         | **F05/ADR-001** | [`F05/ADR-001-secure-session-storage.md`](F05/ADR-001-secure-session-storage.md)                                                   |
| ADR-018 | La sesión de recuperación es efímera y no se promociona                                    | **F05/ADR-002** | [`F05/ADR-002-ephemeral-recovery-session.md`](F05/ADR-002-ephemeral-recovery-session.md)                                           |
| ADR-019 | Provisioning del Modo Personal y siembra del catálogo monetario                            | **F06/ADR-001** | [`F06/ADR-001-personal-provisioning.md`](F06/ADR-001-personal-provisioning.md)                                                     |
| ADR-020 | Contenido no monetario y grano temporal de la versión                                      | **F06/ADR-002** | [`F06/ADR-002-version-content-and-time.md`](F06/ADR-002-version-content-and-time.md)                                               |
| ADR-021 | Catálogo de categorías y su autorización                                                   | **F06/ADR-003** | [`F06/ADR-003-category-catalogue.md`](F06/ADR-003-category-catalogue.md)                                                           |
| ADR-022 | Ajuste por saldo objetivo y serialización de la dimensión saldo                            | **F06/ADR-004** | [`F06/ADR-004-balance-target-and-serialization.md`](F06/ADR-004-balance-target-and-serialization.md)                               |
| ADR-023 | Observación histórica de saldo                                                             | **F06/ADR-005** | [`F06/ADR-005-balance-observation.md`](F06/ADR-005-balance-observation.md)                                                         |
| ADR-024 | Anulación de una operación                                                                 | **F06/ADR-006** | [`F06/ADR-006-annulment.md`](F06/ADR-006-annulment.md)                                                                             |
| ADR-025 | Superficie de lectura del Modo Personal                                                    | **F06/ADR-007** | [`F06/ADR-007-personal-read-surface.md`](F06/ADR-007-personal-read-surface.md)                                                     |
| ADR-026 | Estadísticas agregadas del Modo Personal                                                   | **F06/ADR-008** | [`F06/ADR-008-personal-statistics.md`](F06/ADR-008-personal-statistics.md)                                                         |
| ADR-027 | La categoría es del gasto, y el icono es una clave semántica                               | **F06/ADR-009** | [`F06/ADR-009-expense-only-categories.md`](F06/ADR-009-expense-only-categories.md)                                                 |
| ADR-028 | Cola de escritura sin conexión, durabilidad de la clave y proyección optimista             | **F07/ADR-001** | [`F07/ADR-001-offline-command-queue-and-optimistic-projection.md`](F07/ADR-001-offline-command-queue-and-optimistic-projection.md) |
| ADR-029 | Etiquetas visibles de la incidencia, y a dónde lleva «Revisar»                             | **F07/ADR-002** | [`F07/ADR-002-incident-labels-and-review-destination.md`](F07/ADR-002-incident-labels-and-review-destination.md)                   |
| ADR-030 | Modelo de código nativo: CNG con config plugins                                            | **F08/ADR-001** | [`F08/ADR-001-native-code-model.md`](F08/ADR-001-native-code-model.md)                                                             |
| ADR-031 | Contrato de entornos, variantes y separación de configuración                              | **F08/ADR-002** | [`F08/ADR-002-environments-and-variants.md`](F08/ADR-002-environments-and-variants.md)                                             |
| ADR-032 | Modelo de Grupo y contrato de permisos                                                     | **F09/ADR-001** | [`F09/ADR-001-group-model-and-permissions.md`](F09/ADR-001-group-model-and-permissions.md)                                         |
| ADR-033 | Idempotencia por clave del provisioning iniciado por cliente                               | **F09/ADR-002** | [`F09/ADR-002-client-provisioning-idempotency.md`](F09/ADR-002-client-provisioning-idempotency.md)                                 |
| ADR-034 | Salir de un Grupo, y dar por saldado a quien salió                                         | **F09/ADR-003** | [`F09/ADR-003-leaving-a-group.md`](F09/ADR-003-leaving-a-group.md)                                                                 |
| ADR-035 | Invitaciones a un Grupo y unión directa                                                    | **F09/ADR-004** | [`F09/ADR-004-group-invitations.md`](F09/ADR-004-group-invitations.md)                                                             |
| ADR-036 | Retirar a un participante sin cuenta                                                       | **F09/ADR-005** | [`F09/ADR-005-retire-unlinked-participant.md`](F09/ADR-005-retire-unlinked-participant.md)                                         |
| ADR-037 | Rectificar una reclamación («Me equivoqué de participante»)                                | **F09/ADR-006** | [`F09/ADR-006-unclaim-participant.md`](F09/ADR-006-unclaim-participant.md)                                                         |
| ADR-038 | Pagos registrados en el grupo, su anulación, y salir sin pendientes                        | **F09/ADR-007** | [`F09/ADR-007-group-payments-and-exit-without-debt.md`](F09/ADR-007-group-payments-and-exit-without-debt.md)                       |
| ADR-039 | La obligación de quien salió del grupo es intocable                                        | **F09/ADR-008** | [`F09/ADR-008-departed-obligation-immutable.md`](F09/ADR-008-departed-obligation-immutable.md)                                     |
| ADR-040 | Asociar un participante sin cuenta a la propia cuenta (fusión de identidades contextuales) | **F09/ADR-009** | [`F09/ADR-009-associate-ghost-to-own-account.md`](F09/ADR-009-associate-ghost-to-own-account.md)                                   |
| ADR-041 | Volver a entrar en un grupo tras salir voluntariamente                                     | **F09/ADR-010** | [`F09/ADR-010-rejoin-after-departure.md`](F09/ADR-010-rejoin-after-departure.md)                                                   |

**Criterio de asignación.** La fase de **origen** de cada decisión —según el
roadmap, el contenido del ADR y las referencias existentes—, no la fecha de su
última modificación ni la fase que después la utiliza. Dentro de cada fase se
conservó el orden original. Casos con decisión explícita:

- **ADR-012 (identidad de participantes sin cuenta) → F03**, no F10: se decidió
  y se migró en 3.C; F10 hereda lo que dejó abierto.
- **ADR-015 (tipo congelado) → F03**, no F11: es la representación física
  medida en 3.C; F11 la aplica.
- **ADR-019 (provisioning del Modo Personal) → F06**, no F05: nació en F6.A,
  sobre el estado con el que terminó F5.
- **ADR-029 (etiquetas de la incidencia) → F07**: cierra la cola sin conexión
  de F7, aunque el roadmap la mencione desde F8.
- **ADR-030 y ADR-031 → F08**, aunque F14, F16 y F19 dependan de ellos.

## Temas que previsiblemente necesitarán un ADR

Lista de **temas**, no de números: se numerarán al redactarse, en la carpeta de
la fase que los origine. Ninguno está reservado ni prejuzgado.

- ~~**Cesión consentida atómica y fusión fantasma ↔ fantasma** (F10)~~ —
  **decidido en negativo por
  [F10/ADR-004](F10/ADR-004-identity-scope-closure.md) (Aceptado,
  2026-09-16)**: ninguna cesión ni fusión nueva entra, y las cadenas de
  fusión son un invariante prohibido. El ciclo de vida del vínculo propio
  —principio de no adjudicación de la identidad ajena, identidad y
  procedencia de la instancia, disputas sin consentimiento— **ya está decidido por
  [F10/ADR-001](F10/ADR-001-link-instance-lifecycle.md) (Aceptado)**, y la
  **identidad es permanente** —vincularse no se deshace; salir y volver son
  F9— por [F10/ADR-002](F10/ADR-002-permanent-identity.md) (Aceptado, que
  supera la baja de ADR-001), y **salir termina el vínculo sin borrarlo**
  —quien salió es historia, no un participante sin cuenta; vuelve como
  entonces o como alguien sin cuenta, nunca como nuevo— por
  [F10/ADR-003](F10/ADR-003-active-and-historical-link.md) (Aceptado). La identidad y el vínculo los
  cerró [F03/ADR-009](F03/ADR-009-participant-identity.md); la invitación, la
  asociación del propio fantasma y la reincorporación los cerró F09 (la
  rectificación propia de F09/ADR-006 la retiró F10/ADR-002) ([F09/ADR-004](F09/ADR-004-group-invitations.md),
  [F09/ADR-009](F09/ADR-009-associate-ghost-to-own-account.md),
  [F09/ADR-010](F09/ADR-010-rejoin-after-departure.md)). **La revocación del
  vínculo de otro no se decidirá: está prohibida** por principio de producto
  (2026-09-14; [`phase-10-opening.md`](../architecture/phase-10-opening.md)).
- **Cambio de moneda base con historia** (F11): la fuente, la política de
  selección que [F02/ADR-001](F02/ADR-001-money-representation.md) dejó abierta
  y la conversión los cerró [F11/ADR-001](F11/ADR-001-fx-rate-resolution.md);
  cambiar la base de un ámbito con efectos exigiría un sucesor de
  [F01/ADR-001](F01/ADR-001-accounting-model.md) §8.
- **Idempotencia de recurrencias, importaciones y operaciones de backend** —
  el origen cliente lo cerraron
  [F03/ADR-007](F03/ADR-007-client-operation-idempotency.md) y
  [F07/ADR-001](F07/ADR-001-offline-command-queue-and-optimistic-projection.md);
  el provisioning, [F09/ADR-002](F09/ADR-002-client-provisioning-idempotency.md).
- **Backend alojado, EAS Build y política de `runtimeVersion`** — enumerados
  en [F08/ADR-002](F08/ADR-002-environments-and-variants.md).
- ~~**Transferencia ordenada desde la app y acceso residual** (F12)~~ —
  **decididos en F12.A0 (2026-09-17)**: las transferencias entre usuarios
  exigen dos voluntades ([F12/ADR-002](F12/ADR-002-two-will-user-transfers.md),
  [F12/ADR-003](F12/ADR-003-group-transfers.md),
  [F12/ADR-004](F12/ADR-004-payment-request-links.md)) y siguen siendo
  distintas del pago declarado de
  [F09/ADR-007](F09/ADR-007-group-payments-and-exit-without-debt.md); el
  acceso residual general **no existe**: lo cerraron F09/ADR-003 y F09/ADR-007
  C6, y F10/ADR-003.
- Supabase como backend y RLS como capa de autorización; arquitectura por capas
  y reglas de import; estrategia de i18n y localización.
