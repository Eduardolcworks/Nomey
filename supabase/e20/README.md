# E20 · Las políticas RLS del writer durante la secuencia autoritativa

> **Esto es evidencia, no norma.** Mide comportamiento de PostgreSQL bajo el
> writer de [ADR-009](../../docs/adr/ADR-009-authoritative-write-boundary.md)
> §5. **No decide nada**: las decisiones viven en `docs/adr/`.
>
> **NO ES UNA MIGRACIÓN.** Ningún fichero de este directorio debe convertirse
> en una. `supabase/migrations/` sigue sin existir.

## La incertidumbre que existe para responder

[ADR-013](../../docs/adr/ADR-013-persisted-vs-derived.md) §10 dejó
deliberadamente abierto un punto, y sólo uno:

> **El `WITH CHECK` definitivo del writer sobre los efectos no se fija aquí.**
> Corresponde a **E20**, antes de escribir migraciones.

La pregunta, en su forma operativa:

> En una transacción ejecutada por el writer autoritativo —`NOLOGIN`, no
> propietario, `NOBYPASSRLS`— ¿qué conjunto mínimo de políticas RLS **por
> comando** permite ejecutar la secuencia de escritura, y en particular puede
> existir un `WITH CHECK` **no trivial y útil** sobre `effect` que use
> información de `operation` / `operation_version` insertada **en esa misma
> transacción**?

Lo que ADR-013 §10 ya había fijado y **no** se remide aquí: políticas separadas
por comando y por rol · el cliente sin grants ni políticas de escritura ·
autorización funcional como primera barrera y RLS como segunda · `operation` y
`operation_version` sin ámbito · ninguna política aplicable a `PUBLIC` ·
ninguna política `RESTRICTIVE` · y que **el aislamiento por ámbito no puede ser
el predicado de `effect`**, porque ADR-002 §10 permite efectos sobre el ámbito
de otro.

## Qué contiene el montaje

Una maqueta de juguete de `operation`, `operation_version` y `effect` con la
forma estructural de ADR-011 §4 y ADR-013 §2, §3 y §8 —incluida la FK compuesta
diferible del puntero— **sin ninguna columna de negocio**: no se mide
contabilidad, se miden políticas.

| Pieza                               | Por qué está                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `e20_writer`                        | `NOLOGIN`, `NOBYPASSRLS`, `NOSUPERUSER`, **no propietario** de las tablas                  |
| `e20_sec.request_actor_id()`        | Equivalente reducido del helper de ADR-009 §3: `STABLE`, `SECURITY INVOKER`, falla cerrado |
| `e20_api.run_sequence(...)`         | La frontera autoritativa: `SECURITY DEFINER`, propiedad del writer, `search_path = ''`     |
| `e20_api.run_correction(...)`       | La corrección: V(n) nueva, efecto y **movimiento del puntero**                             |
| Políticas candidatas                | Separadas por comando, todas `TO e20_writer`                                               |
| `GRANT UPDATE (current_version_id)` | El estrechamiento por columna, que **no** es una política                                  |

> **La frontera de la maqueta NO valida que la atribución coincida con el
> actor.** La real sí lo hace (primera barrera). Se omite **a propósito** para
> que la segunda barrera —la RLS— sea observable y no quede tapada por la
> primera.

**Cero dependencias.** Los `.sql` se ejecutan con `psql` dentro del contenedor.
Los actores son UUID fijos y **no son filas de `auth.users`**: el helper sólo
lee el GUC `request.jwt.claims`, así que el experimento no necesita usuarios
reales.

| Fichero                         | Qué mide                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `10-setup.sql`                  | Roles, tablas, helper, grants, políticas candidatas y frontera autoritativa   |
| `20-sequence.sql`               | **A** · la secuencia completa y la atribución, coherente e incoherente        |
| `30-effect-check.sql`           | **B** · el `WITH CHECK` de `effect`: la pregunta central                      |
| `40-returning-lock-columns.sql` | **C** · `INSERT … RETURNING`, `SELECT … FOR UPDATE` y columnas frente a filas |
| `50-helper.sql`                 | **D** · el helper del actor dentro de las políticas del writer                |
| `60-attribution.sql`            | **E** · el predicado de `operation` sin decidir quién puede corregir          |
| `70-cross-author.sql`           | **F** · la lectura de la versión anterior en una corrección por otro actor    |
| `99-teardown.sql`               | Retirada y recuento de residuos                                               |

