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

**Un ADR aceptado no se edita.** Si la decisión cambia, se escribe uno nuevo que
reemplaza al anterior. Esa inmutabilidad es justamente lo que los hace útiles:
registran el razonamiento de un momento concreto, no el estado actual.

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

Usa el comando `/adr` para redactar uno.

## Índice

| ADR                         | Título                        | Estado    |
| --------------------------- | ----------------------------- | --------- |
| [009](ADR-009-licensing.md) | Licencia y avisos de terceros | Propuesto |

## Pendientes (Fase 1)

Se numeran al redactarse; el orden de la lista es el de prioridad, no el de
numeración final.

| Nº  | Decisión                                                     |
| --- | ------------------------------------------------------------ |
| 001 | React Native + Expo con CNG como plataforma                  |
| 002 | Supabase como backend y RLS como capa de autorización        |
| 003 | Arquitectura por capas y reglas de import                    |
| 004 | **Modelo de transacciones: caja / gasto real / deuda**       |
| 005 | Representación del dinero y escala por moneda                |
| 006 | Estrategia de código nativo iOS (CNG vs prebuild versionado) |
| 007 | Estrategia de entornos (dev / staging / producción)          |
| 008 | Idempotencia y cola offline para entrada rápida              |
| 010 | **Participantes sin cuenta: invitación y reclamación**       |
| 011 | Estrategia de i18n y localización                            |

El **004** es el más importante del proyecto. El **010** es el de mayor riesgo
de seguridad.
