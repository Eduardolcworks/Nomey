# E21 · La frontera de privilegio del provisioning del Modo Personal

> **Esto es evidencia, no norma.** Mide comportamiento real de PostgreSQL bajo
> el stack local. **No decide nada**: la decisión vive en
> [ADR-019](../../docs/adr/ADR-019-personal-provisioning.md).
>
> **NO ES UNA MIGRACIÓN.** Ningún fichero de este directorio debe convertirse en
> una, igual que `supabase/e11`–`e20`.

Medido el **2026-08-28**, antes de escribir las migraciones de la Fase 6.A.

## Las incertidumbres que existen para responder

El diseño de F6.A propone un **tercer rol**, `nomey_provisioner`, porque
`nomey_writer` tiene `WITH CHECK (false)` sobre `core.scope` —puede bloquear,
no puede escribir— y `postgres` como owner pondría una **escritura** por encima
de la RLS, que es justo lo contrario de lo que hace `nomey_writer`.

La pregunta de producto era: **¿puede la barrera acotarse al actor, o hay que
conformarse con `kind = 'personal'`?** De la respuesta depende si un fallo del
definer podría alcanzar el Modo Personal de otra persona.

Cinco preguntas operativas:

| #     | Pregunta                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | ¿`sec.request_actor_id()` funciona dentro de un `SECURITY DEFINER` cuyo owner es `NOLOGIN`, `NOBYPASSRLS` y no propietario de tablas? |
| **B** | ¿Y dentro de una **policy RLS** evaluada durante esa función?                                                                         |
| **C** | Con la policy acotada al actor, ¿se acepta la membresía propia y es imposible crear una ajena?                                        |
| **D** | ¿Se cambia la moneda del ámbito propio y vacío, es imposible tocar uno ajeno, y la FK detiene el cambio en cuanto hay un efecto?      |
| **E** | Sin policy de `SELECT` sobre `core.effect`, ¿la comprobación de «ámbito vacío» devuelve **cero filas sin error**?                     |

El motivo de A no es teórico: la migración del núcleo dejó escrito que
**`auth.uid()` no es invocable por `nomey_writer`** (E16), y el helper existe
precisamente por eso. Había que saber si el mismo obstáculo alcanza al nuevo rol.

## Cómo se ejecuta

```bash
docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
  -X -q -v ON_ERROR_STOP=1 < supabase/e21/privilege-boundary.sql
```

**Un solo fichero, dentro de una transacción que termina en `ROLLBACK`.** A
diferencia de E20, aquí no hacen falta ficheros numerados con teardown: ninguna
pregunta necesita que el estado sobreviva entre sesiones. El rol que crea se
llama `probe_provisioner` para que no pueda confundirse con el definitivo.

## Lo medido

```
 id |         outcome         |  detalle
----+-------------------------+--------------------------------------------------
 A1 | ERROR                   | 42501 permission denied for function request_actor_id
 A2 | DEVUELVE-EL-SUB         | 11111111-1111-4111-8111-111111111111
 B1 | RECHAZADA-FALLA-CERRADO | 42501 new row violates row-level security policy
 C1 | ACEPTADA                | propia en ambito propio
 C2 | RECHAZADA               | 42501
 C3 | RECHAZADA               | 42501
 D1 | CAMBIADA                | 1
 D2 | CERO-FILAS-SIN-ERROR    | 0
 D3 | RECHAZADA-POR-FK        | 23503 effect_moneda_del_ambito
 E1 | CERO-FILAS-SIN-ERROR    | reales=1 vistos=0
 E2 | VE-LOS-REALES           | reales=1 vistos=1
```

## Qué significa cada resultado

### A · El actor sí llega al definer, y lo que faltaba era un `GRANT`

**A1** falla con `42501 permission denied for function request_actor_id`, y
**A2** —idéntico salvo por el `GRANT EXECUTE`— devuelve el `sub` correcto.

Es un dato que aclara el pasado: lo que impedía a `nomey_writer` usar
`auth.uid()` **era privilegio, no semántica**. `current_setting('request.jwt.claims')`
es estado de sesión y no depende del rol; lo que depende del rol es poder
invocar la función que lo lee.