## Cómo reproducirlo

Requiere Docker y el stack local (`npx supabase start`). El orden importa:
`30-`, `40-`, `50-` y `60-` usan la operación que crea `20-`; `70-` siembra la
suya.

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/e20/10-setup.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e20/20-sequence.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e20/30-effect-check.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e20/40-returning-lock-columns.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e20/50-helper.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e20/60-attribution.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q < supabase/e20/70-cross-author.sql
```

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X < supabase/e20/99-teardown.sql
```

`10-setup.sql` es idempotente: hace su propio teardown previo. La cadena
completa se ejecutó **dos veces desde cero** con resultados idénticos.

Los casos que alteran privilegios o políticas lo hacen **dentro de una
transacción que termina en `ROLLBACK`**, de modo que el montaje queda como
estaba. Cada fichero lo comprueba al final imprimiendo el estado.

## Resultados observados

Hechos medidos. **No son recomendaciones**, y no deben leerse como tales.

### A · La secuencia completa

| Caso   | Qué se ejecuta                                               | Resultado                                              |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------ |
| **A1** | Secuencia de 5 pasos, atribución coherente, **con `COMMIT`** | **OK**. La FK compuesta diferida valida al commit      |
| **A2** | Igual, atribuyendo la escritura a otro actor                 | **`42501`** en el paso 1, `new row violates … policy`  |
| **A3** | Operación coherente pero **versión** atribuida a otro        | Paso 1 aceptado · **`42501`** en el paso 2             |
| **A4** | Corrección: V2 + efecto + movimiento del puntero             | **OK**. Puntero previo devuelto correctamente          |
| **A5** | La misma corrección **por otro actor**                       | **0 filas** en el `SELECT … FOR UPDATE`, **sin error** |
| **A6** | El rol cliente escribiendo y leyendo `e20_core` directamente | **`42501 permission denied for schema`** en ambos      |

La RLS detiene A2 y A3 **con la autorización funcional deliberadamente
ausente**. Es la segunda barrera de ADR-009 §6 funcionando sola.

### B · El `WITH CHECK` de `effect` — la pregunta central

Predicado medido:

```sql
with check (
  exists (select 1 from core.operation_version ov
           where ov.id = effect.operation_version_id
             and ov.created_by = sec.request_actor_id())
)
```

| Caso   | Escritura intentada                                             | Resultado                                     |
| ------ | --------------------------------------------------------------- | --------------------------------------------- |
| **B1** | Efecto sobre una versión insertada **en la misma transacción**  | **ACEPTADO**                                  |
| **B2** | Efecto sobre una versión **comprometida de otro actor**         | **`42501`**                                   |
| **B3** | Efecto sobre una versión **propia ya comprometida**             | **ACEPTADO**                                  |
| **B4** | Efecto sobre un **ámbito ajeno**, colgando de versión propia    | **ACEPTADO**                                  |
| **B5** | B3 **sin la política de `SELECT`** del writer sobre la versión  | **`42501`** — el `WITH CHECK` se vuelve falso |
| **B6** | B3 **sin el `GRANT SELECT`** sobre la versión                   | **`42501 permission denied for table`**       |
| **B7** | El predicado por **ámbito** que ADR-013 descarta, repitiendo B4 | **`42501`** — rechaza una escritura legítima  |

**Cuatro hechos, en orden de importancia:**

1. **El subselect de una política `WITH CHECK` ve las filas que la propia
   transacción acaba de insertar y aún no ha confirmado** (B1). El predicado es
   satisfacible durante la secuencia, sin diferir nada y sin equivalente al
   truco de la FK diferida.
2. **Discrimina de verdad** (B2 frente a B3): no es `WITH CHECK (true)`
   disfrazado, y lo que separa no es «misma transacción» sino **misma
   atribución**.
