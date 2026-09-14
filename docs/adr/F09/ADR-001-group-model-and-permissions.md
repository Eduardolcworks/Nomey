# F09/ADR-001 — Modelo de Grupo y contrato de permisos

- **Estado:** Aceptado
- **Fecha:** 2026-09-06
- **Identificador anterior:** ADR-032 (numeración única, anterior a la organización por fases del 2026-09-14)
- **Alcance:** dónde viven los atributos de un Grupo, quién puede actuar sobre
  él, qué significa haber creado uno, y hasta cuándo puede cambiarse su moneda
  base.
- **No reemplaza a ningún ADR.** Se apoya en
  [F01/ADR-001](../F01/ADR-001-accounting-model.md) §2 (el ámbito como ancla contable),
  [F03/ADR-004](../F03/ADR-004-membership-rls.md) (la RLS como autoridad de fila),
  [F03/ADR-009](../F03/ADR-009-participant-identity.md) (participante, vínculo y periodo
  como tres relaciones distintas) y
  [F06/ADR-001](../F06/ADR-001-personal-provisioning.md) (el tercer rol de provisioning).
- **No decide** el flujo de unión, la reclamación de un participante, la pantalla
  de edición, el historial de cambios ni la conversión multidivisa. Lo que queda
  fuera está enumerado al final, con su destino.

## Contexto

`core.scope` existe desde la Fase 3 y su migración dejó una frase escrita:
«Los atributos de Grupo y Modo Pareja llegan en sus fases». Llega la de Grupo, y
con ella tres preguntas que hasta hoy no había que responder.

**Dónde va un nombre.** Un grupo tiene nombre y emoji; el Modo Personal no tiene
ninguno de los dos, y no los tendrá. `core.scope` es el ancla contable y de
autorización, y su vocabulario de columnas es el que comparten los tres tipos de
ámbito.

**Quién manda.** La pregunta se responde sola en cuanto se mira el esquema:
`core.membership` **no tiene columna de rol**, y su propia migración dice que
ningún ADR fija roles dentro de un ámbito. Lo que hacía falta era decidir si eso
era una omisión o una decisión.

**Hasta cuándo se puede cambiar la moneda.** El invariante 12 dice «inmutable
tras su primera operación» y es agnóstico del tipo de ámbito.
[F06/ADR-001](../F06/ADR-001-personal-provisioning.md) §7 ya lo aplicó al Modo Personal;
falta decir que en un Grupo rige igual y para todos sus miembros.

## Decisión

### 1. El perfil es una relación propia, no dos columnas

`core.group_profile`, con `scope_id` como clave primaria y FK al ámbito:

```
scope_id      uuid  PK  → core.scope (id)
scope_kind    text      siempre 'group'
display_name  text      no vacío, sin longitud máxima
emoji         text      no vacío
created_by    uuid      atribución, nunca privilegio
created_at    timestamptz
updated_at    timestamptz
```

**Es el mismo patrón que el modelo ya usa una capa más abajo.** Lo que sólo
existe en algunas clases de operación vive en su propia relación
—`core.movement_detail` para el concepto, `core.expense_category` para la
categoría— en vez de como columnas anulables en la versión. Un nombre y un emoji
son de Grupo y no de Personal: mismo caso, misma forma.

**Y que el perfil cuelgue de un ámbito de tipo grupo es ESTRUCTURAL.** Un
`CHECK` no puede mirar otra tabla, así que la regla la sostienen una columna
redundante `scope_kind` con su `CHECK`, una clave `unique (id, kind)` en
`core.scope` y una FK compuesta contra ella. Es el mismo mecanismo con el que
`core.effect` obliga a que la moneda de un efecto sea la base de su ámbito.

**Sin longitud máxima**, porque no existe ninguna. El único contrato de texto de
presentación del modelo es `core.participant.display_name`: `not null` con
`check (display_name <> '')`. Inventar un tope aquí sería inventar un contrato
que después habría que defender.

### 2. No hay roles internos, y `created_by` no es uno

**Toda cuenta con membresía en el ámbito tiene exactamente la misma capacidad**
sobre el grupo: nombre, emoji y participantes. No hay `owner`, no hay `admin`, y
`core.scope.owner_user_id` es nulo en un grupo por construcción —el índice único
`scope_un_personal_por_usuario` y el propio `kind` lo garantizan—.

