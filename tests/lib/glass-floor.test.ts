import { describe, expect, it } from 'vitest';

import { Glass, MinGlassTintAlpha } from '../../src/ui/theme/elevation';

/**
 * El suelo de opacidad del glass, comprobado en vez de declarado.
 *
 * `MinGlassTintAlpha` es una medición, no una preferencia: un tinte fino midió
 * 1,6:1 para texto blanco contra un fondo amarillo, y una superficie flotante
 * puede acabar sobre cualquier cosa. Estaba escrito en un comentario y en el
 * README, que es exactamente donde una regla deja de cumplirse sin que nadie
 * se entere.
 *
 * Añadir un nivel de glass nuevo por debajo del suelo falla aquí, en CI, y no
 * en un dispositivo con la luz de frente.
 */

const ALPHA = /rgba\([^)]*,\s*([\d.]+)\s*\)/;

describe('opacidad de los tintes de glass', () => {
  const levels = Object.entries(Glass);

  it('hay niveles que comprobar', () => {
    expect(levels.length).toBeGreaterThan(0);
  });

  it.each(levels)('«%s» declara su tinte como rgba con alpha', (_level, token) => {
    expect(token.tint).toMatch(ALPHA);
  });

  it.each(levels)('«%s» no baja del suelo medido', (level, token) => {
    const alpha = Number(ALPHA.exec(token.tint)?.[1]);
    expect(alpha, `${level} tiene alpha ${String(alpha)}`).toBeGreaterThanOrEqual(
      MinGlassTintAlpha,
    );
  });
});