3. **Acepta lo que ADR-002 §10 exige aceptar** (B4) y el predicado por ámbito
   **no** (B7). Queda medido por qué ADR-013 §10 lo descartaba.
4. **Ese subselect pasa por los grants y por la RLS del rol que escribe** (B5,
   B6). La política de `SELECT` del writer sobre `operation_version` **no es
   sólo de lectura: es portante del `WITH CHECK` de `effect`**. Retirarla no
   afloja la escritura, la **rompe**.

> El punto 4 es lo más fácil de perder de vista. Es lo contrario de lo que
> sugiere E13 §helper: allí el rol cliente dejaba de necesitar `SELECT` sobre
> `membership` **porque el helper era `SECURITY DEFINER` y rompía la cadena**.
> Aquí la política lee la tabla **directamente**, así que la cadena no se rompe
> y se aplican grants y RLS.

### C · Tres comportamientos de PostgreSQL

| Caso    | Qué se ejecuta                                                  | Resultado                               |
| ------- | --------------------------------------------------------------- | --------------------------------------- |
| **C1a** | `INSERT` en `effect` **sin** `RETURNING`, sin política `SELECT` | **ACEPTADO**                            |
| **C1b** | El mismo `INSERT … RETURNING`, sin política `SELECT`            | **`42501`**                             |
| **C2**  | El mismo `INSERT … RETURNING` **con** política `SELECT`         | **ACEPTADO**                            |
| **C3**  | `SELECT … FOR UPDATE` con políticas de `SELECT` **y** `UPDATE`  | **1 fila**                              |
| **C4a** | `SELECT` **sin** `FOR UPDATE`, sin política de `UPDATE`         | **1 fila**                              |
| **C4b** | `SELECT … FOR UPDATE`, sin política de `UPDATE`                 | **0 filas, y NINGÚN error**             |
| **C5**  | `UPDATE` de otra columna, con `GRANT UPDATE (columna)`          | **`42501 permission denied for table`** |
| **C6**  | El mismo `UPDATE` con `GRANT UPDATE` de tabla                   | **ACEPTADO**                            |
| **C7**  | Reatribuir la fila a otro actor, con grant amplio               | **`42501`**                             |

**Cuatro hechos:**

1. **`INSERT … RETURNING` sí exige una política de `SELECT` adicional** (C1b
   frente a C1a). **Y el mensaje de error engaña**: dice
   `new row violates row-level security policy`, que apunta al `WITH CHECK`
   cuando la causa real es la política de `SELECT` ausente. Un `RETURNING`
   añadido más tarde a una función que funcionaba la rompe con un error que
   señala al sitio equivocado.
2. **`SELECT … FOR UPDATE` exige además la política de `UPDATE`, y su ausencia
   es SILENCIOSA** (C4b). No hay excepción: **el bloqueo devuelve cero filas**.
   El mismo `SELECT` sin `FOR UPDATE` devuelve la fila.
3. **La RLS no estrecha por columna** (C5 frente a C6). Limitar el `UPDATE` a
   `current_version_id` es un **grant por columna**; con `GRANT UPDATE` de
   tabla, la misma política deja mutar `operation_class` sin protestar.
4. **El `WITH CHECK` omitido de un `UPDATE` sí existe: es el `USING`** (C7).

> El punto 2 es el hallazgo más peligroso del experimento. El protocolo de
> serialización de la deuda de ADR-013 §11 empieza por **«adquirir el lock»**.
> Si la política de `UPDATE` del writer falta o no cubre la fila, ese paso
> **no bloquea nada y no avisa**: la transacción continúa, lee, valida y
> escribe sobre datos que creía haber protegido. Es exactamente el modo de
> fallo de E15 —sobrepago por falta de serialización— con la causa escondida
> una capa más abajo.

### D · El helper del actor dentro de las políticas del writer

| Caso    | Situación                                        | Resultado                                      |
| ------- | ------------------------------------------------ | ---------------------------------------------- |
| **D1**  | Sin `request.jwt.claims`                         | **`42501`**, con el mensaje del propio helper  |
| **D2**  | `sub` presente pero no es un UUID                | **`22P02 invalid input syntax for type uuid`** |
| **D3a** | Helper **dentro de una política**, sin `USAGE`   | **Funciona**                                   |
| **D3b** | Helper invocado **desde el cuerpo**, sin `USAGE` | **`42501 permission denied for schema`**       |
| **D4**  | Sin `EXECUTE` sobre el helper                    | **`42501 permission denied for function`**     |

