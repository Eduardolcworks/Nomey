# F08 — Distribución interna y entornos

**Alcance:** Código nativo (CNG), variantes y entornos. F8.A cerrada; F8.B y F8.C pendientes. **Estado de la fase:** Abierta (F8.B, F8.C). El detalle está en
[el roadmap](../../product/roadmap.md).

Los ADR de esta carpeta se numeran de forma independiente (`F08/ADR-NNN`) y
la identidad completa es siempre fase y número. Consulta este índice antes de
elegir un número; no se renumera ni se reutiliza. Convención completa en
[`docs/adr/README.md`](../README.md).

## ADR de esta fase

| ADR                                                 | Título                                                        | Estado   | Fecha      | Antes   |
| --------------------------------------------------- | ------------------------------------------------------------- | -------- | ---------- | ------- |
| [F08/ADR-001](ADR-001-native-code-model.md)         | Modelo de código nativo: CNG con config plugins               | Aceptado | 2026-09-04 | ADR-030 |
| [F08/ADR-002](ADR-002-environments-and-variants.md) | Contrato de entornos, variantes y separación de configuración | Aceptado | 2026-09-04 | ADR-031 |

## Decisiones de otras fases que esta fase aplica

Se citan, no se copian ni se redefinen:

- [F03/ADR-010](../F03/ADR-010-persisted-vs-derived.md) — Persistido frente a derivado, reparto contextual y proyección canónica
