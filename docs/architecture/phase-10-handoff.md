# Punto de entrada — Fase 10 · Identidad contextual y ciclo de vida del vínculo

> **Documento vivo de la fase, y NO normativo.** Recoge qué entregó la Fase 10
> bloque a bloque, cómo se cumple cada criterio de cierre, qué se validó
> físicamente y qué queda deliberadamente fuera. Las decisiones viven en
> [`docs/adr/F10/`](../adr/F10/README.md), en
> [F05/ADR-003](../adr/F05/ADR-003-guest-session.md) y en el
> [roadmap](../product/roadmap.md); si este documento los contradice, mandan
> ellos. Sustituye a [`phase-10-opening.md`](phase-10-opening.md) como punto
> de entrada; la apertura se conserva como historia de lo que se midió antes
> de decidir.

Antes de nada, y en este orden: [`AGENTS.md`](../../AGENTS.md) ·
[`PROJECT_STATE.md`](../PROJECT_STATE.md) · este documento.

---

## 1 · Dónde está la fase

**CERRADA el 2026-09-16.** Abierta el 2026-09-14.

| Bloque     | Qué es                                                                                                                                                              | Estado                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **F10.A0** | Apertura: reconciliación F9/F10, criterios nuevos, mediciones previas                                                                                               | **Cerrado**                      |
| **F10.A1** | `F10/ADR-001`: principio de no adjudicación; identidad y procedencia de cada instancia de vínculo                                                                   | **Cerrado**                      |
| **F10.A2** | Backend de A1: `link_id`, `origin_command_id`, línea base, guardas, carreras (la baja que implementó se retiró en A3)                                               | **Cerrado**                      |
| **F10.A3** | `F10/ADR-002` identidad permanente · `F10/ADR-003` vínculo activo/histórico · cronología «Saldado» · **modo Invitado real** y conversión (`F05/ADR-003`)            | **Cerrado y validado en iPhone** |
| **F10.B0** | `F10/ADR-004`: cierre de alcance — ninguna cesión ni fusión nueva; cadenas prohibidas. **B1 y B2 no existen**                                                       | **Cerrado** (documental)         |
| **F10.C0** | `F10/ADR-005`: punto de inicio del Personal tras el Invitado (migración 51) · los dos cierres de ADR-004 (migración 52) · auditoría, `PROJECT_STATE` y este handoff | **Cerrado y validado en iPhone** |

**Android no se validó físicamente en esta fase** (criterio 11: «Android; iOS
si hay aparato»): A3 y C0 se validaron en un iPhone con Expo Go, y nada de lo
que entró es específico de plataforma. Queda dicho, no disimulado.

---

## 2 · Qué promete la Fase 10, y en qué queda

Un solo principio: **ninguna cuenta adjudica unilateralmente la identidad de
otra**. Y un contrato de identidad que, en el modelo que queda, cabe en seis
frases:

1. Mientras una cuenta participa en un grupo, **su participante es fijo**: no
   hay `unclaim`, ni `unlink`, ni «Dejar mi identidad» (F10/ADR-002).
2. Salir **termina** el vínculo sin borrarlo: activo → histórico; quien salió es
   historia, no un participante sin cuenta (F10/ADR-003).
3. Al volver: **volver como X** o **reclamar un sin cuenta disponible**; nunca
   «nuevo» si ya estuvo (`REJOIN_REQUIRED`).
4. Fantasma → cuenta: **reclamar** con invitación (F09/ADR-004) o **asociar** a la
   propia identidad (F09/ADR-009). Nada más se fusiona ni se cede; una fusión es
   de **un salto** (F10/ADR-004).
5. El invitado es una **sesión anónima real**; convertirla **conserva el id**;
   entrar en otra cuenta desde un invitado falla cerrado (F05/ADR-003).
6. Al abrir Personal tras convertirse, la persona decide **una vez** cómo
   empezar; «desde cero» es un corte de lectura, no un borrado (F10/ADR-005).

---

## 3 · Los criterios de cierre, uno por uno

Los criterios son los del roadmap (Fase 10, «Cierre»). Cada fila dice dónde se
demuestra; nada se afirma sin una medición que lo respalde.

