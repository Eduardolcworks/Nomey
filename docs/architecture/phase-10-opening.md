# Fase 10 · Apertura (F10.A0)

> **Qué es esto.** El contrato de apertura de la Fase 10: qué parte del alcance
> original ya cerró F9, qué queda de verdad, bajo qué principio se decide, qué
> se midió antes de decidir nada, y qué insumos reciben los dos ADR de la fase.
> **No decide nada por sí mismo**: las decisiones van en `F10/ADR-001` y
> `F10/ADR-002`; los criterios de cierre mandan desde el
> [roadmap](../product/roadmap.md). Se sustituye por el handoff de la fase al
> cerrarla.
>
> Escrito el **2026-09-14**, sobre `main` en `e3af705` (F9 cerrada, 46
> migraciones). Todo lo marcado **medido** se ejecutó contra las funciones
> reales de la base local con identidad simulada y `ROLLBACK`, con una sonda
> desechable que **no se versiona**; los casos pasan a `supabase/checks/` en el
> bloque que implemente cada cosa.

---

## 1 · El principio de la fase

> **Ninguna cuenta adjudica unilateralmente la identidad de otra cuenta.** Una
> cuenta modifica su propia relación de identidad con un participante; no
> decide quién es otra persona.

Es una decisión de producto (2026-09-14) y se registrará en `F10/ADR-001`.
Nomey no dispone de una fuente autoritativa externa que permita decidir que una
cuenta tiene más derecho que otra sobre la identidad social de un participante,
y cualquier mecanismo de «revocar el vínculo de otro» —aunque se acote por
procedencia, caja, auditoría y avisos— crea una primitiva de secuestro:
revocar y reclamar. La RLS vigente **ya lo impone**: todas las políticas del
provisioner sobre `core.participant_user_link` y `core.membership` son
`user_id = sec.request_actor_id()` (medido en el catálogo). F10 no relaja esa
barrera; la declara invariante y la guarda.

**Quedan fuera de F10, explícitamente:** revocación unilateral del vínculo
ajeno · expulsión de otra cuenta · roles o moderadores · identidad anónima
autenticada · cambio o recuperación global de cuenta · soporte administrativo
de disputas · acceso residual general (F12).

---

## 2 · Reconciliación del alcance original con lo que F9 cerró

El texto original de F10 («invitación, prueba de autorización, reclamación
retroactiva sin pérdida de historial, y fusión de participantes duplicados») y
sus cuatro criterios de cierre estaban **cumplidos por F9 antes de abrir F10**.

| Alcance original (roadmap · F03/ADR-009 · AGENTS §5) | Resuelto por                                                                   | Estado                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| Participante sin cuenta figura en gastos             | F3 (esquema), F9 (`create_group`, `record_group_expense`)                      | cerrado                                        |
| Invitación por token, enlace y QR                    | [F09/ADR-004](../adr/F09/ADR-004-group-invitations.md), `20260911150000`       | cerrado                                        |
| Prueba de autorización para reclamar                 | F09/ADR-004 §1: la invitación válida                                           | cerrado                                        |
| Reclamación retroactiva sin pérdida                  | F09/ADR-004 §5; `group-invitations.sql` D1                                     | cerrado                                        |
| Test de reclamación no autorizada que falla          | `group-invitations.sql` C3, D4, D5, D7, E2                                     | cerrado                                        |
| Presencias con comandos de ciclo de vida             | `redeem` (new/rejoin) abre; `leave_group`, `retire_participant` cierran        | cerrado                                        |
| Procedencia del vínculo (F03/ADR-009 §10)            | `claim_command_id`, sólo para reclamaciones                                    | **parcial → F10.A1**                           |
| Rectificar la propia reclamación                     | [F09/ADR-006](../adr/F09/ADR-006-unclaim-participant.md)                       | cerrado; **se generaliza y precisa en F10.A1** |
| Retirar a un participante sin cuenta                 | [F09/ADR-005](../adr/F09/ADR-005-retire-unlinked-participant.md)               | cerrado                                        |
| Fusión de duplicados: fantasma → identidad propia    | [F09/ADR-009](../adr/F09/ADR-009-associate-ghost-to-own-account.md)            | cerrado                                        |
| Fusión de duplicados: fantasma ↔ fantasma            | —                                                                              | **F10.B0** (estudio, no aprobado)              |
| Reincorporación tras salir                           | [F09/ADR-010](../adr/F09/ADR-010-rejoin-after-departure.md)                    | cerrado                                        |
| Revocación del vínculo por otro                      | —                                                                              | **prohibida** (§1)                             |
| Fusión entre cuentas / reasignación                  | —                                                                              | **F10.B0** como cesión consentida atómica      |
| Historial del vínculo                                | `participant_unclaim` (bajas por reclamación) + `provisioning_command` (altas) | **parcial → F10.A1**                           |
| Cambio o recuperación de cuenta (F03/ADR-009 §11)    | —                                                                              | fuera (ciclo de vida de cuenta)                |
| Identidad anónima autenticada                        | `enable_anonymous_sign_ins = false`                                            | fuera                                          |

