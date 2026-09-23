# F11 · Seguimiento de la fase

> **Qué es esto.** El documento de trabajo de una fase **abierta**: estado,
> evidencia medida y limitaciones conocidas. **No es normativo** y no decide
> nada. La decisión de F11.A es
> [F11/ADR-001](../adr/F11/ADR-001-fx-rate-resolution.md), sustituido
> parcialmente por [F11/ADR-002](../adr/F11/ADR-002-per-currency-daily-rate.md), y cualquier regla
> nueva exigiría un ADR en `docs/adr/F11/`. Lo que aquí se dice sobre cómo
> encajar el contrato con F9 es **lectura conjunta de ADR ya aceptados**, no una
> regla adicional. Cuando F11 cierre, su handoff lo sustituirá.

## Estado

| Bloque    | Estado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F11.A** | **Cerrado**: contrato de fuente y resolución en F11/ADR-001. Sin implementación                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **F11.B** | En curso sobre F11/ADR-002: **B1** (dominio y vectores), **B2** (catálogo y cobertura curada) y **B3** (ingesta y fijación diaria) cerrados e integrados (PR #70); **B4** (resolver y conversión en SQL, PR #72) y **B5** (writers personales con `core.frozen_conversion` y su procedencia, `20260929120000`) cerrados también. Convierten `personal_expense` y `personal_income`, y ninguna otra clase. **No se despliega sin F11.C** (ver abajo)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **F11.C** | Integrado (`20261001120000`): `api.personal_operation` publica la moneda original junto al importe original; el tipo congelado y la atribución al BCE salen de `api.personal_operation_conversion`, lectora `SECURITY DEFINER` que autoriza por propiedad del ámbito; el desglose de estadísticas suma la magnitud convertida; la edición corrige en la moneda declarada; la cola espera una fijación con plazo propio. Sin selector de moneda para crear                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |     |
| **F11.D** | Integrado (`20261003120000`, F11/ADR-003): el gasto de grupo admite moneda extranjera; el total se convierte una vez a la base del grupo y el reparto ocurre después, cada ámbito alcanzado convierte desde el original, la cuota de cada participante se persiste en la base de su Modo Personal, y sin cobertura de cualquiera de ellas se rechaza el gasto entero. La **interfaz** llegó después (`20261004120000`): el control de moneda de `AmountSheet` abre el catálogo de `api.currency_definition` al dar de alta y al corregir, tanto un movimiento personal como un gasto de grupo; lo elegido es la moneda de la OPERACIÓN y viaja con `expected_base_currency_definition_id`; la fila del grupo enseña el convertido, el tipo y su fuente por `api.group_operation_conversion`; los tres rechazos de cambio se dicen por su causa; y una entrada encolada en otra moneda se anuncia «Conversión pendiente» y no entra en ningún agregado. Queda el cierre de los cinco criterios de la fase |     |

### Decisiones de implementación de F11.B (2026-09-15)

Tomadas al preparar F11.B. Las de producto que cambian el contrato están en
[F11/ADR-002](../adr/F11/ADR-002-per-currency-daily-rate.md); estas son las demás:

- **`record_group_expense` no se toca en F11.B.** Ni la moneda del grupo ni el
  Personal del pagador se convierten hasta F11.D.
- **Una conversión que redondea a cero** unidades mínimas, tras el único
  redondeo, **se acepta**; no hay rechazo adicional.
- **Fechas.** Una fecha anterior a la primera publicación del BCE da
  `FX_CURRENCY_NOT_COVERED · 422`. Una fecha absurda o no operativa, como
  `infinity`, da `PAYLOAD_INVALID`, igual en TypeScript y en SQL. Ninguna fecha
  que nunca pueda llegar a estar disponible responde 503 indefinidamente.
- **Ingesta sólo en local y CI.** La de producción espera al entorno verificado
  de F8; no se contrata ni se introduce infraestructura de producción. CI la
  ejercita con documentos sintéticos; la carga local está en
  [`runbooks/fx-ingest.md`](../runbooks/fx-ingest.md).
- **Segunda barrera en base de datos.** El tipo congelado no puede diferir del
  tipo fijado para ese día, compatible con correcciones y replays.

**Hoy no existe ninguna conversión.** Toda operación en una moneda distinta de
la base de un ámbito alcanzado responde `CURRENCY_CONVERSION_UNSUPPORTED · 422`.

### Dependencia de planificación: F11.B no se despliega sin F11.C

**Decisión de planificación del 2026-09-15, no una decisión sobre el modelo
monetario.** F11.B **no se considera completo ni desplegable por separado de
F11.C** en cuanto habilite operaciones personales en moneda extranjera. Antes de
desplegarlo o habilitarlo en producción tiene que estar resuelto cómo se
comportan `api.personal_operation` y las lecturas y estadísticas afectadas.

- **Por qué.** F11/ADR-001 («En contra») ya enumera los supuestos vigentes que
  dejan de cumplirse solos y asigna a F11.C preservarlos (§12):
  `api.personal_operation` publica `original_amount` junto a la moneda del
  **efecto**, y la comprobación de F06/ADR-008 §6 (suma de categorías =
  `expense_total`) exige sumar la magnitud convertida. Con F11.B desplegado y
  F11.C pendiente, un gasto en USD en un Personal en EUR se listaría con su
  importe en USD etiquetado como EUR, sin ningún error (inferido de la
  definición vigente de la vista; no medido).
- **Qué no cambia.** Ni el contrato de F11/ADR-001 ni el reparto de trabajo de
  su §12: F11.C sigue siendo quien implementa esas lecturas. F11.C no se
  implementa ahora.

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
migraciones de F9. Las dos de F10.A2 (`20260915120000` y `20260916120000`) no
llaman a `sec.assert_no_conversion` ni redefinen ninguna de estas funciones
(leído en el repositorio, no medido en catálogo):

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
`personal_income` y `group_expense`. Las demás clases conservan su negativa tal
como está. **La negativa de `sec.incorporate_participant_cash` no está
decidida**: la caja que incorpora puede proceder de un gasto de grupo, que sí
admite moneda extranjera. Ver [Decisiones abiertas](#decisiones-abiertas).

### Funciones compartidas

| Función                            | Qué añadió F9                                                                                        | Qué necesitará F11                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Compatibilidad                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `api.record_group_expense`         | Concepto, hora, categoría por defecto, avisos de edición, cerrojo de identidad, guardas canónicas    | Resolver **todas** sus conversiones **tras el cerrojo de identidad** (necesita el Modo Personal del pagador) y **antes de escribir el reparto resultante**, que se calcula sobre el total convertido junto con las cuotas, las deudas y la guarda de sobreliquidación; no sólo en sus dos puntos de negativa, y sin obligar a convertir antes del replay ni de lo que hoy precede a reclamar el comando (ver [cómo se lee junto a F9](#cómo-se-lee-f11adr-001-junto-al-protocolo-de-f9)). Transportar la base asumida (F11/ADR-001 §10 y §11). **No se habilita moneda extranjera antes de que F11.D decida los dos casos abiertos** | Compatible, en una migración nueva sobre su cuerpo vigente        |
| `api.annul_operation`              | Autorización por partes de `group_payment`, cerrojo de rango 1, identidad canónica, sobreliquidación | Nada: anular crea una versión sin efectos y sin conversión                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Compatible sin cambios                                            |
| `sec.persist_version`              | `OPERATION_NOT_ANNULLABLE` para `departure_novation`                                                 | Nada en F11.A; F11.B no debe rodear sus guardas de clase y de anulación                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Compatible                                                        |
| `api.record_debt_settlement`       | Cerrojo de rango 1 y ambos extremos activos                                                          | Nada: es una liquidación                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Conserva su negativa                                              |
| `api.claimed_dimension`            | La deuda exige vínculo y membresía, excepción C6, resolución canónica                                | Nada en F11.A: cada fila ya lleva su `currency_definition_id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Compatible                                                        |
| `api.personal_operation`           | Fila de gasto de grupo con `your_share`, clase `group_payment` con contraparte                       | Publicar moneda original y convertida conservando esas clases y su contexto (F11.C)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Compatible, recreando desde el cuerpo vigente                     |
| `api.group_operation`              | Cuota del actor como suma de sus identidades canónicas (F09/ADR-009)                                 | Publicar la moneda original: hoy etiqueta `total_amount` (el importe original) con la moneda del efecto, lo que sólo es correcto sin conversión (F11.C)                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Compatible, recreando desde el cuerpo vigente                     |
| `sec.incorporate_participant_cash` | Caja histórica del fantasma asociado, escrita una vez (F09/ADR-009)                                  | **Decidido en F11/ADR-003 §7**: la caja es el importe del gasto en la moneda del ámbito —la suma del reparto persistido—, nunca el importe declarado. La negativa por base distinta se conserva                                                                                                                                                                                                                                                                                                                                                                                                                                      | Correcta hoy sólo porque ningún gasto de grupo admite otra moneda |

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

- **La conversión no se inserta donde hoy están las guardas: se resuelve antes
  de escribir el reparto resultante.** En el cuerpo vigente de `record_group_expense`
  (`20260912170000_group_payments_and_departed.sql`) el reparto se calcula en
  la línea 520 con `sec.resolve_split` sobre el importe **declarado**, antes de
  reclamar el comando, y ese `v_resolved` es el que escriben las cuotas, las
  deudas y `core.split`, y el que usa la guarda de sobreliquidación de una
  corrección. Las dos negativas (líneas 549 y 576) llegan después. Sustituir
  sólo esas negativas por una conversión escribiría el reparto de 100,00 USD
  como si fueran JPY, y nada lo detendría: la FK compuesta valida la moneda, no
  la magnitud. Lo que exigen los ADR aceptados:
  - **Convertir una vez y repartir después**, en la moneda base del Grupo
    (F02/ADR-001 §5, `data-model.md` §10). El reparto que se escribe y la guarda
    de sobreliquidación operan sobre el total convertido; el escenario
    `gasto-de-grupo-con-tres-monedas` de `tests/vectors/scenarios.json` lo fija
    para `equal`.
  - **Cada conversión sale del importe original**, una por ámbito alcanzado
    (F03/ADR-010 §6, F11/ADR-001 §4): la caja del pagador en su Modo Personal
    es la conversión del original a esa base, no la del total ya convertido al
    Grupo.
  - **Todas las conversiones de la operación se resuelven juntas, antes de
    escribir nada**, respetando el orden de F11/ADR-001 §6 **para la operación
    entera**: el paso 3 (clase) y el 5 (cobertura de la definición) para todas
    las conversiones, y el paso 4 (conflicto de base) sólo para el ámbito de
    captura, el Grupo, porque los ámbitos derivados no tienen base esperada
    (F11/ADR-001 §10); todo ello antes de los pasos 6–8. Un
    gasto cuyo pagador tiene base ARS se rechaza con
    `FX_CURRENCY_NOT_COVERED · 422` aunque el tipo del día aún no esté fijado;
    resolver cada guarda por separado podría responder antes `503` y, al
    reintentar, `422`.
  - **Lo que no cambia de F9:** el replay antes de autorizar (F03/ADR-008 §13),
    el cerrojo de identidad antes de leer membresía o vínculo, la elegibilidad
    por fecha y el orden de locks. La resolución necesita el Modo Personal del
    pagador, que se deriva bajo el cerrojo de identidad (línea 574), así que va
    detrás de él y delante de la guarda de sobreliquidación y de toda
    escritura.
  - **Sin decidir:** cómo se trasladan a la base del Grupo los importes
    declarados de un reparto `exact_amounts` en moneda extranjera. Ver
    [Decisiones abiertas](#decisiones-abiertas).
- **La base asumida en el gasto de grupo.** F11/ADR-001 §11 ya exige que
  `record_group_expense` la transporte. Añadirla a su lista de campos y a su
  intención canónica es una migración **posterior a la última vigente**, partiendo
  del cuerpo vigente de la función (hoy el de
  `20260912170000_group_payments_and_departed.sql`) para no revertir ninguna de
  las reglas de F9.

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
  rama de F11, y ninguna pieza de F11 lo provoca.
- **F11 sí amplía a quién afecta.** Hoy quien tiene un Modo Personal en otra
  base no puede pagar un gasto del grupo. Con F11 podrá (F11/ADR-001 §11) y
  quedar como **acreedora**, y sus deudores tampoco podrán declararle un pago
  ni salir con saldo. Validarlo con producto forma parte de F11.D; no cambia lo
  decidido.
- **Queda fuera del alcance de F11** por la decisión de producto 2 de
  [F11/ADR-001](../adr/F11/ADR-001-fx-rate-resolution.md): las liquidaciones y
  los pagos entre monedas o bases distintas no se convierten en F11.
- **F11.B no debe implementarlo**, ni las conversiones que sólo harían falta
  para esos flujos.
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
- **Dónde se resuelve: F11.D.** F11.C (`20261001120000`) corrigió el desglose
  de las operaciones personales en moneda extranjera y, por decisión explícita,
  dejó esta cuota exactamente como estaba. Excluir, convertir o mostrar aparte
  esas cuotas es de F11.D, junto al gasto de grupo en moneda extranjera.

## Decisiones abiertas

Casos que F11/ADR-001 no resuelve y que ninguna decisión de producto cubre.
**No están decididos**: se registran para que nadie los fije por omisión.

> **Condición de seguridad de implementación, no decisión de comportamiento.**
> **F11.B no habilita moneda extranjera en `record_group_expense`.** Ese flujo
> es de F11.D (roadmap, Fase 11) y se habilita sólo después de que F11.D decida
> los dos casos de esta sección. La condición no dice si la caja del fantasma
> se convierte o se rechaza, ni cómo se reparte un `exact_amounts`: sólo impide
> habilitar un flujo que hoy escribiría importes erróneos sin error. F11.B sí
> implementa el resolver y la conversión de `personal_expense` y
> `personal_income`.
>
> **Cómo se lee con F11/ADR-001 §12, sin modificarlo.** §12 asigna a F11.B la
> retirada de `sec.assert_no_conversion` para las clases de §4 y a F11.D la
> integración del gasto de grupo con F9, y §4 admite el gasto de grupo «al
> integrarse Grupos (F9)». Esta condición sólo precisa el orden de ejecución
> dentro de la fase: para `group_expense`, esa retirada se hace dentro de la
> integración de F11.D. El ADR aceptado no cambia: ni su texto, ni las clases
> que admiten moneda extranjera, ni los resultados ni el orden de su §6.

### Caja incorporada al asociar un fantasma que pagó un gasto de grupo (F11.D)

- **Qué hace la función.** Al asociar un fantasma a una cuenta (F09/ADR-009),
  `sec.incorporate_participant_cash`
  (`20260914130000_associate_participant.sql`) escribe en el Personal de esa
  cuenta la caja que el fantasma pagó, en la versión vigente de cada gasto. Su
  guarda compara la **base del grupo con la base del Personal**, no la moneda
  de la operación (líneas 680–684), y escribe `original_amount` **en la moneda
  del Personal** (líneas 696, 717 y 723).
- **Caso 1: bases distintas.** Grupo con base JPY, Personal en EUR. La
  asociación se rechaza **entera** con `CURRENCY_CONVERSION_UNSUPPORTED · 422`,
  tenga o no caja que incorporar. Es lo que pasa hoy.
- **Caso 2, el peligroso: bases iguales y moneda de la operación distinta.**
  Grupo con base EUR, un gasto de grupo de 100,00 USD pagado por un fantasma,
  y una cuenta con Personal en EUR que lo asocia. La guarda pasa (EUR = EUR) y
  se escribe una caja de **−10000 EUR**, es decir −100,00 €, en lugar de la
  conversión. La FK compuesta sólo valida la moneda, así que no hay error. Hoy
  no puede ocurrir, porque ningún gasto de grupo admite otra moneda; ocurriría
  en cuanto se habilitara.
- **Por qué requiere decisión.** Con F11, el mismo gasto pagado directamente por
  esa cuenta **se convierte** a su Personal (F11/ADR-001 §4 y §11). Pagado por
  un fantasma que la cuenta asocia después, no hay regla: F11/ADR-001 no trata
  la asociación, F09/ADR-009 no habla de moneda y la negativa sólo existe en el
  SQL. Mantenerla deja dos resultados distintos para el mismo gasto; convertir
  exige fijar, entre otras cosas, con qué tipo y qué pasa si no está cubierto
  o todavía no está disponible.
- **Qué no está en cuestión.** La parte de la caja que procede de pagos
  declarados (`group_payment`) es una liquidación y queda fuera de F11 por la
  decisión 2.
- **Dónde se decide: F11.D**, antes de habilitar moneda extranjera en
  `record_group_expense` (condición de arriba). Si se convierte o se rechaza,
  y con qué tipo, sigue abierto.

### Reparto por importes exactos en moneda extranjera (F11.D)

- **El escenario.** Un gasto de grupo de 100,00 USD en un grupo con base EUR,
  repartido con `exact_amounts` de 70,00 y 30,00 USD.
- **Por qué requiere decisión.** Los importes declarados están en la moneda de
  la operación, y el reparto debe calcularse en la base del Grupo después de
  convertir (F02/ADR-001 §5). Convertir cada importe por separado es justo lo
  que ese § prohíbe, porque las partes convertidas dejan de sumar el total
  convertido. `equal` y `shares` no declaran importes, así que se aplican al
  total convertido sin nada que trasladar. Para `exact_amounts`, ningún ADR fija
  cómo se trasladan los importes declarados a la base del Grupo, ni con qué
  reparto y redondeo: no se prejuzga aquí.
- **Dónde se decide: F11.D**, antes de habilitar moneda extranjera en
  `record_group_expense` (condición de arriba).

## La interfaz multimoneda (dentro de F11.D, 2026-09-23)

> **No normativo.** Aquí no se decide nada: se deja escrito **cómo** se
> implementó lo que F11/ADR-001, F11/ADR-002 y F11/ADR-003 ya decidieron, y
> qué se dejó deliberadamente fuera. Ninguna regla nueva.

### Lo que hace

- **El selector es de `CurrencyDefinition`, no de país.** Sale de
  `api.currency_definition` **entero**: ARS, COP y CLP siguen en la lista
  aunque hoy no tengan cobertura del BCE, porque qué pares se pueden convertir
  un día dado lo decide la frontera (`FX_CURRENCY_NOT_COVERED`) y cambia cada
  día hábil. Filtrarlo en el cliente habría sido fabricar esa regla dos veces.
- **Una lista, en `ui/`.** `CurrencyList` la comparten el campo de la divisa
  base de un grupo —que ya existía— y el control de moneda de `AmountSheet`.
  El catálogo bajó a `lib/currency` por la misma razón que `lib/categories`:
  lo necesitan dos features y una no puede leer de la otra.
- **La moneda elegida es la de la OPERACIÓN.** La base del ámbito no se toca
  desde ninguna pantalla: `api.set_personal_base_currency` sigue sin llamador
  en el cliente y la divisa de un grupo creado se sigue viendo bloqueada.
- **El cliente no convierte.** Transporta la moneda declarada, el importe
  original y la base asumida; el tipo lo resuelve y lo congela el servidor
  (F11/ADR-001 §7, §12). El coeficiente cruza como texto y sólo se formatea.

### Tres consecuencias que conviene tener presentes

- **Cambiar la moneda al corregir obliga a resolver un tipo nuevo, y eso ya lo
  hacía el servidor**: `sec.fx_personal_rate` sólo hereda con la misma fecha
  efectiva **y** la misma moneda original. La interfaz no añade ninguna regla;
  lo que hacía falta era poder mandar otra moneda. Medido de extremo a extremo
  en `supabase/checks/fx-group-conversion-read.sql` F.
- **La moneda entra en la huella de idempotencia de una corrección personal.**
  Corregir 20 EUR a 20 USD es otro comando aunque la cifra no se mueva: sin
  ella, un primer intento que llegara a escribirse y cuya respuesta se perdiera
  habría hecho que el segundo volviera con `IDEMPOTENCY_KEY_REUSED · 409`.
- **Una entrada encolada en otra moneda se pinta y no suma.** Es la regla que
  ya existía (`aggregatable = false`), y ahora la fila lo **dice**:
  «Conversión pendiente», sin ninguna cifra convertida, porque no la hay. Eso
  distingue dos casos que se veían iguales: la conversión que el servidor va a
  hacer, y el conflicto de F07/ADR-001 §14 —la base se movió bajo una entrada
  ya capturada— que la frontera va a rechazar. Se distinguen por la base
  asumida que la entrada congeló en su payload.

### Lo que NO entra, y por qué

- **Cambiar la moneda base**, de un Personal o de un Grupo, con historia
  detrás. Sigue sin ADR que lo cubra: ver «Discrepancias documentales» más
  abajo.
- **Conversión en ninguna otra clase.** Transferencias, ajustes, liquidaciones
  y pagos declarados conservan `sec.assert_no_conversion`.
- **El detalle de conversión de un gasto de grupo en el Modo Personal.** La
  cuota propia ya viaja en la base del Personal (`personal_amount`, F11.D); el
  tipo con el que se convirtió esa cuota no se publica.
- **Una segunda excepción, pequeña y deliberada, a lo compartido del borrador
  (F12.C2):** ir a «Transferencia» con otra moneda elegida vuelve a la base y
  **vacía** el importe. Una propuesta va siempre en la base del Personal
  (F12/ADR-002 §20), y llevarse la cifra tal cual la habría reinterpretado en
  otra moneda sin que nadie convirtiera nada.

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
