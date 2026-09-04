import { describe, expect, it } from 'vitest';

import ROADMAP from '../../docs/product/roadmap.md?raw';

/**
 * Ningún documento cita un sub-bloque que el roadmap no defina.
 *
 * **El fallo que impide.** Los runbooks empezaron a citar `F8.A4` y `F8.A5`
 * como destino de trabajo aplazado antes de que el roadmap —el documento que
 * manda sobre secuencia y criterios— dijera qué eran. Una referencia huérfana
 * no rompe nada el día que se escribe; rompe el día que alguien va a ejecutar
 * ese bloque y no hay contrato que leer.
 *
 * **Qué cuenta como definición, y por qué así.** Un sub-bloque está definido
 * cuando el roadmap lo presenta de una de las dos formas canónicas que ya usa:
 * como **fila de tabla** —`| **F8.A4** | …`— o como **párrafo de definición**
 * —`**F8.A4 — …**`—. Cualquier otra aparición es una mención de paso, y una
 * mención no define nada.
 *
 * Esa regla es deliberadamente estructural. Comprobar frases concretas
 * congelaría la redacción del roadmap y convertiría cualquier reescritura en un
 * test roto, que es la forma más rápida de que alguien deje de tomárselo en
 * serio. Aquí se puede reordenar, renombrar columnas o reescribir la prosa
 * entera: lo único que no se puede es citar un bloque que no se define.
 */

const DOCS = Object.entries(
  import.meta.glob('../../docs/**/*.md', { query: '?raw', import: 'default', eager: true }),
).map(([path, text]) => ({ path: path.replace('../../', ''), text: text as string }));

/** `F8.A4`, `F3.C`, `F7.E`… la forma que usa toda la documentación de Nomey. */
const SUB_BLOCK = /\bF\d+\.[A-Z]\d?\b/g;

/** Fila de tabla cuya primera celda es el bloque, o párrafo que lo define. */
function isDefinedInRoadmap(block: string): boolean {
  const escaped = block.replace('.', '\\.');
  const asTableRow = new RegExp(`^\\|\\s*\\*\\*${escaped}\\*\\*\\s*\\|`, 'm');
  const asDefinition = new RegExp(`\\*\\*${escaped}\\s+[—-]`, 'm');
  return asTableRow.test(ROADMAP) || asDefinition.test(ROADMAP);
}

/** Todo sub-bloque citado en la documentación, venga de donde venga. */
function citedAcrossDocs(prefix: string): string[] {
  const cited = new Set<string>();
  for (const doc of DOCS) {
    for (const match of doc.text.matchAll(SUB_BLOCK)) {
      if (match[0].startsWith(prefix)) cited.add(match[0]);
    }
  }
  return [...cited].sort();
}

describe('los sub-bloques citados existen', () => {
  it('revisa de verdad lo que dice revisar', () => {
    // Un glob que deja de resolver, o una regla de definición que no reconoce
    // nada, dejarían pasar todo sin mirar.
    expect(DOCS.length).toBeGreaterThan(10);
    expect(DOCS.map((doc) => doc.path)).toContain('docs/product/roadmap.md');
    expect(citedAcrossDocs('F8.').length).toBeGreaterThan(3);
  });

  it('el roadmap define cada sub-bloque de la Fase 8 que la documentación cita', () => {
    const orphans = citedAcrossDocs('F8.').filter((block) => !isDefinedInRoadmap(block));

    expect(orphans, 'citados en docs/ pero sin definición canónica en el roadmap').toEqual([]);
  });

  it('la división de la Fase 8 llega hasta donde se cita, sin huecos', () => {
    // No fija cuántos hay: exige que la serie citada sea continua desde A0. Un
    // salto significa que alguien nombró un bloque que nadie escribió.
    const numbered = citedAcrossDocs('F8.A')
      .filter((block) => /^F8\.A\d$/.test(block))
      .map((block) => Number(block.slice(-1)))
      .sort((a, b) => a - b);

    expect(numbered.length).toBeGreaterThan(0);
    expect(numbered).toEqual(Array.from({ length: numbered.length }, (_, index) => index));
  });
});