---

## 3 · Lo que se midió antes de decidir

### 3.1 «Genero obligación, dejo la identidad, vuelvo como nuevo»

Fixture: Edu crea el grupo; Ana entra como nueva; Bea **reclama** a Luis; Edu
paga 300 entre Edu, Ana y Luis (`Ana>Edu:100`, `Luis>Edu:100`).

| Origen del vínculo  | Qué se hizo                                             | Resultado medido                                                                                                                   |
| ------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `claim` (real)      | `unclaim` con deuda generada **después** de reclamar    | **Permitido** hoy (ADR-006 caso C). El grupo conserva `Luis>Edu:100`; el Personal de Bea queda a cero                              |
|                     | vuelve como nueva «Bea» y sale                          | Entra a cero y **sale sin bloqueo**                                                                                                |
| `new` (simulado)    | borrar vínculo y membresía de Ana                       | Grupo intacto; Personal de Ana a cero; vuelve como «Ana 2»; reclamar a «Ana» siendo miembro: `already_member`                      |
|                     | Edu retira al fantasma «Ana» (ADR-005)                  | Par cerrado **sin dinero**: el acreedor pasa de `+200` a `+100`                                                                    |
| `create` (simulado) | borrar vínculo y membresía de Edu (acreedor, caja −300) | Grupo intacto; Personal de Edu: `caja=−300`, **`cuotas=0`**, `deuda=0`: sin deuda propia, dejar el vínculo borra el consumo propio |

Conclusiones que fijan la regla de A1: el escape **ya existe hoy** para
`claim` con actividad posterior a la reclamación; distinguir por origen no lo
cierra; lo que lo cierra es una condición sobre la **actividad generada bajo la
instancia de vínculo**, que para `create` y `new` es toda la propia y para
`claim` excluye la historia anterior.

### 3.2 El último `membership` del grupo

Grupo con Edu como único miembro, dos fantasmas con un par entre ellos
(`Gus>Luis:50`), invitación de 30 días.

- Edu sale a neto cero: **permitido**. Membresías del grupo: **0**. El par entre
  fantasmas queda dentro.
- Revocar la invitación después: `NOT_AUTHORIZED` para Edu (ya no es miembro) y
  para cualquier ajeno. **Nadie puede revocarla.**
- Una cuenta ajena con el enlace previsualiza (`join`, sólo nombres) y **entra
  como nueva**: único miembro, ve el historial, los fantasmas y sus deudas, y
  puede revocar la invitación. Edu puede volver (`rejoin`) con una invitación
  que emita esa cuenta.

**Hecho heredado de F9, que F10 no cambia:** un grupo puede quedar con cero
cuentas miembro (F09/ADR-003 §9 lo define como estado derivado). Mientras viva
una invitación —multiuso, hasta 30 días— cualquiera que la tenga recupera el
acceso y nadie puede revocarla; sin invitación viva el grupo queda
**permanentemente inaccesible**, con sus fantasmas, pagos y pares dentro.

