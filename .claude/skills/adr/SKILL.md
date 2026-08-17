---
name: adr
description: Redactar un Architecture Decision Record de Nomey en docs/adr/. Úsalo cuando haya que registrar una decisión arquitectónica, cuando el usuario pida "crea un ADR", o cuando una tarea vaya a fijar algo estructural (modelo de datos, backend, estrategia de entornos, código nativo) que todavía no esté documentado.
---

# Redactar un ADR

Registra **decisiones tomadas y su porqué**, para que alguien que se incorpore
dentro de un año entienda el razonamiento sin tener el contexto de hoy.

La decisión a registrar llega como argumento. Si no se indica ninguna,
pregunta cuál antes de escribir nada.

## Pasos

1. Lee `docs/adr/README.md` para la convención vigente.
2. Lista `docs/adr/` y toma el **siguiente número libre**. Los números se
   asignan cronológicamente, **no se reservan por adelantado** y no se
   reutilizan nunca.
3. Comprueba si algún ADR aceptado ya cubre o contradice esta decisión. Si la
   contradice, el nuevo debe declarar explícitamente que reemplaza al anterior,
   y el anterior pasa a `Reemplazado por ADR-NNN`.
4. Crea `docs/adr/ADR-NNN-titulo-en-kebab-case.md` **en español**, con la
   estructura: Contexto → Decisión → Alternativas consideradas → Consecuencias.
5. Déjalo en estado **Propuesto**. No lo marques como Aceptado: eso lo decide
   una persona.

## Reglas de calidad

- **Las alternativas son obligatorias.** Un ADR sin alternativas reales no
  documenta una decisión, documenta una preferencia.
- **Las consecuencias incluyen las malas.** Si no hay ninguna contrapartida, o
  la decisión es trivial o el análisis está incompleto.
- Sé concreto: nada de "mejor rendimiento" sin decir en qué y a cambio de qué.
- Si la decisión aún no está tomada de verdad, dilo y no la disfraces de
  decisión. Un ADR prematuro es peor que ninguno.

## Prohibido

- Modificar un ADR **aceptado**: son inmutables. Se escribe uno nuevo que lo
  reemplace.
- Reservar números para ADR futuros.
