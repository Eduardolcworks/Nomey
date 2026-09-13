import { describe, expect, it } from 'vitest';

import { invitationLink, readInvitation } from '../../src/features/groups/invitation-link';
import { runs } from '../../src/ui/components/qr-matrix';

/**
 * EL QR SE PINTA A PARTIR DE LA MATRIZ DE `toqr`, sin SVG. Aquí se comprueba
 * la geometría de lo que se pinta —cuadrado, filas completas, patrones de
 * localización— y que lo codificado es EXACTAMENTE el enlace que «Pegar
 * enlace» y el escáner leen.
 */
const TOKEN = 'Ab3-_9Xy'.repeat(6).slice(0, 43);

describe('la matriz que se pinta', () => {
  const link = invitationLink('nomey-dev', TOKEN);
  const rows = runs(link);

  it('es cuadrada y cada fila suma el lado entero', () => {
    const side = rows.length;
    expect(side).toBeGreaterThanOrEqual(21);
    expect(side % 4).toBe(1);
    for (const row of rows) {
      const total = row.reduce((sum, run) => sum + run.offset + run.length, 0);
      expect(total).toBe(side);
    }
  });

  it('empieza por el patrón de localización: siete módulos oscuros seguidos', () => {
    const first = rows[0]?.[0];
    expect(first).toEqual({ dark: true, offset: 0, length: 7 });
    // Y la primera fila acaba con otro patrón de siete a la derecha.
    const last = rows[0]?.filter((run) => run.dark).at(-1);
    expect(last?.length).toBe(7);
  });

  it('sólo se pintan tramos oscuros; los claros son el hueco anterior', () => {
    for (const row of rows) {
      for (const run of row) {
        if (run.dark) expect(run.length).toBeGreaterThan(0);
        else expect(run.offset).toBe(0);
      }
    }
  });
});

describe('lo codificado es el enlace vigente', () => {
  it('el enlace del QR es el que «Pegar enlace» acepta, con el mismo token', () => {
    const link = invitationLink('nomey-dev', TOKEN);
    expect(readInvitation(link)).toBe(TOKEN);
    // Un token distinto da una matriz distinta: no hay QR «de adorno».
    const other = invitationLink('nomey-dev', 'Zz'.repeat(22).slice(0, 43));
    expect(JSON.stringify(runs(other))).not.toBe(JSON.stringify(runs(link)));
  });
});