> **Consecuencia de producto y seguridad registrada, sin tratamiento en
> F10.A1–A3:** una invitación multiuso de hasta 30 días es, de facto, la **única
> llave de recuperación** de un grupo sin miembros. Merece decisión futura
> (p. ej. si la salida del último miembro debe revocar sus invitaciones, o si
> debe rehusarse con invitaciones vivas). No es de identidad y no se resuelve
> aquí.

### 3.3 Fantasma ↔ fantasma: matriz económica

Fusión simulada P1 → P2 (ambos sin cuenta) en grupos independientes.

| Caso                                          | Antes                               | Después                       | Efecto                                                                 |
| --------------------------------------------- | ----------------------------------- | ----------------------------- | ---------------------------------------------------------------------- |
| P1 debe a P2                                  | `P1>P2:50` · netos −50/+50          | sin pares · P2:0              | **La obligación entre ambos se extingue** sin dinero                   |
| Ambos deben a Ana y figuran en el mismo gasto | `P1>Ana:100 P2>Ana:100`             | `P2>Ana:200`                  | Se consolida; Ana intacta; la identidad fusionada tiene dos cuotas     |
| P1 pagó, P2 y Ana participaron                | `Ana>P1:30 P2>P1:30` · P1 +60       | `Ana>P2:30` · P2 +30          | El par P2>P1 se extingue; Ana intacta                                  |
| Borrar la fila de fusión                      | —                                   | vuelve exactamente al «antes» | **Reversible por lectura**: entre fantasmas no hay caja que incorporar |
| Pago entre dos fantasmas                      | —                                   | `NOT_AUTHORIZED`              | No existe (F09/ADR-007 C7)                                             |
| Ana paga 33 a P1, luego fusión P1 → P2        | `P2>P1:33`, Ana `caja=−33`          | sin pares                     | El pago sigue vigente; el par restante se extingue                     |
| Fusión inversa P2 → P1                        | —                                   | mismos netos                  | La dirección sólo cambia el nombre que sobrevive                       |
| P1 retirado                                   | `participant_available(P1) = false` | —                             | Una función real debe rehusar retirados                                |

Los terceros nunca cambian de neto. Es el nivel de decisión de **retirar**
(F09/ADR-005, que también extingue pares sin dinero y es terminal), con dos
diferencias: aquí es reversible por lectura mientras no exista caja, y
conserva la historia en vez de cerrarla. **No queda aprobado como feature**:
B0 decide sobre esta matriz.

### 3.4 Procedencia de los vínculos existentes

Base local: 14 vínculos; 1 con `claim_command_id`; de los 13 restantes, 8 con
exactamente un `group.create` y 5 con exactamente un `invitation.redeem(new)`
del mismo actor y ámbito; **0 ambiguos, 0 sin comando**. El relleno de
procedencia sería hoy inequívoco, pero es un hecho contingente: nunca se
inventa una procedencia para rellenar un `NOT NULL`.

### 3.5 Hallazgo: `sec.payment_counterpart_name`

Tras una fusión P1 → P2, el pago que Ana hizo a P1 sigue mostrando en su
Personal la contraparte «P1» (nombre crudo del origen) en vez del destino. La
función resuelve por canónico **mi** lado y devuelve el nombre crudo del otro
(cuerpo vivo del catálogo). F09/ADR-009 afirma que la contraparte «se publica
ya por canónico». Es presentación, no dinero. **Registrado como discrepancia**;
se decide después si contradice normativamente ADR-009 (corrección) o si el
ADR prometía más de lo que debía garantizar (anotación en índice o ADR
posterior). No se corrige en A0.

---

## 4 · Alcance nuevo, división y criterios

El alcance, los bloques `F10.A0 … F10.C0` y los criterios de cierre están en el
[roadmap](../product/roadmap.md), Fase 10, que es la fuente. Aquí, cómo se
demostrará cada criterio y qué bloque lo hace:

