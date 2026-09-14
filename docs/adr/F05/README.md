# F05 — Identidad y sesión

**Alcance:** Sesión segura en el dispositivo y recuperación de acceso. **Estado de la fase:** Cerrada. El detalle está en
[el roadmap](../../product/roadmap.md).

Los ADR de esta carpeta se numeran de forma independiente (`F05/ADR-NNN`) y
la identidad completa es siempre fase y número. Consulta este índice antes de
elegir un número; no se renumera ni se reutiliza. Convención completa en
[`docs/adr/README.md`](../README.md).

## ADR de esta fase

| ADR                                                  | Título                                                  | Estado   | Fecha      | Antes   |
| ---------------------------------------------------- | ------------------------------------------------------- | -------- | ---------- | ------- |
| [F05/ADR-001](ADR-001-secure-session-storage.md)     | Persistencia segura de la sesión en el dispositivo      | Aceptado | 2026-08-27 | ADR-017 |
| [F05/ADR-002](ADR-002-ephemeral-recovery-session.md) | La sesión de recuperación es efímera y no se promociona | Aceptado | 2026-08-28 | ADR-018 |

## Decisiones de otras fases que esta fase aplica

Se citan, no se copian ni se redefinen:

- [F03/ADR-004](../F03/ADR-004-membership-rls.md) — Comprobación de membresía y estrategia de RLS