**Dos hechos:**

1. **El helper falla cerrado también cuando lo evalúa una política**, y el
   fallo se propaga como error de la escritura, no como «cero filas».
2. **`EXECUTE` es portante; `USAGE` sobre el schema no lo es** para la
   evaluación dentro de una política, pero **sí** para la invocación directa
   desde el cuerpo de la función autoritativa. Reproduce en el contexto del
   writer lo que E13 midió para el rol cliente.

> **`22P02` no es `42501`.** Un `sub` con forma inválida sale como error de
> dato, no de permiso. Un helper de producción que quiera **fallar cerrado de
> forma uniforme** debe validar el UUID explícitamente en vez de dejar que lo
> haga el cast. Es una observación de implementación, no una decisión.

### E · El predicado de `operation`, y la regla de corrección

A5 mostró que con `operation.created_by = actor` como `USING` de `SELECT` y
`UPDATE`, **un actor distinto del creador no puede corregir la operación**: el
`SELECT … FOR UPDATE` del paso 1 devuelve 0 filas y la secuencia se detiene.

Eso **funciona**, pero afirma que «sólo el creador corrige». Un predicado RLS
que lo dé por resuelto estaría **metiendo una regla de producto en una política
de seguridad** — y además contradiría `data-model.md` §7, que ya decía que
corrige **cualquier integrante** con derecho a ello.

> **Decisión tomada, fijada en
> [ADR-013](../../docs/adr/ADR-013-persisted-vs-derived.md) §10.** La autoría
> original **no** concede exclusividad sobre las correcciones. El derecho a
> corregir es **funcional y contextual al ámbito**, se resuelve en la frontera
> autoritativa, y **ninguna política del writer deriva de
> `operation.created_by`**. Cada versión queda atribuida a quien la crea: si A
> registra V1 y B la corrige, V1 sigue siendo de A y V2 es de B.

Se midió por eso una alternativa que **no** prejuzga quién puede corregir: el
`USING` amplio, y la restricción útil trasladada al `WITH CHECK` explícito del
`UPDATE` —el puntero sólo puede moverse a **una versión atribuida al actor que
lo mueve**—.

| Caso   | Situación                                                          | Resultado                                 |
| ------ | ------------------------------------------------------------------ | ----------------------------------------- |
| **E1** | Línea base: el actor B corrige la operación de A                   | **0 filas**                               |
| **E2** | Con el predicado alternativo, el actor B corrige la operación de A | **OK**                                    |
| **E3** | Con el mismo, B mueve el puntero a una versión que **no** creó     | **`42501`**                               |
| **E4** | Con `USING (true)` en `operation`, el `WITH CHECK` de `effect`     | **Sigue rechazando** — son independientes |

E4 importa: aflojar `operation` **no afloja `effect`**. Los dos predicados no
están acoplados.

### F · La lectura de la versión anterior en una corrección por otro actor

La decisión de producto dice que Beto, funcionalmente autorizado, puede corregir
la V1 que creó Ana. **Pero construir V2 exige leer V1**, y las fuentes lo piden
explícitamente, no por conveniencia:

| Dato de V2                       | Por qué exige leer V1                              |
| -------------------------------- | -------------------------------------------------- |
| `version_no`                     | La frontera **calcula el siguiente** (ADR-011 §12) |
| FX congelado heredado            | La corrección **hereda** el de V1 (ADR-013 §6)     |
| Intención declarada no corregida | **Se conserva** la no corregida (ADR-013 §7)       |
| Reparto anterior                 | Cuelga de `(versión, ámbito)` (ADR-013 §5)         |

`supersedes_version_id` es la excepción: sale del puntero, que vive en la
operación.