| Criterio (roadmap)                               | Cómo se demuestra                                                                                                                                       | Bloque |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1 · dejar una instancia propia de vínculo        | Check contra la función real para `create`, `new` y `claim`, con correcciones y anulaciones; el escape de §3.1 rehusado; el caso B de ADR-006 permitido | A2     |
| 2 · nadie toca el vínculo ni la membresía ajenos | Guarda de catálogo sobre policies y funciones de `api`/`sec`; intento por HTTP con JWT real rechazado                                                   | A2     |
| 3 · sin caja huérfana ni operaciones inanulables | Casos D/E/F de ADR-006 reproducidos contra la función nueva                                                                                             | A2     |
| 4 · dejar la identidad ≠ salir del grupo         | Dos comandos, efectos medidos (presencia, hecho, aviso, condición de deuda)                                                                             | A2/A3  |
| 5 · historial del vínculo                        | `link_id` y `origin_command_id` en el vínculo; toda baja referencia la instancia; reconstrucción medida                                                 | A2     |
| 6 · cesión A → B atómica, o aplazada             | `identity_handover` con carrera medida (dos sesiones), o límite declarado                                                                               | B0/B1  |
| 7 · fantasma ↔ fantasma decidido sobre la matriz | Matriz de §3.3 como check; confirmación con lo que se extingue; reversible o terminal                                                                   | B0/B1  |
| 8 · grupo sin miembros documentado y sin cambio  | Este documento y el roadmap; ningún cambio de semántica en F10                                                                                          | A0     |
| 9 · disputas sin consentimiento documentadas     | `F10/ADR-001`                                                                                                                                           | A1     |
| 10 · guarda completa y carreras en CI            | `group-identity-lock.sql` enumera todas las funciones con el cerrojo y falla al quitar una; las dos carreras huérfanas en el workflow                   | A2     |
| 11 · validado en dispositivo                     | Android; iOS si hay aparato                                                                                                                             | C0     |
| 12 · documentación sin contradicciones           | Este bloque y el cierre                                                                                                                                 | A0/C0  |

---

## 5 · Insumos para `F10/ADR-001` (ciclo de vida del vínculo propio)

Decisiones de producto ya tomadas (2026-09-14), que el ADR registra y
justifica; y análisis que el ADR debe cerrar antes de A2.

### 5.1 Regla aprobada

> Una cuenta puede dejar una instancia propia de vínculo **únicamente si
> hacerlo no le permite desprenderse de actividad económica generada mientras
> esa instancia estuvo vigente**. La historia anterior a la instancia no
> bloquea. La caja vigente en su Personal por operaciones del grupo bloquea
> siempre. No se toca historia anterior ni se reinterpretan operaciones.

Consecuencias esperadas: `create` y `new` → toda obligación propia vigente nació
bajo la instancia → bloquea; `claim` → lo anterior al vínculo no bloquea, lo
nacido durante sí. **Supera** F09/ADR-006 §2 en un punto: hoy se permite
desprenderse también de deuda nacida después de reclamar (caso C).

### 5.2 Identidad de la instancia y procedencia (aprobado conceptualmente)

- `link_id`: identidad estable e inmutable de cada alta `participant ↔ user`.
  Ancla del CAS y del replay; una baja referencia exactamente el `link_id`
  observado; `LINK_SUPERSEDED` si ya no es el vigente.
- `origin_command_id`: procedencia, separada del identificador; FK compuesta
  `(user_id, origin_command_id) → provisioning_command`. **Puede ser nulo** si
  la procedencia no es demostrable; nunca se inventa.
- `claim_command_id` puede desaparecer si el ADR demuestra el reemplazo
  completo (un origen `invitation.redeem` con `choice = 'claim'` es una
  reclamación).
- `api.group_participant` publica `link_id` sólo sobre la fila propia.
- Las columnas **no se implementan** hasta que el ADR las describa.

### 5.3 Qué significa «nació bajo esa instancia» — el ADR debe demostrarlo

`version.created_at between linked_at and unlinked_at` **no es una definición
válida**, por dos motivos medidos:

