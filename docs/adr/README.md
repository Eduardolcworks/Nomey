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

| ADR                                    | Título                           | Estado    |
| -------------------------------------- | -------------------------------- | --------- |
| [001](ADR-001-licensing.md)            | Licencia y avisos de terceros    | Propuesto |
| [002](ADR-002-accounting-model.md)     | Modelo contable                  | Aceptado  |
| [003](ADR-003-money-representation.md) | Representación exacta del dinero | Propuesto |

> **ADR-003 está en `Propuesto` con una puerta de aceptación explícita:** la
> verificación empírica de la frontera PostgreSQL → PostgREST → cliente, que
> `AGENTS.md` §1 exige y que no puede hacerse hasta conectar Supabase. No pasa a
> `Aceptado` antes de eso.

## Temas que previsiblemente necesitarán un ADR

Lista de **temas**, no de números: se numerarán al redactarse, en el orden en
que ocurra. Ninguno está reservado ni prejuzgado.

- **Participantes sin cuenta: invitación, reclamación y fusión** — la de mayor
  riesgo de seguridad.
- Idempotencia y cola offline para la entrada rápida.
- React Native + Expo con CNG como plataforma.
- Supabase como backend y RLS como capa de autorización.
- **Hardening del Data API**: esquema expuesto (`public` vs esquema dedicado) y
  política de grants por rol.
- **Mecanismo de comprobación de membresía**: `SECURITY DEFINER`, política
  reestructurada sin join, o claims en el JWT. Difieren en rendimiento,
  superficie de escalada y **frescura de permisos** (con claims, expulsar a
  alguien de un grupo no surte efecto hasta que su token se refresca).
- Arquitectura por capas y reglas de import.
- Estrategia de código nativo iOS (CNG vs prebuild versionado).
- Estrategia de entornos (dev / staging / producción).
- Estrategia de i18n y localización.
