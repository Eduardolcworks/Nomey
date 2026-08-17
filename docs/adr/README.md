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

Usa la skill `adr` (`.claude/skills/adr/`) para redactar uno.

## Numeración

Los números se asignan **cronológicamente al crear cada ADR**, tomando el
siguiente libre. **No se reservan números por adelantado.**

Reservarlos parece ordenado y no lo es: obliga a decidir hoy qué decisiones se
tomarán y en qué orden, deja huecos permanentes cuando alguna no llega a
escribirse, y convierte una lista de intenciones en algo que parece un registro
de decisiones. El registro solo contiene decisiones tomadas.

## Índice

| ADR                         | Título                        | Estado    |
| --------------------------- | ----------------------------- | --------- |
| [001](ADR-001-licensing.md) | Licencia y avisos de terceros | Propuesto |

## Temas que previsiblemente necesitarán un ADR

Lista de **temas**, no de números: se numerarán al redactarse, en el orden en
que ocurra. Ninguno está reservado ni prejuzgado.

- **Modelo de datos: caja / gasto económico / deuda / liquidación** — la
  decisión más cara de revertir del proyecto.
- **Participantes sin cuenta: invitación, reclamación y fusión** — la de mayor
  riesgo de seguridad.
- **Representación del dinero** y escala por moneda: unidad mínima entera,
  `numeric`, librería decimal u otra representación exacta, con verificación de
  cómo sobrevive cada tipo al transporte hasta el cliente.
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