1. **Los timestamps no atestiguan la serialización.** `now()` es el instante de
   inicio de la transacción, y el protocolo de identidad serializa por el
   cerrojo de rango 1, no por el reloj: un gasto cuya transacción empezó antes
   que la reclamación pero entró al cerrojo después lleva `created_at` anterior
   a `linked_at` aunque se escribió, a todos los efectos, **bajo el vínculo**.
   Es exactamente la carrera 1b/2a de F09/ADR-006.
2. **Una versión nueva no equivale a atribución nueva.** Corregir sólo el
   concepto de un gasto anterior al vínculo crea una versión durante la
   instancia sin generar ninguna atribución que pertenezca a esa etapa.

**Candidato a evaluar en el ADR, no arquitectura decidida** — línea base por
instancia, tomada bajo el cerrojo:

- Al crear el vínculo (ya bajo rango 1), se persiste para esa instancia la
  versión vigente de cada operación cuya versión vigente atribuye algo al
  participante (`link_baseline(link_id, operation_id, version_id)`). Para
  `create` y `new` la línea base es vacía por construcción: el participante
  nace con el vínculo.
- Al dejar la instancia, bajo el cerrojo, para cada operación cuya versión
  vigente atribuye algo al participante se compara el **multiconjunto de
  atribución** (cuota económica; deuda por par y dirección con importe; el
  patrón de `sec.departed_effects_of_version`, F09/ADR-008) entre la versión
  vigente y la versión de la línea base (vacía si la operación no está en
  ella). **Bloquea si la versión vigente contiene algún elemento que no está en
  la línea base.**

Cómo responde a cada caso pedido:

| Caso                                                                     | Resultado con la línea base                                          |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Operación creada durante la instancia                                    | No está en la línea base → cualquier atribución bloquea              |
| Operación anterior corregida durante la instancia sólo en concepto/fecha | Multiconjunto idéntico → no bloquea                                  |
| Operación creada durante la instancia y corregida después                | Sigue fuera de la línea base → bloquea mientras atribuya algo        |
| Deuda preexistente que **sube** durante la instancia                     | Elemento nuevo (importe distinto) → bloquea                          |
| Deuda preexistente que **baja** durante la instancia                     | Subconjunto → no bloquea (no hay nada de lo que desprenderse)        |
| Cuota nueva añadida durante la instancia a un gasto histórico            | Elemento nuevo → bloquea                                             |
| Anulación o corrección que elimina lo nacido durante la instancia        | La versión vigente ya no atribuye nada → no bloquea                  |
| Liquidación, pago o novación que me nombra durante la instancia          | Elemento nuevo → bloquea (actividad de la etapa; el ADR lo confirma) |

Alternativas que el ADR debe comparar: (b) registrar en cada versión la
instancia de vínculo de cada participante nombrado al escribirla —toca los
nueve writers y sigue necesitando la comparación—; (c) un contador de época
por ámbito incrementado bajo el cerrojo —más maquinaria para la misma
pregunta—. La línea base persiste **más procedencia en vez de inferirla**,
que es lo pedido.

**Vínculos existentes al introducir el modelo.** Una línea base vacía **no es
semánticamente neutra**: si P debía 100 antes de que A lo reclamase, A no
genera nada nuevo y después rectifica, una base vacía presenta esos 100 como
atribución «no presente en la base» y bloquea exactamente el caso legítimo que
se conserva (la historia anterior al vínculo no bloquea). Por tanto, **el ADR
debe definir una estrategia que preserve la semántica para los vínculos ya
existentes; no puede sustituir una procedencia o línea base desconocida por
una vacía si eso altera qué obligaciones se consideran anteriores al
vínculo.** Alternativas que el ADR evalúa, sin decidir aquí: (1) reconstrucción
exacta cuando los hechos persistidos —versiones, `linked_at`,
`provisioning_command`— permitan demostrarla; (2) relleno sólo donde la línea
base se derive sin ambigüedad, y nunca inventada; (3) tratamiento explícito de
los vínculos legacy cuya línea base no pueda demostrarse (p. ej. fuera de la
vía de desvinculación, como hizo ADR-006 con la procedencia ausente);
(4) dado que no hay producción, reinicio o recreación de los datos de
desarrollo si es la opción más correcta frente a una compatibilidad histórica
artificial.

