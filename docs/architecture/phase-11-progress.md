# F11 · Seguimiento de la fase

> **Qué es esto.** El documento de trabajo de una fase **abierta**: estado,
> evidencia medida y limitaciones conocidas. **No es normativo** y no decide
> nada. La decisión de F11.A es
> [F11/ADR-001](../adr/F11/ADR-001-fx-rate-resolution.md), y cualquier regla
> nueva exigiría un ADR en `docs/adr/F11/`. Lo que aquí se dice sobre cómo
> encajar el contrato con F9 es **lectura conjunta de ADR ya aceptados**, no una
> regla adicional. Cuando F11 cierre, su handoff lo sustituirá.

## Estado

| Bloque    | Estado                                                                               |
| --------- | ------------------------------------------------------------------------------------ |
| **F11.A** | **Cerrado**: contrato de fuente y resolución en F11/ADR-001. Sin implementación      |
| **F11.B** | Pendiente: catálogo, fijación diaria, ingesta, resolver en SQL, conversión congelada |
| **F11.C** | Pendiente: lecturas, estadísticas, cola sin conexión y presentación                  |
| **F11.D** | Pendiente: integración del gasto de grupo y cierre de los criterios de la fase       |

**Hoy no existe ninguna conversión.** Toda operación en una moneda distinta de
la base de un ámbito alcanzado responde `CURRENCY_CONVERSION_UNSUPPORTED · 422`.

## Integración con F9 (2026-09-14)

F11.A se integró sobre `main` en `e3af705` (cierre de F9, 46 migraciones). La
rama de F11 no aporta código, migraciones, checks, scripts ni tipos generados:
sólo documentación.

**Identidad del ADR.** El ADR de F11.A se redactó en su rama como `ADR-032` de
la numeración única, identificador que en `main` pertenece a
[F09/ADR-001](../adr/F09/ADR-001-group-model-and-permissions.md). Se renumeró a
`F11/ADR-001` **antes de integrar** (regla 5 de
[`docs/adr/README.md`](../adr/README.md)), traduciendo sus referencias con la
tabla de equivalencias. **Su contenido es el aceptado**: al integrar sólo
cambiaron identidad, rutas de enlace y la línea de metadata «Identificador
anterior», como permite el protocolo.

### Negativas de conversión vigentes

Medido sobre el catálogo vivo de una pila aislada levantada desde cero con las 46
migraciones:

- **Nueve funciones** llaman a `sec.assert_no_conversion`, con quince llamadas:
  `record_personal_expense` (1), `record_personal_income` (1),
  `record_adjustment` (1), `record_external_transfer` (1),
  `record_internal_transfer` (2), `record_group_expense` (2),
  `record_debt_settlement` (1), `record_group_payment` (3) y
  `record_settlement_by_transfer` (3).
- **`sec.incorporate_participant_cash`** (asociar un fantasma, F09/ADR-009) lanza
  `CURRENCY_CONVERSION_UNSUPPORTED` por su cuenta cuando la base del grupo y la
  del Modo Personal difieren.

Por F11/ADR-001 §4, la conversión se abre **sólo** para `personal_expense`,
`personal_income` y `group_expense`. Todo lo demás conserva su negativa tal como
está: no hay nada que decidir para ello, porque ninguna otra clase ni flujo
figura entre los que admiten moneda extranjera.

### Funciones compartidas

| Función                      | Qué añadió F9                                                                                        | Qué necesitará F11                                                                             | Compatibilidad                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `api.record_group_expense`   | Concepto, hora, categoría por defecto, avisos de edición, cerrojo de identidad, guardas canónicas    | Resolución en sus dos puntos de negativa y la base asumida al capturar (F11/ADR-001 §10 y §11) | Compatible, en una migración nueva sobre su cuerpo vigente |
| `api.annul_operation`        | Autorización por partes de `group_payment`, cerrojo de rango 1, identidad canónica, sobreliquidación | Nada: anular crea una versión sin efectos y sin conversión                                     | Compatible sin cambios                                     |
| `sec.persist_version`        | `OPERATION_NOT_ANNULLABLE` para `departure_novation`                                                 | Nada en F11.A; F11.B no debe rodear sus guardas de clase y de anulación                        | Compatible                                                 |
| `api.record_debt_settlement` | Cerrojo de rango 1 y ambos extremos activos                                                          | Nada: es una liquidación                                                                       | Conserva su negativa                                       |
| `api.claimed_dimension`      | La deuda exige vínculo y membresía, excepción C6, resolución canónica                                | Nada en F11.A: cada fila ya lleva su `currency_definition_id`                                  | Compatible                                                 |
| `api.personal_operation`     | Fila de gasto de grupo con `your_share`, clase `group_payment` con contraparte                       | Publicar moneda original y convertida conservando esas clases y su contexto (F11.C)            | Compatible, recreando desde el cuerpo vigente              |

**El contrato vigente de `record_group_expense`** (cuerpo de
`20260912170000_group_payments_and_departed.sql`): exige `currency_definition_id`
y lo incluye en la intención canónica; `sec.assert_payload_shape` rechaza
cualquier campo que no esté en su lista; hay dos negativas de conversión, sobre
el ámbito del grupo y sobre el Modo Personal del pagador, que se resuelve con
`sec.participant_personal_scope` y es nulo para un fantasma. **El gasto de grupo
no pasa por la cola sin conexión**: la cola admite `personal_expense.create`,
`personal_income.create` y `group.create`.

### Cómo se lee F11/ADR-001 junto al protocolo de F9

No es una regla nueva: resulta de aplicar a la vez ADR ya aceptados.

