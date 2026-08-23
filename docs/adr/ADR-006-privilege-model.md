# ADR-006 — Modelo de privilegios y frontera de lectura `api` → `core`

- **Estado:** Aceptado
- **Fecha:** 2026-08-24

## Contexto

[ADR-005](ADR-005-schema-topology.md) fijó la topología —`core` para la
persistencia, `api` como única superficie expuesta, `sec` para los helpers— y
**dejó expresamente abierto** en su §4 qué privilegios recibe cada rol sobre
`core`, si las lecturas usan `security_invoker`, y por qué mecanismo `api` lee
`core`. Este ADR cierra esa parte.

Tres cosas gobiernan la decisión y no se reabren aquí:

- **[ADR-002](ADR-002-accounting-model.md) §7** — los roles cliente no tienen
  permisos de escritura sobre operaciones ni efectos.
- **`AGENTS.md` §4** — la autorización en base de datos es un conjunto de capas
  complementarias: schema expuesto, grants, RLS, privilegios de función y
  separación de claves.
- **`AGENTS.md` §7** — la clave secreta no vive en el bundle del cliente.

**El punto de partida no es cero, y eso cambia el problema.** El experimento
**E12** midió que una tabla creada en `public` nace con `TRUNCATE`,
`REFERENCES`, `TRIGGER` y `MAINTAIN` para `anon` y `authenticated` sin que nadie
los conceda; que son **ejecutables** y no cosméticos; que `MAINTAIN` es
invisible para `information_schema`; y que **PostgreSQL concede `EXECUTE` a
`PUBLIC` sobre toda función nueva**, de modo que una función sin grants es
invocable por `anon`. También midió que un `REVOKE` de default privileges
**por schema** no retira ese `EXECUTE`, y que **la forma global sí**. Evidencia
en [`supabase/e12/`](../../supabase/e12/README.md).

El experimento **E13** midió el mecanismo de lectura contra un modelo mínimo con
dos usuarios reales. Evidencia en [`supabase/e13/`](../../supabase/e13/README.md).

## Decisión

**Privilegio mínimo explícito, más saneamiento de los defaults peligrosos.**

### 1. `anon`

**Cero privilegios sobre objetos de Nomey.** Nomey no tiene hoy superficie
anónima de producto. Si alguna fase futura la necesita, se concede **entonces**
y se justifica **entonces**.

### 2. `service_role`

**Cero privilegios explícitos de Nomey** hasta que exista un componente backend
concreto que realmente los necesite. No se concede acceso preventivamente:
`service_role` tiene `rolbypassrls = t` **[medido, E12]**, así que cada `GRANT`
que reciba es acceso total a esas filas.

### 3. `authenticated`

Para el camino de lectura que fija §5:

- `USAGE` sobre `api`;
- `SELECT` **exclusivamente** sobre las vistas de `api` necesarias;
- `EXECUTE` **exclusivamente** sobre las funciones de `api` permitidas;
- `SELECT` **exclusivamente** sobre las tablas concretas de `core` que necesiten
  esas vistas.

**No se concede** `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`,
`TRIGGER` ni `MAINTAIN` sobre ninguna tabla de `core`.

> **`USAGE` sobre `core` no es necesario** para este camino **[medido, E13]**.
>
> **Es un resultado del mecanismo concreto medido** —vistas predefinidas con
> `security_invoker` sobre tablas conocidas—, **no una regla universal.**
> Cualquier acceso futuro a `core` por otra vía debe medir sus propios
> requisitos en lugar de heredar esta afirmación.

### 4. `PUBLIC` y el `EXECUTE` de funciones

**Defensa en profundidad, con los dos mecanismos a la vez:**

1. Un default privilege **global** que retire `EXECUTE` de `PUBLIC` para las
   funciones futuras creadas por el rol con el que corren las migraciones.
2. Un `REVOKE EXECUTE ... FROM PUBLIC` **explícito en la misma migración que
   crea cada función sensible**.

**No se depende exclusivamente de ninguno de los dos.** El primero protege lo
que se olvide; el segundo protege si el primero se pierde en una actualización
del stack. E12 midió que la forma **por schema** de ese default **no sirve** y
que la **global** sí.

### 5. Cómo lee `api` desde `core`

**Las lecturas del cliente atraviesan vistas de `api` declaradas
`security_invoker`, y la RLS de `core` es la autoridad por fila.**

Medido en E13 sobre el mismo modelo:

| Superficie                              | Usuario A (miembro) | Usuario B (no miembro) | Sin sesión  |
| --------------------------------------- | ------------------- | ---------------------- | ----------- |
| Vista `security_invoker`                | 1 fila              | **0**                  | **0**       |
| Vista ejecutada como su **propietario** | 2 filas             | **2 filas**            | **2 filas** |

La tabla contenía 2 filas. **La vista del propietario no aplica la RLS en
absoluto**, ni siquiera sin JWT. Por eso no es el camino normal de lectura.

El criterio que decide no es el rendimiento: es **dónde puede olvidarse una
comprobación de autorización**. Con `security_invoker` la autorización vive en
un sitio por tabla —su política— y un olvido produce cero filas o `42501`. Con
una superficie privilegiada vive en **cada objeto**, y un olvido produce **datos
ajenos con `200 OK`**.

