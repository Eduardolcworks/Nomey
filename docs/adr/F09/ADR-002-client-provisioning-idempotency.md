# F09/ADR-002 — Idempotencia por clave del provisioning iniciado por cliente

- **Estado:** Aceptado
- **Fecha:** 2026-09-06
- **Identificador anterior:** ADR-033 (numeración única, anterior a la organización por fases del 2026-09-14)
- **Alcance:** cómo se hace idempotente un comando de **provisioning** que nace
  en el cliente y no produce ninguna operación contable, empezando por
  `group.create`.
- **No reemplaza a ningún ADR.** Completa
  [F06/ADR-001](../F06/ADR-001-personal-provisioning.md) §6, que decidió que el
  provisioning **no** entra en `core.client_command` y lo resolvió con
  idempotencia por estado; aquí se cubre el caso en el que el estado no basta.
- **No decide** el mecanismo de los cargos recurrentes, las importaciones ni los
  comandos originados en el backend. Siguen abiertos, y siguen siendo preguntas
  distintas.

## Contexto

[F03/ADR-007](../F03/ADR-007-client-operation-idempotency.md) y
[F03/ADR-008](../F03/ADR-008-operation-version-model.md) §5 fijaron la unidad de
idempotencia del **comando contable de origen cliente**:
`core.client_command`, con clave `(created_by, client_operation_id)` transversal
a clases. Esa relación exige `result_operation_id` y `result_version_id` **not
null**, con FK a `core.operation_version`.

Crear un grupo no produce ninguna operación ni ninguna versión. F06/ADR-001 §6 ya
había mirado este mismo problema para el Modo Personal y decidió no usar aquella
relación, porque «contaminaría la relación contable y obligaría a inventarle un
`command_type` para algo que no lo es». Lo resolvió con **idempotencia por
estado**: un índice único `scope_un_personal_por_usuario` hace que el segundo
intento falle, se capture y se relea.

**Crear un grupo no puede resolverse así.** Dos grupos con el mismo nombre, la
misma moneda y los mismos participantes son legítimamente dos grupos: no hay
ningún estado que distinga un reintento de una segunda creación deliberada. Hace
falta una **clave**.

Y hace falta de verdad, no como precaución: la creación viaja por la cola
durable de [F07/ADR-001](../F07/ADR-001-offline-command-queue-and-optimistic-projection.md),
donde una respuesta perdida es un caso normal y el cliente **no puede distinguir
«no llegó» de «llegó y no me enteré»** — ni lo intenta, porque el servidor es
idempotente.

## Decisión

### 1. Una relación hermana, no una copia

`core.provisioning_command`:

```
created_by                uuid     ─┐ clave primaria
client_command_id         uuid     ─┘
command_type              text        'group.create'
command_contract_version  integer
canonical_intent          jsonb
result_scope_id           uuid        FK diferible → core.scope (id)
created_at                timestamptz
```

Tres diferencias con `core.client_command`, y las tres son el motivo de que
exista:

- **sin `result_operation_id` ni `result_version_id`**: no hay operación que
  referenciar, y fingir una sería contaminar la relación contable;
- **con `result_scope_id`**: es lo que este comando produce;
- **la FK es diferible**, porque la clave se reclama **antes** de crear el
  ámbito. Es F03/ADR-008 §13 aplicado al provisioning: reclamar primero, derivar
  después. Al final de la transacción, o existe todo o no existe nada.

**`command_type` NO entra en la clave**, igual que allí: la unicidad es
transversal, de modo que una misma clave no puede reaparecer disfrazada de otro
comando.

### 2. Replay y reutilización son cosas distintas

`canonical_intent` guarda la intención **tal y como el servidor la entendió** —el
nombre y los nombres de los participantes ya canonicalizados por
`sec.canonical_display_name`, no lo que llegó—. Con eso:

| Segunda llamada                     | Resultado                                            |
| ----------------------------------- | ---------------------------------------------------- |
| misma clave, **misma** intención    | **replay**: el mismo grupo, sin duplicar nada        |
| misma clave, **distinta** intención | `IDEMPOTENCY_KEY_REUSED · 409`                       |
| clave distinta, intención idéntica  | un grupo nuevo, legítimo                             |
| `client_group_id` ya existente      | `SCOPE_ID_TAKEN · 409` — se rechaza, nunca se adopta |
| carrera perdida contra otra sesión  | `COMMAND_IN_FLIGHT · 409`: reintenta, que es seguro  |