**Comparación por atribución con procedencia, nunca por neto.** El ADR debe
demostrar que la comparación distingue historias distintas aunque el saldo
final coincida: una obligación histórica desaparece y nace otra del mismo
importe; cambia el acreedor o el deudor conservando el neto; dos cuotas se
consolidan en una; una obligación creada durante la instancia se corrige
varias veces; una operación histórica recibe una cuota nueva durante la
instancia y después vuelve exactamente a su estado inicial. Para ello el
elemento comparado lleva `operation_id`, dimensión, participantes y sentido e
importe —y la versión o la procedencia si hacen falta para distinguir— y la
comparación es por operación, no sobre un agregado del participante. Dos
historias distintas con el mismo neto no son equivalentes.

### 5.4 Resto de decisiones que el ADR fija

- **Forma:** dejar la identidad borra vínculo **y** membresía, como ADR-006,
  con nombre propio y distinto de «salir» (que conserva el vínculo, cierra la
  presencia, exige neto cero y nova). El estado «miembro sin identidad» no se
  hace alcanzable; queda registrado como extensión posible.
- **Presencia** intacta; **efectos, versiones y autoría** intactos; el
  participante vuelve a estar disponible (reclamable con invitación válida,
  retirable por los miembros).
- **Salido con vínculo:** no puede dejar la instancia (bloqueado): el vínculo
  sostiene su Personal (F09/ADR-003 §8) y su reincorporación (F09/ADR-010), y el
  participante inactivo no es reclamable por nadie.
- **Destino de fusión:** el ADR decide si `UNCLAIM_BLOCKED_MERGE` (F09/ADR-009)
  se conserva o si la regla de caja y la línea base bastan (la fusión es un
  hecho entre participantes; `merged_by` es autoría).
- **Hecho de baja** insert-only con `link_id`, `origin_command_id`, `user_id`,
  `unlinked_by` (siempre el titular en F10; la columna hace comprobable como
  dato el principio de §1) y `client_command_id`; generaliza
  `participant_unclaim`.
- **Idempotencia y concurrencia:** clave `provisioning_command` → rango 1 →
  membresía, vínculo, línea base y caja bajo el cerrojo; replay devuelve el
  resultado original. Carreras a medir con dos sesiones: contra gasto con el
  actor como pagador o participante, pago con el actor como parte, `associate`
  sobre un fantasma mío, `leave`, `retire` de mi participante tras dejarlo, y
  reclamación ajena inmediata.
- **Disputas sin consentimiento** (cuenta perdida, inactiva, error no deshecho,
  negativa): declaradas **no resolubles** con el modelo de confianza actual.
  Alternativas y capacidades que exigirían, todas fuera de F10: propietario o
  moderador (rol, sucesión; supersede F09/ADR-001 §2) · quorum (decisiones
  pendientes, votos, caducidad; vencible con dos cuentas) · challenge (contacto
  verificado por participante: la correlación que F03/ADR-009 §1 evita) ·
  soporte administrativo (operador fuera de `api`, verificación humana;
  operación, no producto) · recuperación externa (ya existe para contraseña;
  no cubre la pérdida del correo).
- **Expulsión:** no existe; `unlink` y `membership removal` no se acoplan
  sobre terceros porque no hay ninguna función sobre terceros.

---

## 6 · Insumos para `F10/ADR-002` (cesión y fusiones)

### 6.1 Cesión A → B: composición abierta no es un diseño final

Componer «A deja la identidad → P_A libre → B reclama o asocia» reutiliza todo,
pero deja una **ventana en la que cualquier invitación válida reclama P_A**:
contradice el principio de §1. **No se acepta como producto.** Si la cesión
entra en F10, es una primitiva `identity_handover`:

- consentida por A (inicia sobre **su** `link_id`); aceptada por B;
- prueba específica: token opaco de un solo uso, con caducidad, sólo su hash
  (patrón de F09/ADR-004); A no necesita conocer el `user_id` global de B;