| #   | Criterio                                                                   | Dónde se demuestra                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | La identidad en el grupo es permanente                                     | `20260917120000` retira `unclaim`/`unlink`; `link-instance.sql` (catálogo sin función de baja); frontera HTTP §13 (`PGRST202 · 404` a las antiguas); cliente sin acción sobre la fila propia (`retire-participant-surface`, `permanent-identity-surface`); confirmación al reclamar |
| 2   | Nadie altera el vínculo ni la membresía ajenos                             | `group-identity-lock.sql` (policies self-only del provisioner); frontera HTTP §13 con JWT real                                                                                                                                                                                      |
| 3   | Dejar de participar es salir, con la economía de F9 y el vínculo terminado | `link-lifecycle.sql` B–C (termina con `ended_at`/`departure_id`; fuera de Saldos, recuento y foto; `is_departed`; volver reactiva el mismo `link_id`); `leave-and-settle.sql`; carreras `rejoin-race-evidence.sh`                                                                   |
| 4   | Un participante vinculado no es reclamable ni retirable por nadie          | `link-lifecycle.sql` B (`PARTICIPANT_ALREADY_CLAIMED`, `PARTICIPANT_LINKED`), `retire-participant.sql` E2, `retire-claim-race.sh`                                                                                                                                                   |
| 5   | Identidad y procedencia de cada instancia, línea base insert-only          | `link-instance.sql` (`link_id`, `origin_command_id`, `core.link_baseline_subject`/`link_baseline`); ninguna vista `api` publica `link_id` (frontera §13)                                                                                                                            |
| 6   | La cesión A → B no entra: límite declarado                                 | F10/ADR-004 §1–§2; ninguna función `api` de cesión existe (`merge-invariants.sql` A, catálogo)                                                                                                                                                                                      |
| 7   | Fantasma ↔ fantasma no entra; cadenas prohibidas como invariante           | F10/ADR-004 §4–§5; `merge-invariants.sql` C–D (A → B válida; B → C, C → A y reapuntado rehusados **en catálogo**, escriba quien escriba; suma cero intacta)                                                                                                                         |
| 8   | «Grupo sin ninguna cuenta miembro» documentado, sin cambio                 | `phase-10-opening.md` §3.2; roadmap «Consecuencia registrada»; ningún cambio de semántica en F10                                                                                                                                                                                    |
| 9   | Disputas sin consentimiento documentadas como no resolubles                | F10/ADR-001 §13 (Aceptado; sigue vigente tras ADR-002)                                                                                                                                                                                                                              |
| 10  | Guarda completa del cerrojo y carreras en CI                               | `group-identity-lock.sql` (once funciones, incluida `associate_participant`); `associate-race-evidence.sh`, `rejoin-race-evidence.sh`, `identity-lock-race-evidence.sh`, `personal-start-race-evidence.sh` en `ci.yml`                                                              |
| 11  | Validado en dispositivo                                                    | iPhone (Expo Go): A3 (identidad, Invitado, conversión, UI final) y C0 (punto de inicio, los dos caminos, selector). Android: no en esta fase (§1)                                                                                                                                   |
| 12  | Documentación sin contradicciones sobre identidad                          | Esta auditoría (§5): roadmap, `PROJECT_STATE`, `AGENTS.md`, apertura, `model-coverage`, `data-model`, índices ADR, F09 README, F10/ADR-001…005, F05/ADR-003                                                                                                                         |
| 13  | Los dos cierres de F10/ADR-004                                             | `20260920120000`: `sec.retire_participant_core` rehúsa a un origen fusionado (`PARTICIPANT_MERGED`, las dos puertas); trigger `participant_merge_un_salto` (definer, insert y update). `merge-invariants.sql` A–D                                                                   |

---

## 4 · Qué entregó cada bloque

- **A1/A2** — `core.participant_user_link.link_id` y `origin_command_id`;
  `core.link_baseline_subject` / `core.link_baseline` (auditoría insert-only,
  sin lector de producto); guarda de catálogo de policies self-only; once
  funciones bajo `sec.lock_participant_claims` enumeradas por
  `group-identity-lock.sql`. La baja de instancia que A2 implementó se retiró
  en A3 por decisión de producto.
- **A3** — Migraciones `20260917120000` (identidad permanente: sin
  `unclaim`/`unlink`) y `20260918120000` (`ended_at`, `departure_id`, índice
  parcial de una identidad activa por cuenta y grupo, `is_departed`,
  `REJOIN_REQUIRED`, `effective_time` del pago). Cliente: confirmación «¿Eres
  X?», sin menú sobre la fila propia, «volver como antes» o reclamar,
  cronología única de Movimientos con «Saldado». **Modo Invitado**:
  `signInAnonymously`, Inicio «Crea tu cuenta», Perfil «Crear cuenta» + «Cerrar
  sesión», `convertGuest` con el mismo id, detección de la conversión con
  `getUser` + `refreshSession`, `signIn` desde invitado fallando cerrado.