`core.group_profile.created_by` **es atribución para el historial futuro y no
concede nada**. La distinción importa: si mañana alguien la leyera como
privilegio, el modelo tendría un administrador sin haberlo decidido nadie. La
comprobación `A3` de `supabase/checks/group-provisioning.sql` falla si aparece
cualquier columna llamada `role`, `admin` u `owner` en las relaciones de grupo.

### 3. Un participante sin cuenta no puede actuar, y no hace falta escribirlo

No es una regla: es que **no existe ninguna fila que le dé acceso**. La
autorización se resuelve con `sec.is_member(scope_id)`, que mira
`core.membership`; un `core.participant` sin `core.participant_user_link` no
aparece por ahí. Reclamar el nombre —F10— creará el vínculo y la membresía, y con
ellos exactamente la misma capacidad que los demás, sin aprobación de nadie
porque no hay nadie que apruebe.

Los tres hechos siguen siendo tres relaciones distintas, como fija F03/ADR-009 §4:

| Relación                     | Pregunta que responde                               |
| ---------------------------- | --------------------------------------------------- |
| `core.membership`            | ¿Qué puede ver o hacer una cuenta **ahora**?        |
| `core.participant_user_link` | ¿Qué cuenta hay detrás de esa identidad contextual? |
| `core.participant_period`    | ¿**Cuándo** fue elegible ese participante?          |

### 4. La moneda base se elige al crear y se bloquea con la primera operación

Se preselecciona la del Modo Personal del actor y puede cambiarse antes de
crear. Después, **cambia mientras el ámbito no tenga ningún efecto y queda
bloqueada para todos los miembros en cuanto tiene uno**, exactamente como en el
Modo Personal y por la misma autoridad: la FK compuesta
`effect (scope_id, currency_definition_id) → scope (id, base_currency_definition_id)`,
que es estructura y no validación.

Este ADR **no** implementa el cambio de moneda de un grupo ni la conversión
multidivisa. Lo que sí hace es no impedirlos: el importe original, su moneda, el
cambio aplicado y su procedencia tienen ya su sitio en
`core.frozen_conversion`, y saldos y deudas se derivan en la moneda base del
ámbito.

### 5. La lectura del cliente publica el perfil, nunca el vínculo

`api.group_profile` y `api.group_participant`, las dos `security_invoker`, de
modo que quien decide es la RLS del usuario real (E19). `api.group_participant`
**no publica `user_id`**: revelaría qué cuenta global hay detrás de un nombre
contextual, que es exactamente lo que F03/ADR-009 §1 mantiene fuera del ámbito.

## Alternativas consideradas

| Alternativa                                          | Por qué no                                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Nombre y emoji como columnas de `core.scope`**     | Convierte el ancla contable en descriptor y le añade dos columnas nulas para el Modo Personal. El modelo ya resolvió este caso al lado.   |
| **Un rol `admin` para el creador**                   | Ningún requisito lo pide, y una vez escrito hay que decidir qué pasa si se va. La igualdad es más simple y es lo que el producto quiere.  |
| **`created_by` como privilegio**                     | Es la misma decisión disfrazada. Se conserva como atribución y una comprobación vigila que no gane semántica.                             |
| **Una tabla de miembros propia del grupo**           | `core.membership` ya responde a «qué puede hacer una cuenta ahora» para los tres tipos de ámbito. Duplicarla sería duplicar la autoridad. |
| **Publicar el vínculo en la vista de participantes** | Correlaciona identidades entre ámbitos, que es lo que F03/ADR-009 §1 prohíbe.                                                             |

## Consecuencias

- Un grupo se lee con dos vistas y se crea con una sola función; no hay ninguna
  otra puerta.
- Cualquier miembro podrá editar nombre, emoji y participantes cuando exista la
  pantalla de edición. Esa escritura **no se expone todavía**: llegará con actor,
  estado anterior y posterior, fecha, historial y notificación desde su primera
  versión.
- Nada en este ADR crea un administrador, y la comprobación `A3` lo vigila.

## Lo que queda fuera, y dónde va

| Tema                                                     | Destino                |
| -------------------------------------------------------- | ---------------------- |
| Flujo de unión por enlace o QR, y prueba de autorización | F10, sobre F03/ADR-009 |
| Reclamación y fusión de participantes                    | F10                    |
| `api.update_group_profile` con historial y notificación  | su propio paso de F9   |
| Cambio de moneda base de un grupo                        | F11, con conversión    |
| Gastos compartidos, saldos, deudas y liquidaciones       | F9 posterior           |
