# F10/ADR-004 — Cierre de alcance de la identidad contextual: sin cesiones, sin fusiones nuevas y sin `identity_handover`

- **Estado:** Aceptado (2026-09-16)
- **Fecha:** 2026-09-16
- **Alcance:** qué queda del bloque F10.B0 tal como lo anunciaron el roadmap,
  [`phase-10-opening.md`](../../architecture/phase-10-opening.md) §6 y los
  tres ADR anteriores de la fase, **medido contra el modelo que dejó F10.A3**.
  Decide que **no se implementa ninguna cesión ni fusión adicional**: ni la
  cesión consentida de una identidad entre dos cuentas (`identity_handover`),
  ni la fusión de dos participantes con cuenta, ni la fusión de dos
  participantes sin cuenta; que las cadenas de fusión quedan **prohibidas**
  como invariante; y que, por tanto, **F10.B1 y F10.B2 no existen**. Es un ADR
  de cierre de alcance: no describe ningún mecanismo nuevo.
- **No cubre:** la economía de F9 (salir, saldar, retirar, pagos, novación),
  que no se reabre; el modo Invitado y la conversión Invitado → cuenta
  ([F05/ADR-003](../F05/ADR-003-guest-session.md), cerrados en A3); la
  revocación del vínculo ajeno, la expulsión, los roles, la identidad anónima
  autenticada y la recuperación global de cuenta (fuera de F10 desde A0); el
  cierre de la fase (F10.C0).
- **Supera** las referencias hacia delante que los ADR de esta fase hacían a
  «F10.B0»: de [F10/ADR-001](ADR-001-link-instance-lifecycle.md) la exclusión
  «cesión consentida y fusión fantasma ↔ fantasma» de su **No cubre**; de
  [F10/ADR-002](ADR-002-permanent-identity.md) la consecuencia «la cesión
  consentida A → B (F10.B0) es ahora la única vía prevista» para que una
  identidad cambie de cuenta — **no hay ninguna vía**; de
  [F10/ADR-003](ADR-003-active-and-historical-link.md) la consecuencia «la
  cesión consentida (F10.B0) decide sobre vínculos activos». De
  `phase-10-opening.md` §6 (insumos de la cesión y las fusiones) y del roadmap
  los criterios de cierre 6 y 7 en su forma condicional («si entra…»), que
  este ADR resuelve en su rama negativa.
- **Conserva** íntegros [F10/ADR-002](ADR-002-permanent-identity.md) (la
  identidad activa es fija mientras la cuenta participa),
  [F10/ADR-003](ADR-003-active-and-historical-link.md) (activo/histórico;
  salir termina, volver reactiva o elige un sin cuenta; nunca «nuevo»),
  [F09/ADR-004](../F09/ADR-004-group-invitations.md) (reclamar con invitación)
  y [F09/ADR-009](../F09/ADR-009-associate-ghost-to-own-account.md) (asociar
  un sin cuenta a la propia identidad, con su regla «un destino nunca es
  origen»), que son exactamente los mecanismos con los que la identidad
  contextual queda resuelta.
- **Se apoya en** [F03/ADR-009](../F03/ADR-009-participant-identity.md) (el
  participante es contextual; los efectos nombran participantes, nunca
  cuentas), [F03/ADR-013](../F03/ADR-013-economic-attribution.md) (la
  atribución sigue al vínculo del participante canónico) y
  [F03/ADR-010](../F03/ADR-010-persisted-vs-derived.md) §9 (`core.current_effect`
  es la única proyección que resuelve fusiones).

## Contexto

### Lo que B0 iba a decidir

Cuando la fase se abrió (F10.A0, 2026-09-14), B0 era el bloque de decisión de
dos cosas que F9 había dejado sin cerrar: (a) la **cesión consentida** de una
identidad entre dos cuentas del mismo grupo —como primitiva atómica
`identity_handover` con prueba de un solo uso, o su aplazamiento explícito— y
(b) la **fusión de dos participantes sin cuenta** («Ana» y «Ana López», ambas
sin cuenta y con historia, resultan ser la misma persona), decidida sobre la
matriz económica que A0 midió (`phase-10-opening.md` §3.3). B1 y B2 serían el
backend y el cliente «de lo que B0 aprobase».

Aquel diseño de la cesión estaba escrito sobre una pieza que ya no existe: se
describía como «`unlink(A)` + `link(B)`» o «`unlink(A)` +
`participant_merge(P_A → P_B)`», y F10.A3 retiró `unlink` y `unclaim` al hacer
la identidad permanente (F10/ADR-002) y terminar el vínculo sólo al salir
(F10/ADR-003). Antes de redactar nada, B0 midió qué problemas seguían
existiendo sobre el modelo actual.