- **B0** — F10/ADR-004: sin `identity_handover`, sin cuenta → cuenta, sin
  cuenta ↔ cuenta, sin fantasma ↔ fantasma; B1 y B2 eliminados.
- **C0** — Migración `20260919120000`: `core.scope.provisioned_as_guest`,
  `core.personal_start` (insert-only), `sec.counts_in_personal` (un predicado
  para `sec.derive_balance` y todas las lecturas del Personal),
  `api.start_personal_scope`, `ensure_personal_scope` publica
  `provisioned_as_guest / start_mode / needs_start_decision`. Cliente: la
  pantalla «¿Cómo quieres empezar tu Modo Personal?», `usePersonalStart`
  (invitado no decide; al convertirse se relee; include automático sin
  historia), selector con borde `accent` en la opción elegida. Migración
  `20260920120000`: los dos cierres de ADR-004.

---

## 5 · Auditoría documental del cierre

Revisado el 2026-09-16, y actualizado donde hacía falta, sin reescribir
ningún ADR aceptado (sus referencias hacia delante se leen con las notas de
los índices y con los ADR que las superan):

| Documento                                      | Estado                                                                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/product/roadmap.md`                      | Fase 10 **CERRADA el 2026-09-16**; A0 … C0 cerrados; B1/B2 no existen; criterios 1–13 cumplidos; puertas sin objeto tachadas                                   |
| `docs/PROJECT_STATE.md`                        | Fase 10 cerrada, última fase cerrada; superficie `api` con `start_personal_scope`; 52 migraciones; sin «pendiente» de F10                                      |
| `AGENTS.md`                                    | §5 con el contrato final; «Current state» con F10 cerrada; recuentos                                                                                           |
| `docs/architecture/phase-10-opening.md`        | Nota de cierre en cabecera; sustituido por este handoff como punto de entrada; se conserva como historia                                                       |
| `docs/architecture/model-coverage.md`          | Ciclo de vida del vínculo: resuelto en F9 · F10; cesión y fusiones fuera por ADR-004                                                                           |
| `docs/architecture/data-model.md`              | «Resuelto en F10» para el ciclo de vida; cesión y fusión fuera                                                                                                 |
| `docs/adr/README.md`, `docs/adr/F10/README.md` | F10/ADR-001…005 indexados; ninguno previsto; la fase cerrada                                                                                                   |
| `docs/adr/F09/README.md`                       | Notas: `unclaim` retirado por F10/ADR-002; `payment_counterpart_name` anotado por F10/ADR-004                                                                  |
| F10/ADR-001 … F10/ADR-005                      | Aceptados. Las referencias a «F10.B0» de 001/002/003 se leen con ADR-004; ADR-004 asignó dos cierres a C0, cumplidos por `20260920120000`; ADR-005 nació en C0 |
| F05/ADR-003                                    | Aceptado; el punto de inicio del Personal tras el Invitado lo fija F10/ADR-005 (nota en `docs/adr/F05/README.md`)                                              |

---

## 6 · Fuera de la Fase 10, y conviene que se vea

- **F9 económico no se reabre**: salir, saldar, retirar, pagos y novación son
  exactamente los de F9.
- **F8.B (Apple/Google) sigue fuera.**
- **No hay fusión de un invitado con una cuenta existente**, ni cesión de
  identidad entre cuentas, ni fusión fantasma ↔ fantasma (F10/ADR-004).
- **No hay «reiniciar Modo Personal»**: el punto de inicio se decide una vez
  (F10/ADR-005).
- **Cuentas convertidas antes de la migración 51** no llevan la marca de origen
  y nunca verán la pregunta (ninguna en producción).
- **La llave de recuperación de un grupo sin miembros** (una invitación viva)
  sigue siendo una consecuencia registrada sin tratamiento.

---

## 7 · Cómo se verifica

Desde cero, como CI: 52 migraciones, 33 checks SQL (`link-instance`,
`group-identity-lock`, `link-lifecycle`, `personal-start`, `merge-invariants`
entre ellos), la frontera HTTP con JWT real (§13 identidad permanente, §14
Invitado y conversión, §15 punto de inicio), y once carreras con sesiones
reales. Los tres bloques con cliente se validaron además en un iPhone.