### 6. Invariante de exposición

> **`core` y `sec` no forman parte de ninguna superficie cliente.**

En particular **no deben entrar** en:

- los schemas expuestos por PostgREST (`api.schemas` de `config.toml`);
- el `extra_search_path` que usan la Data API y GraphQL.

**Son dos parámetros distintos, y ninguno sustituye al otro.** E13 midió que los
privilegios SQL mínimos **no abren por sí solos una ruta HTTP** —PostgREST
responde `406 PGRST106` o `404 PGRST205`—, pero también que **introducir el
schema de persistencia en el `search_path` de GraphQL sí refleja sus objetos** y
devuelve datos. La RLS siguió filtrando en ese caso, pero la superficie existía.

**`api` es la superficie propia de Nomey.**

Esta configuración **deberá quedar respaldada por un test automatizado que falle
si `core` o `sec` aparecen en cualquiera de esas dos superficies.** El test es
parte de los criterios de cierre de la fase; su forma concreta no se fija aquí.

### 7. Defaults heredados de `public`

Se sanea la configuración heredada que E12 midió, para tablas y secuencias de
`public`, aunque Nomey no coloque objetos allí. El saneamiento debe ser
**explícito, reproducible y verificable por consulta al catálogo**.

El motivo es de futuro, no de presente: protege contra que alguien cree meses
después una tabla en `public` y nazca con privilegios para los roles cliente.

## Alternativas consideradas

**A · Conceder en bloque, siguiendo el snippet habitual para schemas propios**
(`GRANT ALL ON ALL TABLES ... TO anon, authenticated, service_role`).

Es una línea y nada se olvida. **Descartada**: concede los ocho privilegios,
incluidos los cuatro que la RLS **no cubre**, y E12 midió que `anon` puede
truncar con ellos una tabla con RLS activada. Contradice `AGENTS.md` §4 y la
propia guía de endurecimiento de Supabase.

**B · Grants mínimos por objeto, sin sanear los defaults heredados.**

Es la decisión adoptada menos su §7. **Descartada** porque deja en pie el modo
de fallo más probable —una tabla creada en `public` fuera del camino previsto—
por ahorrarse dos sentencias que se escriben una sola vez.

**C · Lecturas por superficies ejecutadas con privilegios del propietario**,
aplicando la autorización dentro de cada vista o función.

Tiene una ventaja real: el rol cliente no necesita **ningún** privilegio sobre
`core`, y la superficie de grants queda mínima. **Descartada** por el resultado
de E13: con ese camino, un usuario que no era miembro y una sesión **sin JWT**
recibieron todas las filas. La autorización pasa a depender de que **cada**
objeto la implemente, y el fallo por omisión es **silencioso y abierto**. Se
prefiere un modelo donde olvidar autorizar produzca un error o un conjunto
vacío.

**D · Roles intermediarios** que interpongan una identidad distinta entre el
cliente y `core`.

**Descartada por desproporción**: añade una capa de identidades que mantener y
auditar sin resolver nada que `security_invoker` no resuelva ya, y reintroduce
la pregunta de qué privilegios tiene ese rol intermedio.

## Consecuencias

### A favor

- **Cada privilegio del sistema es rastreable a una línea de una migración**, y
  el criterio de cierre correspondiente pasa a ser demostrable por consulta al
  catálogo en vez de por revisión visual.
- **Olvidar autorizar falla cerrado**: cero filas o `42501`, nunca datos ajenos
  con `200`.
- **Ningún objeto nuevo queda expuesto por inercia**, ni por los defaults de
  `public` ni por el `EXECUTE` a `PUBLIC`.
- La superficie expuesta es **enumerable y auditable**.

### En contra

- **Verboso.** Cada vista y cada función añaden varias líneas de grants, y una
  tabla nueva no aparece sola en la superficie.
- **El rol cliente necesita `SELECT` sobre tablas de `core`.** Es más privilegio
  del que tendría con el camino del propietario, y se acepta a cambio de que la
  RLS siga siendo la autoridad. La contrapartida es real y queda escrita.
- **La garantía de no exposición depende de dos parámetros de configuración**
  —schemas expuestos y `extra_search_path`— que un cambio descuidado puede
  abrir. De ahí que §6 exija un test, y no confianza.
- **Un olvido de grants no falla ruidosamente en las lecturas**: da menos acceso
  del previsto, que es inocuo pero desconcertante al depurar.

## Fuera de alcance

No quedan resueltos ni prejuzgados por este ADR:

- **Qué columnas proyecta cada vista y dónde ocurre exactamente el cast a
  texto** que exige [ADR-003](ADR-003-money-representation.md) §6. Es **D6**, y
  deberá construirse **respetando** la semántica de ejecución que fija §5, no
  sustituyéndola en silencio.
- **La forma definitiva de las vistas de lectura** y de las funciones
  autoritativas de escritura (**D7**).
- **Si `public` permanece o no dentro de `api.schemas`**, que sigue siendo
  separable y sin decidir.
- **El mecanismo de comprobación de membresía**, que fija
  [ADR-007](ADR-007-membership-rls.md).
