# ADR-014 — Exposición definitiva de schemas de la Data API

- **Estado:** Aceptado
- **Fecha:** 2026-08-25

## Contexto

[ADR-005](ADR-005-schema-topology.md) fijó la topología —`core` para la
persistencia, `api` como superficie expuesta, `sec` para helpers— y dejó
**expresamente abierto** un punto en su §4:

> **Si `public` permanece o no dentro de `api.schemas`** en la configuración de
> PostgREST.

[ADR-006](ADR-006-privilege-model.md) lo mantuvo fuera de su alcance por la
misma razón, y §6 cerró solo la mitad segura del asunto: **`core` y `sec` no
entran** ni en los schemas expuestos ni en el `extra_search_path`. Sobre
`public` no se pronunció.

El punto siguió abierto durante toda la Fase 3.C y era **el último** de la lista
de decisiones previas a las primeras migraciones.

**Por qué no es una cuestión cosmética.** Ninguna tabla de dominio de Nomey vive
en `public`, así que hoy ese schema no expone nada del producto. Pero **E12
midió** que las tablas nuevas de `public` **nacen con privilegios para los roles
cliente** por los default privileges de Supabase, incluido un `MAINTAIN` que
`information_schema` **no muestra**. La combinación que importa es la de dos
capas:

```
objeto creado en `public`  +  default privileges heredados  +  `public` expuesto
        =  ruta HTTP que nadie concedió explícitamente
```

Basta con retirar cualquiera de los tres factores. ADR-006 §7 ataca el segundo
mediante saneamiento explícito. Este ADR decide sobre el tercero.

El primer factor —que alguien cree un objeto en `public`— **no está prohibido**:
ADR-005 §4 dejó dicho que un objeto técnico futuro —una extensión, un artefacto
de herramienta o de migración— **puede** vivir ahí, y que este ADR no establece
una prohibición universal. Precisamente por eso el tercer factor merece una
decisión propia.

## Decisión

**`public` no forma parte de los schemas expuestos por la Data API de Nomey.**

La superficie queda así:

| Schema           | Expuesto por la Data API | Papel                                      |
| ---------------- | ------------------------ | ------------------------------------------ |
| `api`            | **Sí**                   | Superficie de Data API de Nomey            |
| `core`           | **No**                   | Persistencia interna (ADR-005, ADR-006 §6) |
| `sec`            | **No**                   | Helpers de seguridad (ADR-005, ADR-006 §6) |
| `public`         | **No**                   | **Lo que decide este ADR**                 |
| `graphql_public` | Sí, mientras haga falta  | Infraestructura de Supabase, no de Nomey   |

En la configuración:

```toml
schemas = ["api", "graphql_public"]
```

**`graphql_public` se conserva** porque pertenece a la infraestructura del stack
y no a la superficie de producto. Retirarlo sería una decisión distinta, no se
toma aquí, y nada de este ADR la prejuzga.

**`extra_search_path` no cambia.** Sigue siendo `["public", "extensions"]`, que
es lo que permite resolver las extensiones instaladas. Son **dos parámetros
distintos** y ADR-006 §6 ya insiste en que ninguno sustituye al otro: estar en
el `search_path` no expone un schema, y este ADR no toca esa segunda superficie
más allá de reiterar que `core` y `sec` no entran en ninguna de las dos.

### Alcance exacto

Este ADR **resuelve el punto heredado de ADR-005 §4 y nada más**. No decide:

- si `graphql_public` permanece a largo plazo;
- si algún objeto técnico futuro puede vivir en `public` — ADR-005 §4 sigue
  vigente: se juzga cuando exista;
- ningún grant, ninguna política, ninguna tabla, ninguna columna.

**No contradice ni reemplaza a ADR-005 ni a ADR-006**: rellena un hueco que
ambos dejaron señalado.

### Momento de aplicación, medido

> **La configuración no puede adoptarse antes de que exista el schema `api`.**

