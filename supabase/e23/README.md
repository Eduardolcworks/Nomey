# E23 · Qué lee cada superficie de Personal cuando una cuenta deja de ser miembro

> **Esto es evidencia, no norma.** Mide el comportamiento **actual** de las
> lecturas si se quita la membresía —y, aparte, si se cierra la presencia— sin
> cambiar nada más. **No decide nada**: las decisiones viven en
> [F09/ADR-003](../../docs/adr/F09/ADR-003-leaving-a-group.md).
>
> **NO ES UNA MIGRACIÓN.** Ningún fichero de este directorio debe convertirse
> en una, igual que `supabase/e11`–`e22`.

Medido el **2026-09-10** sobre la pila local con las migraciones de F9
aplicadas hasta `20260910150000`. Todo en una transacción que termina en
`rollback`; los actores, el grupo y los gastos son fixtures con uuids fijos.

```bash
docker cp supabase/e23/leave-group-reads.sql supabase_db_Nomey:/tmp/e23.sql
docker exec supabase_db_Nomey psql -U postgres -d postgres -f /tmp/e23.sql
```

## Escenario

Tres cuentas con Modo Personal: **Edu** (crea el grupo), **Ana** y **Luis**
(reclamados y miembros, sembrados como `postgres` porque F10 no existe), y
**Marta** sin cuenta. Presencias abiertas desde hace diez días.

- **E1**, hace 3 días: Edu paga 1000 entre los cuatro → cada uno debe 250.
- **E2**, hace 2 días: Luis paga 900 entre Edu, Ana y Luis → cada uno debe 300.
- Edu corrige E1 antes de que nadie salga: Ana y Luis reciben un aviso.

Posiciones: **Ana −550** (sale debiendo), **Luis +350** (sale cobrando),
Edu +450, Marta −250.

## Resultados

| Lectura                                     | Antes                                | Tras quitar SOLO la membresía a Ana y Luis | Conclusión                                                     |
| ------------------------------------------- | ------------------------------------ | ------------------------------------------ | -------------------------------------------------------------- |
| `api.claimed_dimension()` · deuda de Ana    | `-300 -250`                          | **`-300 -250`**                            | **Atraviesa RLS por vínculo: NO excluye la deuda**             |
| `api.claimed_dimension()` · deuda de Luis   | `-250 +300 +300`                     | **`-250 +300 +300`**                       | Ídem, positiva                                                 |
| `api.personal_statistics` · Ana             | `expense_total = 550`                | `550`                                      | Cuotas económicas conservadas (definer por vínculo)            |
| `api.personal_statistics` · Luis            | `550`                                | `550`                                      | Ídem                                                           |
| `api.personal_balance` · Luis               | `-900`                               | `-900`                                     | Caja conservada: el efecto está en su ámbito personal          |
| `api.personal_operation` · Luis (E2)        | `E23 salida │ 300 │ -900`            | **`NULL │ NULL │ -900`**                   | **La fila queda; el nombre del grupo y «tu parte» se pierden** |
| `api.personal_operation_version` · Luis     | concepto y categoría                 | concepto y categoría                       | El historial no depende del grupo                              |
| `api.group_profile` · Ana                   | 1                                    | 0                                          | Invisible por RLS                                              |
| `api.group_summary` · Ana                   | 1                                    | 0                                          | Deudas de Personal (cliente) deja de sumarla                   |
| `core.group_edit_notice` · destinatario Ana | 1                                    | **1**                                      | El aviso antiguo sigue siendo suyo tras salir                  |
| `api.group_balance` · visto por Edu         | Ana −550 Edu 450 Luis 350 Marta −250 | idéntico                                   | Deudas intactas para quien permanece                           |
| `api.group_participant` · visto por Edu     | 4                                    | 4                                          | El participante no desaparece                                  |

**Con la presencia de Ana cerrada (`valid_until = hoy`, exclusivo), visto por
Edu, miembro:**

| Escritura                                    | Resultado                  |
| -------------------------------------------- | -------------------------- |
| Gasto nuevo con Ana fechado **ayer**         | aceptado                   |
| Gasto nuevo con Ana fechado **hoy**          | `PARTICIPANT_NOT_ELIGIBLE` |
| Gasto nuevo con Ana fechado **mañana**       | `PARTICIPANT_NOT_ELIGIBLE` |
| Corregir E1 (hace 3 días, Ana dentro)        | aceptado                   |
| Liquidar hoy la deuda de Ana con Edu         | `PARTICIPANT_NOT_ELIGIBLE` |
| Luis, ya sin membresía, corrige su propio E2 | `NOT_AUTHORIZED`           |

## Un hallazgo al margen

`api.group_edit_notice` y `api.group_profile_notice` **no se pueden leer como
`authenticated`**: `permission denied for function request_actor_id`. Sus
políticas en `core` llaman a `sec.request_actor_id()` directamente, que no es
ejecutable por el cliente a propósito; la misma migración creó `sec.is_me()`
para envolverla y no la usó en las políticas. La sección I de
`checks/group-expense-flow.sql`, que nunca llegó a pasar, lo habría delatado.
Corregido con la implementación de F09/ADR-003 (`core.group_notice`, políticas por
`sec.is_me` y `sec.is_member`); la sección I de `group-expense-flow.sql` lo
mide desde entonces.
