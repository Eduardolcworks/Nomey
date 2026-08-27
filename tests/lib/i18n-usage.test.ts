import { describe, expect, it } from 'vitest';

import { esES } from '../../src/lib/i18n/messages/es-ES';

/**
 * Higiene de las cadenas de interfaz, sobre el código fuente.
 *
 * Dos direcciones, y las dos hacen falta:
 *
 * - **Ninguna clave sin usar.** Copy traducido a dos idiomas que nadie
 *   renderiza no lo revisa nadie: no aparece en una revisión visual, no
 *   envejece con la pantalla y da la falsa impresión de estar validado.
 * - **Ningún texto visible fuera del catálogo.** Es el criterio 3 del cierre de
 *   la Fase 4 en el roadmap, y el que se incumple sin querer en cuanto alguien
 *   escribe una etiqueta «provisional».
 *
 * Se lee el fuente, no se ejecuta: la comprobación debe valer para pantallas
 * que todavía no tienen forma de renderizarse en un test. `import.meta.glob`
 * lo resuelve Vite, así que leer el repositorio no obliga a añadir
 * `@types/node`.
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

/** Lo que se renderiza. `lib/` y `domain/` no pintan nada. */
const SCREENS = FILES.filter((file) => file.path.startsWith('app/') || file.path.startsWith('ui/'));

const SCREEN_PATHS = SCREENS.map((file) => file.path);

function screen(relative: string): string {
  return SCREENS.find((candidate) => candidate.path === relative)?.text ?? '';
}

describe('claves de traducción', () => {
  const keys = Object.keys(esES);
  const consumers = FILES.filter((file) => !file.path.startsWith('lib/i18n/'));

  it('encuentra el código fuente', () => {
    expect(FILES.length).toBeGreaterThan(10);
    expect(SCREENS.length).toBeGreaterThan(0);
  });

  it.each(keys)('«%s» se usa en algún sitio', (key) => {
    // Comillas simples en llamadas a `t()`, dobles en atributos JSX. Las dos
    // son usos reales; reconocer sólo una da por muerta una clave viva.
    const used = consumers.some(
      (file) => file.text.includes(`'${key}'`) || file.text.includes(`"${key}"`),
    );
    expect(used).toBe(true);
  });
});

describe('nada visible queda incrustado', () => {
  /**
   * Texto literal dentro de JSX: `>Algo<`.
   *
   * Se admiten la marca y una muestra tipográfica, que son literales a
   * propósito y están documentadas como tales en la propia pantalla.
   */
  const JSX_TEXT = />\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][^<>{}\n]{2,})\s*</g;
  const ALLOWED = new Set(['Nomey', 'Aa · body']);

  it.each(SCREEN_PATHS)('%s no lleva texto suelto en JSX', (relative) => {
    const found = [...screen(relative).matchAll(JSX_TEXT)]
      .map((match) => match[1].trim())
      .filter((text) => !ALLOWED.has(text));

    expect(found).toEqual([]);
  });

  it.each(SCREEN_PATHS)('%s no lleva un símbolo monetario', (relative) => {
    expect(screen(relative)).not.toMatch(/[€£¥]/);
    // `$` sólo cuenta como símbolo si acompaña a una cifra: en TypeScript
    // aparece en cada interpolación de template literal.
    expect(screen(relative)).not.toMatch(/\$\s?\d/);
  });

  it.each(SCREEN_PATHS)('%s no formatea una fecha a mano', (relative) => {
    // La vía correcta es `lib/format`, que localiza y no desplaza el día.
    expect(screen(relative)).not.toMatch(/DD?\/MM|MM\/DD/);
    expect(screen(relative)).not.toMatch(/toLocaleDateString\(\s*\)/);
  });
});
