---
description: Draft a new Architecture Decision Record in docs/adr/
argument-hint: [decisión a registrar]
---

Redacta un nuevo ADR para: **$ARGUMENTS**

Pasos:

1. Lee `docs/adr/README.md` para la convención vigente.
2. Lista `docs/adr/` y toma el **siguiente número libre**. Los números no se
   reutilizan nunca.
3. Comprueba si algún ADR aceptado ya cubre o contradice esta decisión. Si lo
   contradice, el nuevo ADR debe declarar explícitamente que reemplaza al
   anterior, y el anterior pasa a estado `Reemplazado por ADR-NNN`.
4. Crea `docs/adr/ADR-NNN-titulo-en-kebab-case.md` en español, con la
   plantilla: Contexto → Decisión → Alternativas consideradas → Consecuencias.
5. Déjalo en estado **Propuesto**. No lo marques como Aceptado: eso lo decide
   una persona.

Reglas de calidad:

- **Las alternativas son obligatorias.** Un ADR sin alternativas reales no
  documenta una decisión, documenta una preferencia.
- **Las consecuencias incluyen las malas.** Si no hay ninguna contrapartida, o
  la decisión es trivial o el análisis está incompleto.
- Escribe para alguien que se incorpore dentro de un año y no tenga el
  contexto de hoy.
- Sé concreto: nada de "mejor rendimiento" sin decir en qué y a cambio de qué.

No modifiques ADRs ya aceptados: son inmutables.
