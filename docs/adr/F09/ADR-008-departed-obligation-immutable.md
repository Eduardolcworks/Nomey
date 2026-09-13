# F09/ADR-008 — La obligación de quien salió del grupo es intocable

- **Estado:** Aceptado (2026-09-12). Decisión de producto tomada, punto de
  las altas retro-fechadas **decidido** (se rehúsan), e **implementado** en la
  migración `20260912170000_group_payments_and_departed.sql` (con F09/ADR-007):
  `sec.departed_effects_of_version`, `sec.assert_departed_unchanged`, su uso
  en `record_group_expense` (alta y corrección) y en `annul_operation`, que
  toma el rango 1. Evidencia contra las funciones reales, sin guardas
  simuladas, en local y desde cero en un stack aislado.
- **Fecha:** 2026-09-12
- **Identificador anterior:** ADR-039 (numeración única, anterior a la organización por fases del 2026-09-14)
- **Cierra** el punto abierto §5 de [F09/ADR-007](../F09/ADR-007-group-payments-and-exit-without-debt.md)
  (v3, que sigue siendo la base y no se reabre). **Precisa**
  [F09/ADR-003](../F09/ADR-003-leaving-a-group.md) §5–§6: la elegibilidad por fecha
  sigue igual, pero deja de bastar para corregir o anular un gasto que nombre
  a quien salió.

## Contexto: lo que hay, medido

- F09/ADR-003 §5–§6: quien salió sigue siendo elegible en gastos fechados dentro
  de su presencia, y **corregir o anular** esos gastos está permitido
  («permitido si su fecha original sigue dentro»). Medido (`departed-obligation-race-evidence.sh`,
  carrera 1): con Carlos ya fuera a cero, Ana corrige la cena de 20,00 a
  40,00 y **Carlos vuelve a deber 10,00** sin acceso al grupo y sin verlo en
  Personal (la excepción C6 de F09/ADR-007 está acotada a sus pagos).
- Con la regla de salida de F09/ADR-007 (cero pares por par), es **la única vía**
  que deja pendientes con alguien fuera.
- Guardas existentes que ya alcanzan parte del caso: `assert_correction_leaves_no_oversettled_debt`
  y `assert_annulment_leaves_no_oversettled_debt` rehúsan **reducir o
  anular** un par que tenga algo liquidado (`SETTLEMENT_EXCEEDS_DEBT`); como
  quien salió a cero tiene liquidado todo lo que debía, esas guardas cubren
  hoy «bajar» y «anular» sus pares. **No cubren**: subir su cuota o su deuda
  (medido: B), cambiarle el acreedor con el mismo neto (C), cambiar su cuota
  sin tocar el par, ni su caja como pagador; y dejan de cubrir cualquier cosa
  en cuanto su pago se anula (F09/ADR-007 C4), que es cuando el par vuelve a
  estar sin liquidación.
- La guarda de **retirados** (`sec.assert_retired_debt_unchanged`,
  `sec.assert_no_retired_debt`, F09/ADR-003 §6) compara el multiconjunto de
  efectos de deuda que nombran a un retirado entre la versión vigente y la
  nueva. Es el patrón que este ADR generaliza a quien salió, ampliado a la
  cuota y a la caja.
- `api.annul_operation` **no toma el cerrojo de identidad** (medido:
  carrera 3, espera 0,0 s frente a una salida en curso); `record_group_expense`
  sí (carrera 1: 1,9 s).

## Decisión

> **Una vez que un participante ha salido, ninguna corrección ni anulación
> de un gasto puede cambiar lo que ese gasto le atribuye.** Lo que se
> compara es, para cada participante **salido** que la versión vigente o la
> nueva nombren, el multiconjunto exacto de:
>
> - efectos de **deuda** que le nombran, por par **y dirección**, con su
>   importe (`debtor > creditor : amount`);
> - su **cuota económica** (`economic_participant_id`, `economic_amount`);
> - la **caja** en su Modo Personal (`balance_amount` en su ámbito personal,
>   si era pagador con cuenta).
>
> Si el texto canónico de ese multiconjunto difiere entre la versión vigente
> y la nueva, **`DEPARTED_OBLIGATION_CHANGED · 422`**, y la versión entera se
> revierte. Una anulación es una versión sin efectos: se rehúsa si la versión
> vigente le atribuye **algo**.

- **Salido** = participante sin periodo abierto (`participant_period.valid_until`
  no nulo en el último) **y no retirado**. Los retirados siguen bajo su
  propia guarda (F09/ADR-003 §6 / F09/ADR-005), que no cambia.
