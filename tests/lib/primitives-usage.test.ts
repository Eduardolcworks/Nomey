import { describe, expect, it } from 'vitest';

/**
 * Ninguna primitive sin consumidor.
 *
 * Un componente de design system que nadie usa no es una solución compartida:
 * es una suposición sobre el futuro, y envejece sin que nadie la revise. Es
 * además el modo de fallo típico de un bloque como F4.D, donde la tentación es
 * generalizar por adelantado.
 *
 * El criterio es el del handoff —una primitive entra sólo si algo la consume—
 * y «algo» incluye a otra primitive: `ActionButton` existe porque lo comparten
 * los estados vacío y de error, y eso es deduplicación real aunque el
 * consumidor viva en la misma carpeta. Lo único que no cuenta es su propio
 * archivo.
 */

const SOURCES = import.meta.glob('../../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const FILES = Object.entries(SOURCES).map(([file, text]) => ({
  path: file.replace('../../src/', ''),
  text,
}));

const BARREL = FILES.find((file) => file.path === 'ui/components/index.ts');

/**
 * Cada nombre exportado por el barrel, con el archivo que lo define.
 *
 * Los tipos se descartan: un tipo sin consumidor no es un componente muerto,
 * es parte de la firma de uno vivo.
 */
const EXPORTS = [...(BARREL?.text.matchAll(/export \{([^}]+)\} from '\.\/([\w-]+)'/g) ?? [])]
  .flatMap(([, names, file]) =>
    names
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && !entry.startsWith('type '))
      .map((name) => ({ name, defined: `ui/components/${file}.tsx` })),
  )
  .map(({ name, defined }) => [name, defined] as const);

/**
 * `Icon` es subcadena de `IconButton` y de `IconProps`, así que buscar por
 * inclusión daría por consumida cualquier primitive cuyo nombre sea prefijo de
 * otra. El límite de palabra se construye desde una cadena normal a propósito:
 * en un template literal, `\b` es el carácter de retroceso y no casa nada.
 */
function wordBoundary(name: string): RegExp {
  return new RegExp('\\b' + name + '\\b');
}

describe('primitives de ui/components', () => {
  it('encuentra el barrel y lo que exporta', () => {
    expect(BARREL).toBeDefined();
    expect(EXPORTS.length).toBeGreaterThan(5);
  });

  it.each(EXPORTS)('«%s» tiene al menos un consumidor', (name, defined) => {
    const consumers = FILES.filter(
      (file) => file.path !== defined && wordBoundary(name).test(file.text),
    );

    expect(consumers.map((file) => file.path)).not.toEqual([]);
  });
});
