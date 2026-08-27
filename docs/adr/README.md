# Architecture Decision Records

Registro de las decisiones arquitectónicas de Nomey y, sobre todo, de **por qué**
se tomaron con la información disponible entonces.

## Nomenclatura

```
docs/adr/ADR-NNN-titulo-en-kebab-case.md
```

Numeración correlativa que **nunca se reutiliza**, ni siquiera si un ADR se
abandona.

## Estados

| Estado                    | Significado                                     |
| ------------------------- | ----------------------------------------------- |
| `Propuesto`               | Redactado, pendiente de decisión humana         |
| `Aceptado`                | Vigente. **Inmutable.**                         |
| `Reemplazado por ADR-NNN` | Sustituido. Se conserva como registro histórico |

**En un ADR aceptado, el contenido y el razonamiento son inmutables.** No se
corrigen, no se matizan ni se actualizan: registran el razonamiento de un
momento concreto con la información de entonces, no el estado actual. Eso es
justamente lo que los hace útiles.

Lo único que sí se actualiza es la **metadata de estado**: la línea `Estado:`
puede pasar a `Reemplazado por ADR-NNN`, y puede añadirse el enlace al ADR que
lo sustituye. No es una excepción a la inmutabilidad — el razonamiento no se
toca — sino la forma de mantener navegable el registro. Si la decisión cambia,
se escribe un ADR nuevo; el antiguo se queda como estaba, solo marcado.

Un ADR en estado `Propuesto` sí se edita libremente: todavía no es un registro
de nada.

## Plantilla

```markdown
# ADR-NNN — Título

- **Estado:** Propuesto
- **Fecha:** AAAA-MM-DD

## Contexto

Qué problema existe y qué restricciones aplican.

## Decisión

Qué se decide, en presente y sin ambigüedad.

## Alternativas consideradas

Cada una con por qué se descartó. Obligatorio.

## Consecuencias

Lo bueno y lo malo. Qué se vuelve más fácil y qué más difícil.
```

Dos reglas de calidad:

- **Sin alternativas reales no hay ADR**, hay una preferencia documentada.
- **Las consecuencias incluyen las malas.** Si no hay contrapartidas, o la
  decisión es trivial o el análisis está incompleto.

Usa la skill `adr` (`.claude/skills/adr/`) para redactar uno.

## Numeración

Los números se asignan **cronológicamente al crear cada ADR**, tomando el
siguiente libre. **No se reservan números por adelantado.**

Reservarlos parece ordenado y no lo es: obliga a decidir hoy qué decisiones se
tomarán y en qué orden, deja huecos permanentes cuando alguna no llega a
escribirse, y convierte una lista de intenciones en algo que parece un registro
de decisiones. El registro solo contiene decisiones tomadas.

## Índice

| ADR                                                   | Título                                       | Estado    |
| ----------------------------------------------------- | -------------------------------------------- | --------- |
| [001](ADR-001-licensing.md)                           | Licencia y avisos de terceros                | Propuesto |
| [002](ADR-002-accounting-model.md)                    | Modelo contable                              | Aceptado  |
| [003](ADR-003-money-representation.md)                | Representación exacta del dinero             | Aceptado  |
| [004](ADR-004-currency-definition-identity.md)        | Identidad física de la definición monetaria  | Aceptado  |
| [005](ADR-005-schema-topology.md)                     | Topología de schemas y frontera Data API     | Aceptado  |
| [006](ADR-006-privilege-model.md)                     | Modelo de privilegios y lectura `api → core` | Aceptado  |
| [007](ADR-007-membership-rls.md)                      | Membresía y estrategia de RLS                | Aceptado  |
| [008](ADR-008-exact-data-boundary.md)                 | Frontera de datos exactos                    | Aceptado  |
| [009](ADR-009-authoritative-write-boundary.md)        | Frontera autoritativa de escritura           | Aceptado  |
| [010](ADR-010-client-operation-idempotency.md)        | Idempotencia de operaciones cliente          | Aceptado  |
| [011](ADR-011-operation-version-model.md)             | Operaciones, versiones y comandos cliente    | Aceptado  |
| [012](ADR-012-participant-identity.md)                | Identidad de participantes sin cuenta        | Aceptado  |
| [013](ADR-013-persisted-vs-derived.md)                | Persistido frente a derivado                 | Aceptado  |
| [014](ADR-014-data-api-schema-exposure.md)            | Exposición de schemas de la Data API         | Aceptado  |
| [015](ADR-015-frozen-rate-physical-representation.md) | Representación física del tipo congelado     | Aceptado  |
| [016](ADR-016-economic-attribution.md)                | Atribución económica de efectos a un usuario | Aceptado  |
| [017](ADR-017-secure-session-storage.md)              | Persistencia segura de la sesión             | Aceptado  |

> **ADR-003 cumplió su puerta de aceptación el 2026-08-19.** El experimento
> **E11** se ejecutó contra un stack Supabase local real: confirmó los supuestos
> de almacenamiento del ADR y demostró que su contingencia T8 es necesaria para
> hacer cumplir T7. La evidencia reproducible vive en
> [`supabase/e11/`](../../supabase/e11/README.md).

## Temas que previsiblemente necesitarán un ADR

Lista de **temas**, no de números: se numerarán al redactarse, en el orden en
que ocurra. Ninguno está reservado ni prejuzgado.

- **Participantes sin cuenta: invitación, reclamación y fusión** — la de mayor
  riesgo de seguridad. **La identidad y el vínculo** los cerró
  [ADR-012](ADR-012-participant-identity.md); siguen abiertos el **mecanismo de
  prueba**, la **revocación** y la **fusión**, todos delegados a F10.
- **Cola offline para la entrada rápida.** La idempotencia del **origen
  cliente** la cerró [ADR-010](ADR-010-client-operation-idempotency.md); siguen
  abiertas la cola en sí y la idempotencia de **recurrencias, importaciones
  bancarias y operaciones de backend**.
- React Native + Expo con CNG como plataforma.
- Supabase como backend y RLS como capa de autorización.
- ~~**Hardening del Data API**~~ — cerrado entre
  [ADR-005](ADR-005-schema-topology.md), que fijó el esquema expuesto,
  [ADR-006](ADR-006-privilege-model.md), que fijó los grants por rol y el
  mecanismo de lectura `api → core`, y
  [ADR-014](ADR-014-data-api-schema-exposure.md), que retiró `public` de la
  lista de schemas expuestos.
- ~~**Mecanismo de comprobación de membresía**~~ — cerrado por
  [ADR-007](ADR-007-membership-rls.md): helper `SECURITY DEFINER` reducido, sin
  claims de membresía en el JWT.
- Arquitectura por capas y reglas de import.
- Estrategia de código nativo iOS (CNG vs prebuild versionado).
- Estrategia de entornos (dev / staging / producción).
- Estrategia de i18n y localización.