- **Por qué no basta el neto.** «Neto cero» admite pendientes compensados:
  cambiar la pagadora de Ana a Bea deja a Carlos debiendo 30,00 en neto pero
  **a otra persona** (medido: C, rehusado); una novación o un par cruzado
  también. Por eso se compara **par a par y por dirección**, y además la cuota
  y la caja, que no son deuda.
- **Lo que sigue permitido**, medido: concepto y categoría (E); un cambio
  económico **sólo entre activos** que deje idénticos los efectos del salido
  (F: Ana 20,00 / Bea 40,00 / Carlos 30,00 sobre los mismos 90,00 — Bea>Ana
  sube, Carlos intacto).
- **Fecha efectiva:** cambiarla a una fuera de su presencia ya lo rehúsa
  `PARTICIPANT_NOT_ELIGIBLE` (F09/ADR-003 §5); dentro de ella, sólo pasa si el
  multiconjunto no cambia (la fecha no forma parte de él).

### Operaciones protegidas, y las que no

| Escritura                                      | Con un participante **salido** (a cero)                                                                                                                                                                                                                                                                                                                    | Estado                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `record_group_expense`, alta que le nombre     | de hoy o posterior: `PARTICIPANT_NOT_ELIGIBLE` (fecha); **retro-fechada dentro de su presencia: `DEPARTED_OBLIGATION_CHANGED · 422`**, la operación entera rehusada sin escritura parcial (ni versión, ni efectos, ni clave de idempotencia). Es la misma condición que una corrección: nombrarle en una versión nueva que le atribuya deuda, cuota o caja | decidido, implementado |
| `record_group_expense`, corrección             | `DEPARTED_OBLIGATION_CHANGED` si cambia deuda por par, cuota o caja suyas; concepto/categoría/hora y cambios entre activos, permitidos                                                                                                                                                                                                                     | implementado           |
| `annul_operation` sobre un gasto               | `DEPARTED_OBLIGATION_CHANGED` si la versión vigente le atribuye algo                                                                                                                                                                                                                                                                                       | implementado           |
| `annul_operation` sobre un **`group_payment`** | **fuera de esta guarda**: contrato v3 íntegro (pagador/receptor dentro o fuera, C4 retirados, C6 visibilidad acotada)                                                                                                                                                                                                                                      | F09/ADR-007            |
| `record_group_payment`, alta                   | ambos activos (F09/ADR-007): sin cambio                                                                                                                                                                                                                                                                                                                    | F09/ADR-007            |
| `retire_participant`, `settle_participant`     | sin cambio                                                                                                                                                                                                                                                                                                                                                 | existente              |

**Dónde vive la guarda.** Como la de retirados: en `record_group_expense`,
**después** de escribir los efectos de la versión nueva
(`sec.assert_departed_unchanged(v_version, v_expected)`, junto a
`assert_retired_debt_unchanged`; en un alta `v_expected` es nulo y el lado
viejo es vacío), de modo que un rechazo revierte la versión completa; en
`annul_operation`, antes de persistir la anulación, sobre la versión vigente
(`sec.departed_effects_of_version(v_expected) <> '{}'`), **sólo para
versiones de clase distinta de `group_payment`**. La lista de efectos se
calcula con `sec.departed_effects_of_version(version)`, hermana de
`sec.retired_debt_of_version`; el conjunto de salidos se **acota al grupo de
la versión** (medido: sin acotar, un salido de otro grupo tropezaba con la
regla de caja en el Personal compartido).

**La elegibilidad por fecha no tapa a la guarda (2026-09-13).** Medido en
dispositivo: quien reclama, aparece en una cena de ese día y sale a cero ese
mismo día queda con una presencia **vacía** (`[hoy, hoy)`, F09/ADR-003 §5: el día
de salida se excluye), y la cena —válida cuando se registró— dejaba de poder
corregirse **hasta en el concepto**: `PARTICIPANT_NOT_ELIGIBLE` saltaba antes
que esta guarda. Lo mismo ocurre siempre que alguien sale el día de un gasto
suyo. Se precisa F09/ADR-003 §5 en un punto: **en una corrección, quien ya
constaba en el reparto de la versión que se corrige, en su misma fecha, no
vuelve a pasar por la elegibilidad** (`sec.participant_kept_in_version`);
lo que protege su obligación es esta guarda. Mover la fecha, nombrar a
alguien nuevo o un alta siguen exigiendo elegibilidad (medido:
`departed-obligation-evidence.sql` K, `leave-and-settle.sql` F1/F3b).

