---
name: adr
description: Redactar un Architecture Decision Record de Nomey en docs/adr/FNN/ (una carpeta por fase, numeración independiente por fase, identidad completa FNN/ADR-MMM). Úsalo cuando haya que registrar una decisión arquitectónica, cuando el usuario pida "crea un ADR", o cuando una tarea vaya a fijar algo estructural (modelo de datos, backend, estrategia de entornos, código nativo) que todavía no esté documentado.
---

# Redactar un ADR

Registra **decisiones tomadas y su porqué**, para que alguien que se incorpore
dentro de un año entienda el razonamiento sin tener el contexto de hoy.

La decisión a registrar llega como argumento. Si no se indica ninguna,
pregunta cuál antes de escribir nada.

## Pasos

1. Lee `docs/adr/README.md` para la convención vigente: **una carpeta por
   fase del roadmap (`F00` … `F19`) y numeración independiente por fase**. La
   identidad completa de una decisión es **fase y número** (`F09/ADR-007`),
   nunca «ADR-007» a secas.
2. Decide la **fase que origina la decisión** —no la que después la usa— y
   lee `docs/adr/FNN/README.md`, el índice de esa fase. Toma el **siguiente
   número libre allí**. No se reservan números, no se reutilizan nunca y no se
   renumera una decisión existente para insertar otra.
3. Comprueba si algún ADR aceptado —de esa fase o de otra— ya cubre o
   contradice esta decisión. Si la contradice, el nuevo debe declarar
   explícitamente que reemplaza al anterior (con su identidad completa), y el
   anterior pasa a `Reemplazado por FNN/ADR-MMM`. Un ADR de otra fase **se
   cita**; no se copia ni se redefine silenciosamente.
4. Crea `docs/adr/FNN/ADR-MMM-titulo-en-kebab-case.md` **en español**, con
   título `# FNN/ADR-MMM — Título` y la estructura: Contexto → Decisión →
   Alternativas consideradas → Consecuencias. Añade la fila al índice de la
   fase (`FNN/README.md`) y al índice general (`docs/adr/README.md`).
5. Déjalo en estado **Propuesto**. No lo marques como Aceptado: eso lo decide
   una persona.
6. Si trabajas en una rama y otra rama pudo crear el mismo identificador en la
   misma fase, **resuélvelo antes de integrar**: uno de los dos toma el
   siguiente número libre y actualiza sus referencias.

## Reglas de calidad

- **Las alternativas son obligatorias.** Un ADR sin alternativas reales no
  documenta una decisión, documenta una preferencia.
- **Las consecuencias incluyen las malas.** Si no hay ninguna contrapartida, o
  la decisión es trivial o el análisis está incompleto.
- Sé concreto: nada de "mejor rendimiento" sin decir en qué y a cambio de qué.
- Si la decisión aún no está tomada de verdad, dilo y no la disfraces de
  decisión. Un ADR prematuro es peor que ninguno.
- Referencia siempre otros ADR por su identidad completa (`F03/ADR-009`). Las
  menciones antiguas (`ADR-012`) en migraciones, checks SQL, sondas y vectores
  se conservan a propósito y se leen con la tabla de equivalencias de
  `docs/adr/README.md`.

## Prohibido

- Tocar el **contenido o el razonamiento** de un ADR aceptado: son inmutables.
  Se escribe uno nuevo que lo reemplace. Lo único actualizable en el antiguo es
  su metadata: la línea `Estado:` (para marcarlo como `Reemplazado por
FNN/ADR-MMM`) y las referencias cruzadas cuando cambia la convención.
- Reservar números para ADR futuros, o renumerar los existentes.
- Crear un ADR fuera de la carpeta de su fase, o con un identificador sin fase.
