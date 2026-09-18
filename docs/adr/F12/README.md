# F12 — Capacidades compartidas avanzadas

**Alcance:** que el dinero se mueva entre personas **dentro del modelo de
Nomey** con el consentimiento de las dos partes: **identidad pública** de la
cuenta (username único y nombre público, descubrimiento exacto por
`@username`), **transferencia entre usuarios** desde el Personal (propuesta
dirigida + aceptación → `internal_transfer`), **transferencia dentro de un
grupo** (propuesta + aceptación → `settlement_by_transfer`, que mueve los dos
Personales y ajusta la deuda del par por el importe completo, pudiendo cruzar
cero) y **solicitud de pago** por enlace al portador (importe fijo, un solo
uso, 7 días → `internal_transfer`). Nomey no mueve dinero bancario: registra
hechos que las dos partes han querido. **Estado de la fase:** **ABIERTA el
2026-09-17**; **F12.A0 cerrado** (los cuatro ADR aceptados, sin
implementación); F12.A … F12.D pendientes. El detalle está en
[el roadmap](../../product/roadmap.md).

**Lo que el alcance original de la fase ya habían cerrado F9 y F10, y no se
reabre:** `shares` y `exact_amounts` (hechos en F3/F9), las correcciones con
elegibilidad en la fecha efectiva (F09/ADR-003 §5, F09/ADR-008), las bajas
con saldo pendiente y el acceso residual (no existen: F09/ADR-007 C5/C8/C6,
F10/ADR-003), el participante histórico (F03/ADR-009, F09/ADR-005,
F10/ADR-003), la identidad contextual y la reincorporación (F10). La
«transferencia ordenada unilateral» que el alcance original describía **no
existe**: toda transferencia entre usuarios exige dos voluntades.

**Fuera de la fase:** contactos del teléfono, teléfono verificado, SMS/OTP,
búsqueda por correo o agenda; transferencias bancarias reales, Open Banking,
tarjeta; bote común, préstamos, adelantos, pagos programados, transferencias
múltiples; solicitudes de dinero dentro de un grupo; transferencias a cuentas
inexistentes; conversión monetaria nueva (F11); Unicode en el username; Modo
Pareja (F13, diferido).

Los ADR de esta carpeta se numeran de forma independiente (`F12/ADR-NNN`) y
la identidad completa es siempre fase y número. Consulta este índice antes de
elegir un número; no se renumera ni se reutiliza. Convención completa en
[`docs/adr/README.md`](../README.md).

## ADR de esta fase

| ADR                                                        | Título                                                                                                                                                                                                     | Estado   | Fecha      | Bloque |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ------ |
| [F12/ADR-001](ADR-001-username-public-account-identity.md) | Username: la identidad pública de una cuenta (precisa F03/ADR-003 en el rol `supabase_auth_admin`)                                                                                                         | Aceptado | 2026-09-17 | F12.A0 |
| [F12/ADR-002](ADR-002-two-will-user-transfers.md)          | Transferencias entre usuarios con dos voluntades (precisa F01/ADR-001 §10 e invariante 14; supera el contrato de F3 de `record_internal_transfer`)                                                         | Aceptado | 2026-09-17 | F12.A0 |
| [F12/ADR-003](ADR-003-group-transfers.md)                  | Transferencias dentro de un Grupo: propuesta + aceptación → `settlement_by_transfer`, deuda algebraica (supera de forma acotada `data-model.md` §3 y el contrato de F3 de `record_settlement_by_transfer`) | Aceptado | 2026-09-17 | F12.A0 |
| [F12/ADR-004](ADR-004-payment-request-links.md)            | Solicitudes de pago mediante enlace: capability al portador, un solo uso, 7 días → `internal_transfer` del pagador al solicitante                                                                          | Aceptado | 2026-09-17 | F12.A0 |

Qué contrato cubre cada uno, en una línea:

- **ADR-001** — el username como atributo público, único y resoluble de la
  cuenta: persistencia en `core`, sintaxis (`^[a-z](_?[a-z0-9])*$`, 3–20,
  ASCII), 25 reservados exactos y 4 prefijos, reserva en el alta por el hook
  `before_user_created` en la misma transacción de GoTrue, reserva provisional
  de 7 días y `claim`, cambio con cooldown de 30 días y retención de 90,
  `public_name`, resolución exacta frenada a 20 consultas / 10 min, e
  identidad histórica siempre resuelta `uid → identidad actual`.
- **ADR-002** — ninguna `internal_transfer` existe sin dos voluntades: el
  emisor crea una propuesta dirigida (importe, moneda y destinatario fijos;
  sin efectos) y el receptor la acepta; `created_by` es quien materializa,
  emisor y receptor viven en las partes; irreversible, no editable, no
  anulable; devolver es otra transferencia; 3 pendientes por pareja y 10
  propuestas por hora. Precisa el invariante 14 («originar» = autorizar la
  salida propia) y supera el contrato de F3 del writer.
- **ADR-003** — la misma propuesta dentro de un grupo, entre participantes
  activos y vinculados, materializada como `settlement_by_transfer`:
  `transfer ∓N` en los Personales y `settlement −N` sobre el par por el
  importe completo, cruzando cero si toca (78 debidos + 80 transferidos → el
  acreedor debe 2); salir del grupo invalida la propuesta pendiente sin tocar
  `leave_group`; «Saldado» (`group_payment`) no cambia. Supera `data-model.md`
  §3 **sólo** para esta clase con dos voluntades.
- **ADR-004** — la solicitud de pago como capability opaca al portador
  (patrón de la invitación de grupo): importe y moneda fijos, concepto en la
  solicitud, un solo uso, 7 días, sin `declined`, cancelable por el creador,
  previsualización frenada, máximo 20 pendientes propias; pagarla materializa
  una `internal_transfer` del pagador al solicitante, y `paid` es para siempre.

Los cuatro son los previstos por la apertura de la fase; ninguno más está
previsto ni reservado. Un ADR nuevo toma el siguiente número libre al
redactarse.

## Notas posteriores

Los ADR aceptados no se editan; lo que la implementación precisa se anota
aquí, con fecha, y el bloque que lo fija se cita. Ninguna nota cambia el
contrato de producto: acotan cómo se materializa.

- **F12/ADR-001 §2 y §10 — dónde vive `public_name` (F12.A1, 2026-09-17).**
  El nombre público no va «en la misma fila» del handle: vive en una relación
  1:1 con la cuenta, `core.account_identity` (`user_id`, `public_name`,
  `handle_changed_at`), y `core.account_handle` lleva sólo el handle y sus
  marcas. Un handle no guarda instantáneas del nombre, y el cooldown de §9 se
  mide sobre la identidad, no sobre una fila de handle. El historial de
  handles que §2 y §9 exigen conservar vive en un diario insert-only,
  `core.account_handle_event`; la fila viva de una reserva caducada o de una
  retención vencida se desaloja perezosamente (§6, §9) y el diario la
  recuerda. Migración `20260921120000`; `supabase/checks/username.sql` A, D4, E.
- **F12/ADR-001 §7 y §8 — sesión anónima y códigos (F12.A1, 2026-09-17).**
  `api.reserve_username` admite una sesión anónima **sólo para reservar**
  (reserva provisional de 7 días), que es lo que necesita Invitado → cuenta en
  el cliente (F12.A3) sin abrir nada más al invitado; reclamar, cambiar,
  poner nombre y resolver con sesión anónima se rehúsan con
  `NOT_AUTHORIZED · 403`. Una cuenta normal que reserva reclama en el acto.
  Los códigos se acotan: **no existen** `USERNAME_RESERVATION_EXPIRED`,
  `USERNAME_GUEST_NOT_ALLOWED` ni `USERNAME_ALREADY_SET`. Reclamar con la
  reserva caducada o sin reserva responde `USERNAME_REQUIRED · 409` (la app
  enseña el gate en los dos casos); reclamar lo ya definitivo devuelve el
  estado sin error (idempotente por estado); una reserva propia viva se
  sustituye por la nueva. Los códigos de F12.A1 son exactamente
  `USERNAME_INVALID · 400`, `USERNAME_RESERVED · 422`, `USERNAME_TAKEN · 409`,
  `USERNAME_REQUIRED · 409`, `USERNAME_CHANGE_COOLDOWN · 409`
  (`details.available_at`), más `NOT_AUTHORIZED` y `PAYLOAD_INVALID`.
  `username.sql` C, D; `http-boundary-check.sh` §16.