### Concurrencia

La guarda lee «quién ha salido», que es identidad de grupo: tiene que leerse
**después del cerrojo de identidad** (`20260912150000`). Medido:

- **Salir → corregir** (carrera 1): `record_group_expense` toma el rango 1 y
  espera (1,9 s); entra con la salida ya confirmada, y la guarda simulada
  sobre lo que escribió responde `DEPARTED_OBLIGATION_CHANGED`. La
  serialización existente **basta** para las correcciones.
- **Corregir → salir** (carrera 2): salir espera y comprueba los pares sobre
  la versión ya corregida: `LEAVE_BLOCKED_DEBT`.
- **Salir → anular** (carrera 3): `annul_operation` toma ahora el rango 1 y
  **espera** (1,9 s); entra con la salida confirmada y la guarda decide sobre
  ese estado. La guarda de catálogo `group-identity-lock.sql` lo vigila
  (`annul_operation`, `record_debt_settlement` y `record_group_payment` en
  la lista de las diez funciones que toman el cerrojo antes de leer identidad).
- **Salir → alta retro-fechada** (1b) y **alta → salir** (2b): la alta espera
  y es rehusada sin escritura parcial —ni la clave—; en el otro orden salir
  espera y ve la deuda del alta (`LEAVE_BLOCKED_DEBT`).
- **Anular → salir** (3b): salir espera y sale a cero.

## Evidencia

- **Contra las funciones reales:** `supabase/checks/departed-obligation-evidence.sql`
  (A–J, rollback; `lib/group-payment-helpers.sql` delante, que sólo lee y
  envuelve): B importe (rehusada), C acreedor y cuota (rehusadas, sin
  liquidación vigente que las enmascare), D anulación (rehusada), E concepto y
  categoría (permitida), F cambio sólo entre activos (permitida), G anulación
  del pago de quien salió (v3 íntegro: permitida, reapertura acotada, sin
  readmisión, fuera de esta guarda), H retirado intermedio (C4 íntegro; la
  guarda no confunde retirado con salido), **I alta retro-fechada rehusada sin
  escrituras parciales**, **J alta y corrección válidas entre activos**.
- **Serialización real:** `scripts/departed-obligation-race-evidence.sh` (seis
  carreras, dos sesiones, writers reales: salir frente a alta, corrección y
  anulación, en los dos órdenes; espera medida 1,9–2,0 s).
- `supabase/checks/leave-and-settle.sql` F1: el alta de ayer con quien
  salió, que F09/ADR-003 §5 permitía, responde ahora `DEPARTED_OBLIGATION_CHANGED`.
- Medido desde cero en un stack aislado (`NomeyIso`, 39 migraciones), y en
  CI: los dos checks y las dos carreras.

## Alternativas consideradas

- **Comparar sólo el neto del salido.** Descartada: admite pendientes
  compensados (C) y no ve cuota ni caja.
- **Bloquear toda corrección de un gasto que nombre a un salido.**
  Descartada: impediría arreglar un concepto o repartir de otro modo entre
  los activos, sin ganancia contable.
- **Hacer visible al salido la deuda nueva por corrección.** Descartada por
  decisión: la excepción C6 queda acotada a sus pagos; la solución es no
  poder crearla.

## Consecuencias

- Los miembros no pueden reasignar retroactivamente a quien salió ni una
  cuota ni una deuda: si un gasto de entonces estaba mal, lo corrigen entre
  los activos (F) o lo dejan.
- Se generaliza a salidos el patrón que ya existía para retirados, con dos
  dimensiones más (cuota y caja); dos guardas hermanas, dos códigos.
- `annul_operation` gana el rango 1 (ya requerido por F09/ADR-007).
- Un alta retro-fechada que nombre a quien salió ya no entra: el gasto de
  entonces que faltaba se registra entre los activos, o no se registra.

## Punto cerrado: altas retro-fechadas

**Decidido (2026-09-12): se rehúsan.** Una alta nueva fechada dentro de la
antigua presencia de quien salió le crearía un pendiente igual que una
corrección al alza; se rehúsa con el mismo código y la misma condición
—nombrarle en una versión nueva que le atribuya deuda, cuota o caja— y la
elegibilidad por fecha queda como estaba para todo lo demás. La operación se
rehúsa entera: el rechazo ocurre dentro de la transacción del writer, después
de la clave de idempotencia y de los efectos, así que ni la clave ni la versión
sobreviven (medido en el check I y en la carrera 1b).
