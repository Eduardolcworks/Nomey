# E18 · Identidad del participante, reclamación y periodos

Evidencia reproducible de los últimos detalles físicos de **D10**: que las
restricciones del vínculo participante ↔ usuario **representen los invariantes
y no solo sus comentarios**, y qué cuesta impedir que los periodos de presencia
se solapen.

| Sonda     | Pregunta                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------- |
| **E18-A** | ¿Impiden las restricciones el doble claim, el doble participante por scope y el scope divergente? |
| **E18-B** | ¿Soporta el modelo entrar, salir y volver con una sola identidad, y qué cuesta impedir solapes?   |

E18 mide. **No decide nada**: D10 sigue sin cerrarse y D11 no se toca.

> **No forma parte del esquema de Nomey.** Vive fuera de `supabase/migrations/`
> —directorio que **todavía no existe**— a propósito. Se aplica y se retira a
> voluntad, y **nunca debe convertirse en migración**. Ningún objeto `e18_`
> pertenece al modelo de datos.

**`e18_user` sustituye a `auth.users` a propósito.** Lo que se mide son las
restricciones del vínculo, no la integración con GoTrue, y así el sondeo **no
crea ni borra usuarios reales**.

## Aislamiento de dependencias

**Cero dependencias.** Los `.sql` se ejecutan con `psql` dentro del contenedor y
el `.sh` solo orquesta dos sesiones concurrentes. **Sin secretos**: no hay
claves, contraseñas ni usuarios reales.

## Archivos

| Archivo            | Qué hace                                                                |
| ------------------ | ----------------------------------------------------------------------- |
| `10-setup.sql`     | La maqueta: scopes, participantes, vínculo y periodos. Idempotente      |
| `20-claims.sql`    | E18-A1, A2, A3, A4 y A6                                                 |
| `21-claim-race.sh` | E18-A5: dos claims simultáneos sobre el mismo participante              |
| `30-periods.sql`   | E18-B: dos periodos, elegibilidad por fecha, y el coste de la exclusión |
| `99-teardown.sql`  | Retirada completa. Debe devolver **0** en las tres comprobaciones       |

## Reproducirlo

Requiere Docker y el stack local (`npx supabase start`).

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/e18/10-setup.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e18/20-claims.sql
```

```bash
bash supabase/e18/21-claim-race.sh
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e18/30-periods.sql
```

Teardown, **obligatorio**:

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X < supabase/e18/99-teardown.sql
```

## La forma medida

```
e18_scope                  e18_participant
  id                         id
                             scope_id
                             display_name
                             UNIQUE (id, scope_id)   ← destino de la FK compuesta
                                  ▲
                                  │
e18_participant_user_link         │        e18_participant_period
  participant_id  PK  ────────────┤          participant_id
  scope_id        ────────────────┘          valid_from · valid_until (nullable)
  user_id                                    period  daterange generado
  UNIQUE (scope_id, user_id)
  FK (participant_id, scope_id) → participant (id, scope_id)
```

## Resultados observados

Hechos medidos. **No son recomendaciones**, y no deben leerse como tales.

### E18-A · Reclamación y unicidad

| Caso   | Escenario                                                      | Resultado                                                   |
| ------ | -------------------------------------------------------------- | ----------------------------------------------------------- |
| **A1** | P123 sin usuario, U1 lo reclama                                | **Aceptado**                                                |
| **A2** | U2 intenta reclamar P123 ya reclamado                          | **Rechazado** `23505` · clave primaria del vínculo          |
| **A3** | U1 intenta reclamar además P456, en el **mismo** scope         | **Rechazado** `23505` · `UNIQUE (scope_id, user_id)`        |
| **A4** | U1 reclama P789 en **otro** scope                              | **Aceptado**                                                |
| **A5** | Dos usuarios reclaman P123 **a la vez**                        | **Exactamente uno gana**; el otro recibe `unique_violation` |
| **A6** | Vínculo declarando un `scope_id` que no es el del participante | **Rechazado** `23503` · FK compuesta                        |

> **Cada rechazo lo produce la restricción que le corresponde**, y el mensaje la
> nombra. No hay ninguna que dependa de un comentario para significar algo.

Las dos unicidades son **distintas y ambas necesarias**: la clave primaria sobre
`participant_id` impide que **dos usuarios** reclamen el mismo participante;
`UNIQUE (scope_id, user_id)` impide que **un usuario** sea dos participantes del
mismo scope. Una no implica la otra.

A4 confirma que **el aislamiento entre scopes es real**: el mismo usuario puede
estar vinculado a participantes de grupos distintos, y eso es lo esperado.

### E18-B · Periodos de presencia

Carlos entra, sale y vuelve, con **una sola identidad**:

| `valid_from` | `valid_until` | rango generado            |
| ------------ | ------------- | ------------------------- |
| 2026-01-01   | 2026-03-01    | `[2026-01-01,2026-03-01)` |
| 2026-06-01   | (abierto)     | `[2026-06-01,)`           |

Elegibilidad por fecha efectiva, con `period @> fecha`:

| Fecha efectiva | Elegible | Esperado |
| -------------- | -------- | -------- |
| 2026-02-01     | **sí**   | sí       |
| 2026-04-15     | **no**   | no       |
| 2026-09-01     | **sí**   | sí       |

**El `participant_id` no cambia entre periodos**, así que la historia contable
anterior sigue apuntando al mismo sujeto.

### El coste de impedir solapes de forma declarativa

Una restricción `EXCLUDE USING gist (participant_id WITH =, period WITH &&)`
**no se puede crear tal cual**:

```
42704: data type uuid has no default operator class for access method "gist"
```

Necesita la extensión **`btree_gist`**, que en este stack está **disponible pero
no instalada** (versión 1.7).

Con la extensión instalada, la restricción funciona exactamente como se espera
**[medido]**: rechaza `23P01` un periodo que solapa con otro **del mismo
participante**, y **acepta** el mismo rango de fechas para **otro participante**.

> **El sondeo instala `btree_gist` temporalmente y la retira en el mismo
> script.** Adoptar una extensión nueva es una decisión que necesita revisión, y
> E18 no la toma: solo mide su coste. El teardown comprueba que no queda
> instalada.

La alternativa —validar el solape dentro de la transacción autoritativa— no
necesita extensión, pero traslada la garantía del motor al código.

## Versiones de la ejecución registrada

| Componente | Versión               |
| ---------- | --------------------- |
| PostgreSQL | 17.6                  |
| btree_gist | 1.7 (no instalada)    |
| Docker     | 29.7.2, backend WSL 2 |

## Salidas

**No se versionan.** El procedimiento las regenera enteras.