**El servidor no confía en que el cliente haya canonicalizado.** Si lo hiciera,
dos clientes con normalizaciones distintas producirían intenciones distintas para
la misma orden y un reintento legítimo se leería como clave reutilizada. La
paridad entre las dos implementaciones se garantiza con vectores compartidos
—`tests/vectors/display-names.json`, 33 casos— y no compartiendo código, que es
el mismo mecanismo de F01/ADR-001 §7.

### 3. El reclamo es también la autorización de la primera membresía

Crear la primera membresía de un grupo tiene un problema conocido: el `WITH
CHECK` de `core.membership` querría comprobar el ámbito, pero durante la creación
la membresía todavía no existe, y esa subconsulta está sujeta a la RLS del propio
provisioner. E21 midió ese mismo callejón en el Modo Personal.

**La autorización es el reclamo**, y no el estado del ámbito:

```sql
with check (
  user_id = sec.request_actor_id()
  and exists (
    select 1 from core.provisioning_command pc
    where pc.result_scope_id = membership.scope_id
      and pc.created_by      = sec.request_actor_id()
      and pc.command_type    = 'group.create'))
```

Es específico hasta el último campo: **este** actor, **este** ámbito, **este**
tipo de comando. Una clave de otra persona, de otro ámbito o de otro tipo no
autoriza nada, y una clave reclamada con otra intención ni siquiera llega —la
función la rechaza antes—. Fuera de la transacción de creación la autorización no
existe, porque el reclamo se va con ella.

Una versión anterior acotaba la policy por «grupo que todavía no tiene
miembros». Se descartó: describe un **instante**, no una autorización, es
demasiado ancha y cualquier función futura del provisioner la habría heredado
como capacidad. La sección `E` de `supabase/checks/group-provisioning.sql`
comprueba las cuatro negativas y el control positivo.

### 4. Privilegio mínimo, y nada para el cliente

La tabla **no es escribible ni legible por `authenticated`**: dice qué claves ha
usado alguien, y eso no es asunto de nadie más. Sólo `nomey_provisioner` la
alcanza, con `select` e `insert` y con policy acotada al actor. La frontera
`api.create_group` es `SECURITY DEFINER` con `search_path = ''`, propiedad del
provisioner, revocada de `public` y concedida a `authenticated`.

### 5. Este ADR NO resuelve los demás orígenes

`AGENTS.md` §3 deja abierto el mecanismo para **cargos recurrentes,
importaciones y operaciones de origen backend**, y dice que cada uno necesita una
garantía equivalente **en vez del mismo mecanismo**. Esto cubre exactamente un
caso —**provisioning iniciado por el cliente**— y los otros tres siguen abiertos.
Ampliar esta relación a ellos sería justo el atajo que aquella frase impide.

## Alternativas consideradas

| Alternativa                                                   | Por qué no                                                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Hacer anulables las dos columnas de `core.client_command`** | Rompe una relación contable aceptada para meter algo que no es contable, y obliga a inventarle un `command_type`. |
| **Idempotencia por estado, como en el Modo Personal**         | No existe estado que distinga un reintento de un segundo grupo idéntico.                                          |
| **Deduplicar por contenido del payload**                      | Dos grupos legítimamente iguales quedarían colapsados en uno, y sin forma de crear el segundo.                    |
| **Que el cliente compruebe antes de enviar**                  | El cliente no puede distinguir «no llegó» de «llegó y no me enteré», y F07/ADR-001 §2 ya lo decidió.              |
| **Policy acotada a «grupo sin miembros»**                     | Propiedad temporal demasiado ancha; se convierte en capacidad accidental para cualquier función futura.           |

## Consecuencias

- Un comando de provisioning de origen cliente ya tiene dónde ser idempotente
  sin tocar la contabilidad.
- El vocabulario de `command_type` es abierto **dentro de esta relación**, pero
  cada valor nuevo exige su propia frontera y su propia policy: no basta con
  insertar una fila.
- La concurrencia real está medida en `scripts/group-concurrency.sh`, con
  sesiones simultáneas de verdad: una sola sesión de `psql` no tiene carrera y
  pasaría también sin la clave primaria.