- sin ventana: el vínculo de A no se borra hasta que B presenta la prueba; A y
  B cambian en la misma transacción bajo el protocolo (clave → rango 1 →
  identidad);
- B sin identidad en el grupo → `unlink(A)` + `link(B)`; B con identidad →
  `unlink(A)` + `participant_merge(P_A → P_B)`;
- sin reescribir operaciones ni efectos; los hechos siguen nombrando P_A;
- **la caja vigente de A bloquea igual** (ningún diseño la mueve); las fusiones
  previas de A chocan con «un destino nunca es origen» (cadena o reapuntado);
  las deudas A ↔ B se extinguen si B ya tenía identidad — consecuencia que el
  ADR acepta o rehúsa explícitamente.

Si B0 demuestra que su coste excede F10, la cesión cuenta → cuenta **se aplaza
explícitamente** y el límite queda declarado. No se sustituye por composición
abierta.

### 6.2 Fantasma ↔ fantasma

Parte de la matriz de §3.3 y decide: autorización (¿mismo nivel que retirar?)
· confirmación que enseña qué pares se extinguen · reversible o terminal ·
interacción con retirados · cadenas de fusión · nombres y presentación
(incluido el hallazgo de §3.5). Sólo después se decide B1.

---

## 7 · Deuda técnica descubierta en A0

| Hallazgo                                                                                                                                                           | Dónde se salda             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `api.associate_participant` toma `sec.lock_participant_claims` y **no está** en la lista B de `supabase/checks/group-identity-lock.sql` (diez funciones; son once) | A2                         |
| `scripts/associate-race-evidence.sh` y `scripts/rejoin-race-evidence.sh` existen y **no corren en CI**                                                             | A2                         |
| `sec.payment_counterpart_name` publica el nombre crudo del origen fusionado (§3.5)                                                                                 | B0 decide                  |
| F09/ADR-009 «Consecuencias» cita una guarda de catálogo «ninguna agregación sin canónico» que **no existe** (la resolución vive en `core.current_effect`)          | anotado en `F09/README.md` |

---

## 8 · Confirmación de F09/ADR-004 §3

Valores reales, medidos en `20260911150000` y `group-invitations.sql` B2/B4:
cualquier miembro emite y revoca · multiuso hasta caducar o revocarse · 7 días
por defecto, 1–30 · el token se enseña una sola vez. **Confirmados por producto
el 2026-09-14 tal como están**, anotado en `docs/adr/F09/README.md`. Con ellos,
el único freno a una reclamación no deseada es revocar la invitación, y una
invitación viva es la única llave de un grupo sin miembros (§3.2).

---

## 9 · Correcciones documentales hechas en A0

Sin editar ningún ADR aceptado; lo superado se anota en índices o lo supersede
un ADR posterior.

- `docs/product/roadmap.md`: Fase 10 reescrita (objetivo, alcance, bloques,
  criterios, puertas); fila 10 de «Puertas de decisión».
- `docs/PROJECT_STATE.md`: F10 abierta; el vínculo y la reclamación ya no «de
  F10»; nueve funciones de clase; once funciones con el cerrojo; carreras en
  CI matizadas; `e11`–`e22`.
- `AGENTS.md`: «Current state» y §5 puestos al día (nueve writers, provisioning
  de Grupos, vínculo y periodos con ruta de escritura, F9 cerrada, F10 abierta).
- `docs/architecture/model-coverage.md` y `data-model.md`: el mecanismo de
  claim ya no está aplazado; queda el ciclo de vida.
- `docs/adr/README.md` y `docs/adr/F10/README.md`: tema y alcance de F10.
- `docs/adr/F09/README.md`: notas posteriores sobre ADR-004 (§3 confirmado; §5
  y consecuencias precisadas por ADR-010 y por el cierre de F9), ADR-006 (a
  superar en un punto por F10/ADR-001), ADR-009 (validado en iPhone; guarda
  inexistente; hallazgo de §3.5).
- `docs/architecture/phase-9-progress.md`: cabecera; se conserva como
  seguimiento citado por el roadmap.
