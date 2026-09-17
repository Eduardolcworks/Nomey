# F01 — Modelo contable y reglas de dominio

**Alcance:** Operación, efecto, dimensiones (caja, económica, deuda), escenarios e invariantes de `data-model.md`. **Estado de la fase:** Cerrada. El detalle está en
[el roadmap](../../product/roadmap.md).

Los ADR de esta carpeta se numeran de forma independiente (`F01/ADR-NNN`) y
la identidad completa es siempre fase y número. Consulta este índice antes de
elegir un número; no se renumera ni se reutiliza. Convención completa en
[`docs/adr/README.md`](../README.md).

## ADR de esta fase

| ADR                                        | Título                   | Estado   | Fecha      | Antes   |
| ------------------------------------------ | ------------------------ | -------- | ---------- | ------- |
| [F01/ADR-001](ADR-001-accounting-model.md) | Modelo contable de Nomey | Aceptado | 2026-08-18 | ADR-002 |

## Notas posteriores al cierre de la fase

Los ADR aceptados no se editan; lo que un ADR posterior precisó se anota
aquí, con fecha, citando el ADR que lo hace.

- **F01/ADR-001 §10 («Permisos y efectos sobre otros usuarios») e
  invariante 14 — precisados por
  [F12/ADR-002](../F12/ADR-002-two-will-user-transfers.md) y
  [F12/ADR-003](../F12/ADR-003-group-transfers.md) (Aceptados, 2026-09-17).**
  Con el descubrimiento global por username desaparece el supuesto de
  relación previa entre las dos cuentas, y Nomey no mueve dinero: una
  transferencia entre usuarios es una declaración. Por eso una
  `internal_transfer` (y la transferencia dentro de un grupo,
  `settlement_by_transfer`) **sólo existe con dos voluntades**: quien envía
  autoriza la salida de su Personal al proponer (o al pagar una solicitud) y
  quien recibe la acepta (o la solicitó). «Originar una salida» pasa a
  significar **autorizarla** con importe, moneda y destinatario fijos; quien
  acepta **materializa** exactamente esa propuesta, y **sin propuesta válida
  nadie puede provocar una salida ajena**. No es una confirmación previa de
  efectos —la propuesta no es contable— ni cambia nada en los ámbitos
  compartidos, donde el gasto de grupo y el pago declarado siguen siendo
  inmediatos. La quinta capa («corrección») se satisface para estas dos
  clases como **compensación** (invariante 11): una transferencia
  materializada tiene una sola versión y se compensa con otra.