> **Consecuencia:** `nomey_provisioner` necesita `USAGE` sobre `sec` y
> `EXECUTE` sobre `sec.request_actor_id()`, exactamente como el writer.

### B · Una policy que consulta otra tabla protegida necesita ver esa tabla

**B1 es el hallazgo que no se esperaba.** La inserción **legítima** —la
membresía del actor en su propio ámbito— **fue rechazada** cuando el
provisioner aún no tenía policy de `SELECT` sobre `core.scope`.

El `WITH CHECK` de la policy de `core.membership` contiene un `EXISTS` sobre
`core.scope`. Esa subconsulta **está sujeta a la RLS del rol que la evalúa**, así
que sin policy no ve ninguna fila, el `EXISTS` es falso y la inserción se
rechaza.

**Falla cerrado**, que es la dirección segura, pero haría el provisioning
imposible con un mensaje que no nombra la causa. Con la policy de `SELECT`
puesta —**C1**— la misma inserción se acepta.

> **Consecuencia:** las dos policies del provisioner sobre `core.scope` y
> `core.membership` se diseñan **juntas**. Quitar la de lectura no «endurece»
> nada: rompe el provisioning.

### C · La barrera por actor es posible, y es estructural

Con `sec.request_actor_id()` dentro de la policy:

| Intento                                        | Resultado           |
| ---------------------------------------------- | ------------------- |
| Membresía **propia** en ámbito **propio**      | **Aceptada**        |
| Membresía de **otro usuario** en ámbito propio | **Rechazada 42501** |
| Membresía propia en el ámbito de **otro**      | **Rechazada 42501** |

> **Esta es la respuesta que se buscaba.** La barrera **no** se queda en
> `kind = 'personal'`: se acota al actor, y un fallo del definer **no puede**
> alcanzar el Modo Personal de otra persona. Lo impide la base de datos, no el
> código.

### D · Tres barreras, y solo una es la autoridad

- **D1** — ámbito propio y vacío: la moneda cambia, una fila.
- **D2** — ámbito **ajeno**: **cero filas y ningún error**. Un `UPDATE` cuya
  `USING` no casa no lanza nada; simplemente no toca nada.
- **D3** — ámbito propio **con un efecto**: `23503`, violación de
  `effect_moneda_del_ambito`.

> **Dos consecuencias distintas.** De D2: la función **debe comprobar
> `row_count`** y levantar su propio error, o un cambio que no ocurrió se
> reportaría como éxito. De D3: **la FK compuesta es la última autoridad** sobre
> la inmutabilidad de la moneda base. La comprobación de «ámbito vacío» en el
> cuerpo existe para **fallar bien** —código propio y 409—, no para hacer
> cumplir la regla; quien la relaje descubrirá que la base sigue negándose.

### E · El modo de fallo silencioso es real

Con `GRANT SELECT` sobre `core.effect` y **sin policy aplicable**, la
comprobación ve **0 de 1** efectos reales, **sin error**. Un `NOT EXISTS`
construido sobre esa lectura declararía **vacío** un ámbito ocupado y dejaría
pasar el cambio de moneda.

No es un caso hipotético: es la misma familia de fallo que la migración de la
deuda ya había documentado para el bloqueo de ámbito —con privilegio y sin
policy, `SELECT ... FOR UPDATE` devuelve cero filas sin errorar—.

> **Consecuencia:** la policy de `SELECT` del provisioner sobre `core.effect`
> es parte de la corrección, no una comodidad, y su ausencia tiene **regresión
> deliberada** en `supabase/checks/personal-provisioning.sql`.

## Lo que E21 **no** mide

- **Concurrencia.** Una sola sesión de `psql` no la tiene. Dos provisionings
  simultáneos se miden con sesiones de verdad en
  [`scripts/provisioning-concurrency.sh`](../../scripts/provisioning-concurrency.sh).
- **La ruta HTTP.** Que un JWT emitido por GoTrue resuelva a `authenticated` solo
  lo demuestra [`scripts/http-boundary-check.sh`](../../scripts/http-boundary-check.sh).
- **Nada sobre FX.** E21 no toca conversión, tipos de cambio ni
  `core.frozen_conversion`.