- **Dónde se resuelve.** F11/ADR-001 §6 fija el orden **entre los resultados de
  FX**. F03/ADR-008 §13 exige resolver el replay antes de autorizar, y los ADR
  de F9 fijan el cerrojo de identidad, la membresía, la elegibilidad por fecha y
  el orden de locks. Aplicarlos a la vez sitúa la resolución en el punto donde
  cada función llama hoy a `sec.assert_no_conversion`, **sin reordenar nada de
  F9**.
- **La base asumida en el gasto de grupo.** F11/ADR-001 §11 ya exige que
  `record_group_expense` la transporte. Añadirla a su lista de campos y a su
  intención canónica es una migración **posterior a
  `20260914160000_positions_cas_visible_participants.sql`**, partiendo del
  cuerpo vigente de F9 para no revertir ninguna de sus reglas.

## Limitaciones conocidas

### Liquidar entre bases monetarias distintas

**Es una restricción que F9 ya tiene y F11 conserva a propósito.**

- **Qué pasa hoy.** `record_group_payment` exige que la moneda del pago sea la
  base del grupo **y** la del Modo Personal de cada punta con cuenta, y
  `leave_group` exige neto cero. Quien tiene un Modo Personal en una moneda
  distinta de la base del grupo **no puede registrar ni recibir un pago
  declarado**, y si queda deudor o acreedor **tampoco puede salir**. Leído en
  los cuerpos vigentes del catálogo de la pila aislada; no se ejecutó un pago
  de prueba.
- **No es un fallo de la integración F9 + F11.** Ocurre igual en `main` sin la
  rama de F11, y ninguna pieza de F11 lo provoca ni lo agrava.
- **Queda fuera del alcance de F11** por la decisión de producto 2 de
  [F11/ADR-001](../adr/F11/ADR-001-fx-rate-resolution.md): las liquidaciones y
  los pagos entre monedas o bases distintas no se convierten en F11.
- **F11.B no debe implementarlo**, ni las conversiones que sólo harían falta
  para esos flujos. La caja incorporada al asociar un fantasma tampoco se
  convierte en F11, por otro motivo: F11/ADR-001 §4 sólo abre la moneda
  extranjera para tres clases, y la asociación no es ninguna de ellas.
- **Con F11**, esa persona podrá pagar gastos del grupo en otra moneda, pero no
  liquidarlos.
- [F09/ADR-007](../adr/F09/ADR-007-group-payments-and-exit-without-debt.md)
  describe esa negativa como vigente «hasta F11»: es una expectativa escrita en
  F9, no una decisión de F9, y no cambia lo decidido para F11.

### Las estadísticas personales suman monedas distintas

**Defecto preexistente en `main`, anterior e independiente de F11.** Lo
introdujo `20260910120000_personal_statistics_shared_share.sql`, de F9; esta
rama no toca ni SQL ni cliente.

- **Qué pasa.** `api.personal_statistics` suma a `expense_total` y al desglose
  por categoría la cuota del actor en gastos compartidos, **en la moneda de cada
  grupo**, sin filtrar por moneda, sobre un total expresado en la base personal.
- **Medido** (sonda con `ROLLBACK` contra las funciones reales): base personal
  EUR, un gasto propio de 10,00 EUR y la cuota de 2500 JPY del actor en un gasto
  de un grupo en JPY pagado por una participante sin cuenta →
  `expense_total = 3500` con `currency_definition_id` EUR. Basta con
  **participar sin pagar** en un grupo cuya base difiere de la del Modo
  Personal; no hace falta ninguna conversión.
- **Por qué es un defecto.** Suma definiciones monetarias distintas sin
  conversión, contra F02/ADR-001 §3 y el criterio de cierre 5 de F11. La propia
  migración de F9 lo deja como «punto abierto». La deuda de Inicio
  (`src/features/groups/group-projection.ts`) sí se niega a sumar monedas
  distintas.
- **Dónde se resuelve: F11.C**, que es el bloque de estadísticas y superficies
  de lectura (F11/ADR-001 §12). Excluir, convertir o mostrar aparte esas cuotas
  es una decisión de producto pendiente para ese bloque. **No se corrige en
  F11.A.**

## Discrepancias documentales anotadas

- **Cambio de moneda base con historia.** F06/ADR-001 (Consecuencias),
  F09/ADR-001 («Cambio de moneda base de un grupo — F11, con conversión») y
  `PROJECT_STATE.md` lo sitúan en F11, pero F01/ADR-001 §8 fija la base inmutable
  tras la primera operación, y F11/ADR-001 no lo incluye. El cambio **sin
  efectos** que ya permite F09/ADR-001 §4 no está afectado.
- **`record_settlement_by_transfer` como «writer de F11».** F09/ADR-007 lo llama
  así; es una liquidación y queda fuera de la conversión en F11.

## Evidencia de la integración

Sobre el árbol combinado (`main` en `e3af705` más F11.A, commit `c62d579`) y una
pila Supabase aislada (`NomeyIso`) levantada desde cero con las 46 migraciones:

| Validación                                                                                                    | Resultado                   |
| ------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Pasos de base de datos de `ci.yml`: 30 checks SQL, 7 carreras con sesiones reales, frontera HTTP con JWT real | **38/38 OK**                |
| `src/types/database.ts` regenerado desde el esquema combinado                                                 | Idéntico al del repositorio |
| `npx vitest run --maxWorkers=1`                                                                               | 130 ficheros, 3745 tests OK |
| `npm run verify`                                                                                              | OK                          |

**Observación sin diagnosticar:** el check `personal-statistics` tardó 1316 s en
la pila aislada; antes de F9, en la misma máquina, tardaba 25 s. Su caso F
agrega 1200 operaciones.