### Lo que se midió (2026-09-16, `main` en `c93d3e4`, 50 migraciones)

Tres sondas SQL contra las funciones reales de la base local, con identidad
simulada y `ROLLBACK` (residuo verificado: cero); ninguna se versiona.

**Fantasma → cuenta está resuelto dos veces.** Reclamar con invitación
(F09/ADR-004, sin tocar ningún hecho contable) y asociar a la propia identidad
(F09/ADR-009, incorporando la caja histórica al Personal del actor). No hay
trabajo nuevo.

**Fantasma ↔ fantasma: el modelo lo sostiene; la puerta no existe.** Con una
fila `core.participant_merge (Ana López → Ana)` escrita a mano:

| Pieza                                                              | Comportamiento medido                                                                                                                                                                                          |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.participant_merge`                                           | Acepta la fila: sólo exige mismo ámbito y origen ≠ destino; PK = origen.                                                                                                                                       |
| `core.current_effect` · `sec.canonical_participant`                | Resuelven las tres dimensiones al destino: Ana −750 y Ana López −1250 pasan a Ana −2000; el par Ana López > Ana **se extingue sin dinero**; la suma cero se conserva.                                          |
| `api.group_balance` · `group_profile.participant_count` · foto CAS | El origen desaparece del presente.                                                                                                                                                                             |
| `api.group_participant`                                            | El origen sigue `is_active`, con `has_history = false` y `merged_into_participant_id` = destino; el cliente ya lo oculta y traduce su nombre al del destino.                                                   |
| `sec.participant_available(origen)`                                | `false`: no reclamable (`PARTICIPANT_ALREADY_CLAIMED`).                                                                                                                                                        |
| Gasto nuevo que nombre al origen                                   | `PARTICIPANT_MERGED · 422`.                                                                                                                                                                                    |
| Corregir un gasto antiguo que ya lo nombraba                       | Permitido manteniéndolo (sigue resolviendo al destino) y permitido quitándolo (semántica normal de corrección).                                                                                                |
| Reclamar después al **destino** con invitación                     | Permitido; la cuenta recibe en `api.claimed_dimension()` la historia de **ambas** identidades.                                                                                                                 |
| Asociar después al **destino** a la propia cuenta                  | `PARTICIPANT_MERGED · 409`: un destino nunca es origen.                                                                                                                                                        |
| Retirar al **destino**                                             | Correcto: liquida los pares absorbidos.                                                                                                                                                                        |
| Retirar al **origen** ya fusionado                                 | **Se acepta** (`api.retire_participant` no consulta `participant_merge`): crea `participant_retirement` sin operación y avisa a los miembros. Sin efecto económico; estado «fusionado y retirado» no previsto. |
| Borrar la fila                                                     | Devuelve exactamente los netos anteriores: reversible por lectura, porque entre fantasmas no hay caja.                                                                                                         |

Es decir: el hecho, la resolución, la lectura y las guardas de escritura,
reclamación y asociación ya aceptarían un destino sin cuenta. Lo que falta es
el **comando** con su autorización y su aviso, la guarda en retirar y la UX.

**Cuenta → cuenta y cuenta ↔ cuenta: no hay mecanismo, y el modelo lo
rehúsa.** `api.associate_participant` rehúsa un origen vinculado
(`PARTICIPANT_LINKED`). Forzado a mano (Carlos, vinculado y activo, como origen
de una fusión hacia Bea): Carlos desaparece de Saldos, no puede registrar
gastos como pagador (`PARTICIPANT_MERGED`) y, sin embargo, **puede salir del
grupo**. El modelo no tiene la noción «cuenta cuya identidad es de otra
cuenta». Su caja ya está en su Personal (`incorporate_participant_cash` sólo
escribe en el Personal del **actor**) y ninguna vía la traslada; su atribución
(`claimed_dimension`) pasaría entera a la otra cuenta mientras la caja se
queda. Sería una fusión de **cuentas** —dos Personales, dos cajas, dos
`user_id`—, no de participantes.

**Cadenas: un solo salto, y la API no deja crearlas.** `sec.canonical_participant`
y `core.current_effect` resuelven **un** salto. `associate_participant` rehúsa
como origen a quien es origen **o destino** de otra fusión. Forzada a mano una
cadena A → B → C, los efectos de A se quedan en B, que está oculto por ser
origen: Saldos muestra Bea +2000 y Carlos −750 y **la suma cero se rompe en
silencio**. Datos reales locales: 1 fusión, 0 cadenas, 0 orígenes vinculados
o retirados.

## Decisión

### §1 · Cesión cuenta → cuenta: fuera de F10

No habrá `identity_handover`, ni token de cesión, ni transferencia de un
participante entre cuentas, ni composición mediante desvinculación (que ya no
existe). **La identidad activa de una cuenta en un grupo es fija mientras la
cuenta participa** (F10/ADR-002 §1) y sólo termina al salir (F10/ADR-003).
Quien se vinculó a la identidad equivocada tiene la salida que A3 dejó: salir
del grupo con la economía de F9 y, con invitación, entrar como quien
corresponda.

Este ADR toma la rama «aplazamiento explícito» del criterio 6 del roadmap,
con el límite escrito aquí: no es un aplazamiento hacia B1, es la declaración
de que **no hay ninguna vía** por la que una identidad contextual cambie de
cuenta. Si un día se quisiera una, exigiría un ADR nuevo que supere F10/ADR-002
§1, con su prueba de un solo uso y su carrera medida; ninguna composición de
comandos existentes se acepta como sustituto.

### §2 · Fusión de dos participantes con cuenta: fuera

No se fusionan dos cuentas, ni dos Personales, ni dos cajas, ni las historias
económicas de dos `user_id`. Es la misma frontera que F05/ADR-003 §4 fija para
el invitado («no existe fusión de una sesión invitada con una cuenta
existente»), a otra escala. `associate_participant` sigue rehusando cualquier
origen vinculado (`PARTICIPANT_LINKED`), activo o histórico.

### §3 · Fantasma → cuenta: ya resuelto

Reclamar con invitación (F09/ADR-004) y asociar a la propia identidad
(F09/ADR-009) se mantienen exactamente como están. No hay trabajo nuevo.

### §4 · Fantasma ↔ fantasma: fuera

Aunque el modelo sostenga estructuralmente un destino sin cuenta (medido
arriba), **no se añade** comando, UX, confirmación, alias, reversión ni fusión
manual entre participantes sin cuenta. No hay necesidad de producto suficiente
ahora mismo: un duplicado sin cuenta se resuelve con lo que existe —retirar al
sobrante (F09/ADR-005) o, si la persona entra, reclamar uno y que un miembro
retire el otro— y `core.participant_merge` sigue teniendo **un único
escritor**, `api.associate_participant`, cuyo destino es siempre la identidad
activa del actor.

### §5 · Cadenas de fusión: prohibidas, como invariante

Se declara invariante lo que hoy impone la única función escritora:

- un origen de fusión no puede ser destino de otra;
- un destino de fusión no puede ser origen de otra;
- la resolución (`core.current_effect`, `sec.canonical_participant`) es de
  **un único salto** y así debe seguir.

La medición de la cadena forzada (suma cero rota) es la razón. La guarda vive
hoy **sólo** en `api.associate_participant` (`PARTICIPANT_MERGED` en los dos
sentidos): ninguna API existente puede crear una cadena, pero el modelo no la
impide por sí mismo. **F10.C0 debe verificar que el invariante de un solo
salto queda protegido en el modelo o en el catálogo, y no por casualidad en
el writer actual**; si para que A → B → C no pueda existir hace falta una
guarda pequeña —una restricción o un check de catálogo que rehúse un origen
que es destino y un destino que es origen—, C0 la implementa como **cierre de
invariante**, no como feature nueva. Cualquier escritor futuro de
`participant_merge` hereda la regla.

### §6 · B1 y B2 no existen

No hay backend ni cliente derivados de este ADR. Los bloques F10.B1 y F10.B2
del roadmap se eliminan; el siguiente bloque de la fase es **F10.C0** (cierre:
regresión, criterios, documentación, `PROJECT_STATE` y handoff). La fase sigue
abierta hasta C0.

### §7 · Lo que queda resuelto, y por qué basta

Las necesidades reales de identidad contextual quedaron cubiertas por **F9 +
F10.A1/A2/A3**: figurar sin cuenta y participar en gastos (F3, F9); reclamar
con prueba y sin perder historia (F09/ADR-004); asociar un sin cuenta a la
propia identidad (F09/ADR-009); retirar a un sin cuenta (F09/ADR-005); salir y
volver con la identidad de entonces o como otro sin cuenta (F09/ADR-003,
F09/ADR-010, F10/ADR-003); identidad permanente mientras se participa
(F10/ADR-002); identidad y procedencia de cada instancia de vínculo con su
línea base (F10/ADR-001 §0, §1, §3); ninguna cuenta adjudica la identidad de
otra (principio de A0, guardado en catálogo desde A2). Lo que B0 anunciaba y
no entra no deja ningún caso de producto sin salida.

## Alternativas consideradas

- **Implementar la fusión fantasma ↔ fantasma** (una función `api` sobre la
  misma tabla y el mismo cerrojo, una guarda en retirar, un aviso, la UI en el
  menú del participante). Coste bajo, medido; **rechazada** por producto: no
  hay necesidad que lo justifique ahora, y abrir un segundo escritor de
  `participant_merge` es abrir la superficie que §5 acota.
- **`identity_handover` atómica** (§6.1 de la apertura). **Rechazada**:
  contradice F10/ADR-002 §1, exige una transición de vínculo distinta de
  «histórico» y deja la caja del cedente en un Personal cuya identidad ya no es
  suya.
- **Composición «salir → reclamar»** como cesión. **Rechazada** ya en A0
  (ventana de apropiación); además, tras F10/ADR-003 el vínculo histórico no
  es reclamable.
- **Aplazar a B1/B2 «por si acaso»**. **Rechazada**: un bloque sin decisión
  detrás es deuda documental, no un plan.

## Consecuencias

- **Roadmap:** B0 cerrado como bloque documental; B1 y B2 eliminados; C0 es
  el siguiente; los criterios 6 y 7 se reescriben en su forma decidida; la
  puerta «`F10/ADR-004` aceptado antes de B1» queda sin objeto.
- **Documentación:** `identity_handover`, la cesión cuenta → cuenta, la fusión
  cuenta ↔ cuenta y la fusión fantasma ↔ fantasma dejan de figurar como
  trabajo pendiente en `PROJECT_STATE.md`, `AGENTS.md`, `model-coverage.md`,
  `data-model.md`, los índices de ADR y `phase-10-opening.md` (que recibe una
  nota con esta decisión; sus mediciones §3.3 y sus insumos §6 se conservan
  como historia).
- **Hallazgo de F10.A0 sobre `sec.payment_counterpart_name`** (publica el
  nombre crudo de un origen fusionado): queda **anotado, no corregido**. El
  cliente resuelve el nombre por `merged_into_participant_id` en toda
  superficie de grupo, y la única fusión posible sigue siendo hacia la
  identidad del actor.
- **Regresión existente, a cerrar en F10.C0 antes de cerrar la fase:**
  `api.retire_participant` acepta retirar a un origen ya fusionado (medido;
  reproducible con la única fusión que la API permite, la de un sin cuenta a
  la identidad del actor). No mueve dinero ni altera ningún saldo —los efectos
  del origen siguen resueltos al destino—, pero deja un participante
  «fusionado y retirado», un estado que ninguna guarda contempla, y emite un
  aviso sobre alguien que el grupo ya no ve. **C0 debe garantizar** que
  `retire_participant` rehúsa a un participante que ya es origen de
  `participant_merge`, con el error coherente con los writers:
  `PARTICIPANT_MERGED`; y revisar cualquier writer equivalente que pueda
  producir el mismo estado inválido (`settle_participant` comparte el núcleo
  `sec.retire_participant_core`). B0 no lo implementa: sigue siendo
  documental.
- **Invariante de un salto, a verificar en F10.C0** (§5): hoy lo impone
  `api.associate_participant`, único escritor de `participant_merge`. C0
  comprueba que el modelo o el catálogo lo protegen por sí mismos —un origen
  nunca es destino, un destino nunca es origen— y, si hace falta, añade la
  guarda pequeña que impida A → B → C, como cierre de invariante.
- **Nada cambia en SQL, cliente ni comportamiento.** Este ADR no viene
  acompañado de migración, función, test de comportamiento ni cambio de UI.

## Cómo se demuestra

Este ADR no trae implementación. Lo verificable lo cubre C0: (a) ninguna
función de `api` llamada `*handover*`, `*merge*` distinta de
`associate_participant`, ni `unlink`/`unclaim`; (b) un solo escritor de
`core.participant_merge`; (c) `retire_participant` (y cualquier writer
equivalente) rehúsa a un origen fusionado con `PARTICIPANT_MERGED`, medido en
un check; (d) el invariante de un solo salto protegido en el modelo o en el
catálogo, medido; (e) roadmap, `PROJECT_STATE.md`, `model-coverage.md`,
`AGENTS.md` y los índices de ADR sin ninguna mención a B1, B2,
`identity_handover` ni fusiones pendientes (criterio 12).
