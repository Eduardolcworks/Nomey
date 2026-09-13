# F11 — Multimoneda operativa

**Alcance:** Fuente de tipos de cambio con histórico por fecha efectiva, conversión, jerarquía visual del importe original, cambio de moneda base. **Estado de la fase:** No abierta. El detalle está en
[el roadmap](../../product/roadmap.md).

Los ADR de esta carpeta se numeran de forma independiente (`F11/ADR-NNN`) y
la identidad completa es siempre fase y número. Consulta este índice antes de
elegir un número; no se renumera ni se reutiliza. Convención completa en
[`docs/adr/README.md`](../README.md).

## ADR de esta fase

Ninguno todavía. El primero que se redacte será `F11/ADR-001`.

## Decisiones de otras fases que esta fase aplica

La representación del dinero y del tipo congelado ya están decididas; el pago declarado rehúsa la conversión hasta que exista la regla de FX.

Se citan, no se copian ni se redefinen:

- [F02/ADR-001](../F02/ADR-001-money-representation.md) — Representación exacta del dinero
- [F03/ADR-001](../F03/ADR-001-currency-definition-identity.md) — Identidad física de la definición monetaria
- [F03/ADR-012](../F03/ADR-012-frozen-rate-physical-representation.md) — Representación física del tipo de cambio congelado
- [F09/ADR-007](../F09/ADR-007-group-payments-and-exit-without-debt.md) — Pagos registrados en el grupo, su anulación, y salir sin pendientes