- **F12/ADR-001 §11 y §14 — el resolver exige username propio, y es del
  provisioner (F12.A1, 2026-09-17).** `api.resolve_username` sólo responde a
  una cuenta normal **con handle definitivo** (`USERNAME_REQUIRED · 409` si
  no): quien no puede recibir no pregunta, y el oráculo de existencia queda
  detrás de una cuenta confirmada con identidad pública. Es `SECURITY
DEFINER` de `nomey_provisioner` —no de `postgres` como decía §11— bajo una
  política de `SELECT` con `USING (true)` del provisioner sobre identidades
  y handles, medida: ninguna función nueva de F12 es de `postgres` ni cruza
  RLS por propiedad. `sec.public_identity(uid)` (§13) sigue la misma regla y
  sólo la ejecutan el writer y el provisioner. `username.sql` A2, F, G3.

## Decisiones de otras fases que esta fase aplica

Las transferencias de F12 son distintas del pago declarado de F09/ADR-007 §2:
aquél es una declaración de una parte, acotada por la deuda y anulable; éstas
exigen dos voluntades y son irreversibles. F09/ADR-007 descartó reutilizar
`settlement_by_transfer` para el pago declarado, y sigue siendo correcto: F12
la usa para su propósito propio.

Se citan, no se copian ni se redefinen:

- [F01/ADR-001](../F01/ADR-001-accounting-model.md) — Modelo contable de Nomey (§10 precisado por F12/ADR-002 y F12/ADR-003)
- [F03/ADR-003](../F03/ADR-003-privilege-model.md) — Modelo de privilegios (precisado por F12/ADR-001: una función de `sec` para `supabase_auth_admin`)
- [F03/ADR-006](../F03/ADR-006-authoritative-write-boundary.md) — Frontera autoritativa de escritura (una función por clase)
- [F03/ADR-009](../F03/ADR-009-participant-identity.md) — Identidad de participantes sin cuenta y vínculo con usuarios
- [F03/ADR-010](../F03/ADR-010-persisted-vs-derived.md) — Persistido frente a derivado; `created_by` como atribución del actor
- [F05/ADR-003](../F05/ADR-003-guest-session.md) — Sesión de Invitado (fuera de todas las capacidades de F12)
- [F06/ADR-002](../F06/ADR-002-version-content-and-time.md) — Una transferencia no lleva concepto ni categoría
- [F09/ADR-002](../F09/ADR-002-client-provisioning-idempotency.md) — Idempotencia por clave del provisioning
- [F09/ADR-003](../F09/ADR-003-leaving-a-group.md) — Salir de un Grupo (ambos extremos activos ahora)
- [F09/ADR-004](../F09/ADR-004-group-invitations.md) — Invitaciones: precedente de capability opaca y de freno por cuenta
- [F09/ADR-007](../F09/ADR-007-group-payments-and-exit-without-debt.md) — Pagos registrados en el grupo, su anulación, y salir sin pendientes
- [F09/ADR-008](../F09/ADR-008-departed-obligation-immutable.md) — La obligación de quien salió es intocable
- [F10/ADR-002](../F10/ADR-002-permanent-identity.md) y [F10/ADR-003](../F10/ADR-003-active-and-historical-link.md) — Identidad permanente; vínculo activo e histórico
- [F10/ADR-005](../F10/ADR-005-personal-start.md) — `sec.counts_in_personal`: una transferencia sin efecto de grupo siempre cuenta
- [F11/ADR-001](../F11/ADR-001-fx-rate-resolution.md) — Las transferencias y liquidaciones no convierten