Comprobado contra el stack local el 2026-08-25: con
`schemas = ["api", "graphql_public"]` y sin schema `api` creado, PostgREST
registra

```
Failed to load the schema cache using db-schemas=api,graphql_public
  {"code":"3F000","message":"schema \"api\" does not exist"}
```

reintenta con retroceso exponencial y nunca sirve. `supabase start` **falla**:
el contenedor `supabase_rest_Nomey` queda en `503` y el CLI aborta el arranque
con `LegacyHealthCheckTimeoutError`.

Por tanto el cambio de `supabase/config.toml` se aplica **en la misma migración
—y en el mismo commit— que cree el schema `api`**, no antes. Hasta ese momento
la configuración versionada conserva su valor actual, y **`public` sigue
expuesto de facto** aunque esta decisión ya esté tomada.

Esa ventana es conocida y acotada: en ella no existe ninguna tabla de dominio,
ninguna migración y ningún objeto de Nomey en `public`.

## Alternativas consideradas

**A · Conservar `public` en la lista, el valor por defecto de Supabase.**
Es lo que hay hoy y no cuesta nada mantener. **Descartada** porque deja el
tercer factor en pie: cualquier objeto que aparezca en `public` —por una
herramienta, por un `supabase init` futuro, por un descuido en una migración—
adquiere ruta HTTP sin que nadie la conceda, y los default privileges medidos en
E12 le dan además los grants. La defensa quedaría reducida a una sola capa, el
saneamiento de ADR-006 §7, que hay que acordarse de aplicar objeto a objeto.

**B · Conservarlo expuesto y prohibir por norma crear objetos en `public`.**
Convierte una propiedad estructural en una regla que hay que recordar.
**Descartada** por el mismo criterio con el que ADR-006 §5 eligió
`security_invoker`: se prefiere el diseño donde el olvido produce un fallo
visible sobre el que produce datos accesibles con `200 OK`. Además
contradiría ADR-005 §4, que deliberadamente **no** prohibió el uso técnico de
`public`.

**C · Retirar también `graphql_public`.**
Reduciría más la superficie. **Descartada aquí por alcance**, no por mala: es
infraestructura del stack, su retirada tiene consecuencias propias que nadie ha
medido, y mezclarla convertiría este ADR en una decisión distinta de la que
ADR-005 dejó abierta. Puede plantearse por separado.

**D · Mover la superficie a `public` y renunciar a `api`.**
**Descartada** por ADR-005, que ya la evaluó y la rechazó como alternativa A de
aquel ADR. No se reabre.

## Consecuencias

### A favor

- **La superficie expuesta pasa a ser exactamente la que Nomey declara.** Un
  objeto en `public` deja de tener ruta HTTP por el hecho de existir, con
  independencia de qué grants herede.
- **La protección se vuelve estructural en lugar de procedimental.** No depende
  de recordar sanear cada objeto nuevo.
- **El test de exposición que exige ADR-006 §6 se amplía sin esfuerzo**: pasa de
  comprobar que `core` y `sec` no están, a comprobar la lista completa.
- **Coherencia con ADR-005 §4**, que permite objetos técnicos en `public`
  precisamente porque no tienen por qué ser alcanzables.

### En contra

- **Existe una ventana en la que la decisión está tomada y no aplicada**, entre
  este ADR y la primera migración que cree `api`. Es consecuencia medida del
  comportamiento de PostgREST, no una omisión.
- **Depurar con Studio es menos directo**, que ya era una contrapartida asumida
  en ADR-005: Studio mira `public` por defecto.
- **Cualquier objeto futuro que sí deba exponerse tendrá que vivir en `api`**, o
  bien reabrir esta decisión con un ADR sucesor. Es intencionado, pero es una
  restricción real.
- **Un `supabase init` o una plantilla futura que asuma el valor por defecto
  chocará con esta configuración**, y el síntoma —PostgREST sin arrancar— es
  ruidoso pero no obvio si no se conoce este ADR.