| Caso    | Situación                                                          | Resultado                        |
| ------- | ------------------------------------------------------------------ | -------------------------------- |
| **F1a** | Beto lee la V1 de Ana con `USING (created_by = actor)`             | **0 filas**                      |
| **F1b** | El `version_no` siguiente que calcularía la frontera               | **`NULL`, y ningún error**       |
| **F2**  | El **identificador** de la versión vigente, desde la operación     | **1 fila** — legible             |
| **F3a** | La misma lectura con la política de versiones ampliada al writer   | **1 fila**, `version_no = 1`     |
| **F4**  | Beto crea V2 atribuida a **él**                                    | **ACEPTADO**                     |
| **F5**  | Con esa política amplia, efecto de Beto sobre la **V1 de Ana**     | **`42501`** — la barrera aguanta |
| **F6**  | Con esa política amplia, efecto de Beto sobre **su propia V2**     | **ACEPTADO**                     |
| **F7**  | Con esa política amplia, Beto crea una versión atribuida **a Ana** | **`42501`**                      |

**Tres hechos:**

1. **`USING (created_by = actor)` sobre las versiones es incompatible con la
   corrección por otro actor**, y falla **en silencio**: F1b devuelve `NULL`, no
   un error. La frontera concluiría que no hay predecesor.
2. **Conocer el puntero no sustituye la lectura** (F2 frente a F1a). El
   identificador de la versión vigente es legible desde la operación mientras la
   **fila** de esa versión permanece oculta: `supersedes_version_id` se satisface
   y ningún dato heredable.
3. **Ampliar la lectura no afloja la escritura** (F5, F6, F7). Son mecanismos
   distintos: la política de `SELECT` decide **qué filas lee** el writer; el
   `WITH CHECK` de los efectos decide **de qué versión pueden colgar**, y sigue
   exigiendo que sea una del actor de esa petición.

## Conclusión: el conjunto mínimo medido

**Esto describe lo que se midió que funciona.** La decisión que fija estos
predicados está en
[ADR-013](../../docs/adr/ADR-013-persisted-vs-derived.md) §10; los nombres
físicos siguen perteneciendo a la migración.

| Relación            | Comando  | Predicado medido que funciona                        | Nota                                                              |
| ------------------- | -------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| `operation`         | `INSERT` | `WITH CHECK (created_by = actor)`                    | No es regla de producto: la atribución inicial **es** el actor    |
| `operation`         | `SELECT` | Necesaria. **No deriva de la autoría original** (§E) | Portante del paso 4                                               |
| `operation`         | `UPDATE` | Necesaria **incluso sólo para bloquear** (C4b)       | Tampoco deriva de la autoría. El `WITH CHECK` omitido = `USING`   |
| `operation_version` | `INSERT` | `WITH CHECK (created_by = actor)`                    | Tampoco es regla de producto: es la atribución **de esa versión** |
| `operation_version` | `SELECT` | **Amplia**, no por atribución (§F)                   | **Portante del `WITH CHECK` de `effect`**, no sólo de la lectura  |
| `effect`            | `INSERT` | `WITH CHECK (exists versión con esa atribución)`     | **No trivial, satisfacible en la transacción y útil**             |
| `effect`            | `SELECT` | Sólo si la frontera usa `INSERT … RETURNING`         | C1b                                                               |

Y **fuera de la RLS**, porque la RLS no puede hacerlo:

- **`GRANT UPDATE (current_version_id)`** — el estrechamiento por columna (C5/C6);
- **`GRANT EXECUTE`** sobre el helper — portante de toda política que lo invoque (D4);
- **`GRANT SELECT`** sobre `operation_version` — portante del `WITH CHECK` de `effect` (B6).

### Sobre el `WITH CHECK` de `effect`, en concreto

**Sí puede existir un `WITH CHECK` no trivial y útil, y se midió funcionando.**
No hizo falta forzar ningún predicado artificial para evitar
`WITH CHECK (true)`, y el predicado que funciona **no** es el aislamiento por
ámbito, que rechazaría escrituras legítimas (B7).

Lo que garantiza: **todo efecto cuelga de una versión creada por el mismo actor
de la petición**. Un writer al que se le colase un `operation_version_id`
arbitrario —de otra operación, de otro usuario, adivinado— **no puede anclarle
efectos**.

**Se mantiene sin aflojar aunque la lectura de las versiones sea amplia** (F5,
F6): es lo que permite que la política de `SELECT` alcance la V1 de otro actor,
necesaria para corregir, sin que eso conceda anclar efectos a esa versión.

Lo que **no** garantiza, y sigue viviendo en otras capas:

| Garantía                                          | Dónde vive                                           |
| ------------------------------------------------- | ---------------------------------------------------- |
| Que el efecto sea contablemente correcto          | **Autorización y validación funcional** (1ª barrera) |
| Que el actor pueda operar sobre ese ámbito        | **Autorización funcional**. La RLS **no** puede (B7) |
| Que la versión pertenezca a la operación correcta | **FK compuesta** (E17)                               |
| Que el linaje de versiones sea coherente          | **Constraints** (E17)                                |
| Que nadie más ejecute el writer                   | **`NOLOGIN` + grants + `REVOKE … FROM PUBLIC`**      |
| Que el rol cliente no escriba                     | **Ausencia de grants** (A6)                          |

## Qué NO demuestra

- **No decide nada.** Es una maqueta con nombres `e20_*` y sin columnas de
  negocio. Los nombres físicos y el predicado definitivo pertenecen al ADR y a
  la migración.
- **No demuestra que este predicado sea el mejor**, sólo que **existe uno no
  trivial, satisfacible y útil**, y que el candidato por ámbito no lo es.
- **No mide concurrencia ni rendimiento.** C4b describe el comportamiento del
  bloqueo bajo RLS; **no** ejecuta dos transacciones a la vez ni reproduce el
  sobrepago de E15.
- **No mide las políticas de lectura del rol cliente** de ADR-013 §10, que son
  de otro rol y otro camino.
- **No toca `client_command`**, ni la idempotencia, ni la canonicalización.
- **No decide quién puede corregir una operación ajena.** §E midió que la
  elección de predicado **depende** de esa regla; la regla la fijó la decisión
  de producto recogida en ADR-013 §10, no este experimento.
- **No mide la autorización funcional del ámbito**, que es la primera barrera y
  vive en la frontera autoritativa.
- **No mide la resolución del FX, el claim de participantes ni `btree_gist`.**
- **No prueba el bypass de las comprobaciones de integridad referencial.** Que
  las FK ignoren la RLS es comportamiento documentado de PostgreSQL que este
  experimento **usa**, pero no verifica por separado.

## Qué decisión existente precisa

**Precisa [ADR-013](../../docs/adr/ADR-013-persisted-vs-derived.md) §10** en el
único punto que ese ADR dejó abierto, y **no lo contradice en nada**:

- confirma que el predicado por **ámbito** no sirve (B7), que era lo único que
  ADR-013 §10 daba por fijado sobre `effect`;
- confirma que **la separación por comando y por rol es necesaria**: el
  predicado de `effect` es insatisfacible en los pasos 1 y 2, donde todavía no
  hay efectos, y las políticas no son diferibles;
- **añade** que las políticas de `SELECT` del writer son portantes de la
  escritura, cosa que ADR-013 no afirmaba.

**Precisa [ADR-009](../../docs/adr/ADR-009-authoritative-write-boundary.md) §6**
—la RLS como segunda barrera— mostrándola deteniendo escrituras con la primera
barrera deliberadamente ausente (A2, A3).

**Toca [ADR-013](../../docs/adr/ADR-013-persisted-vs-derived.md) §11** sin
contradecirlo: el paso 2 del protocolo —«adquirir el lock»— **depende de una
política de `UPDATE` que ADR-013 no menciona**, y su ausencia es silenciosa
(C4b).

**Planteó**, sin resolverlo por su cuenta, **quién puede corregir una operación
que no creó** (§E). La decisión de producto está tomada y fijada en ADR-013 §10:
la autoría original no concede exclusividad, el derecho a corregir es funcional
y contextual al ámbito, y **ninguna política del writer deriva de
`operation.created_by`**.

**Queda como detalle de implementación**, sin decisión asociada: un `sub`
malformado sale como `22P02` y no como `42501` (D2), así que el helper de
producción deberá validar el UUID explícitamente para fallar cerrado de forma
uniforme.
