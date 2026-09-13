/**
 * LA MATRIZ DE UN QR, EN TRAMOS. Hoja pura —sólo `toqr`, sin React Native—
 * para que la geometría se pueda comprobar sin renderizar nada. Quien la pinta
 * es `qr-code.tsx`.
 */
import { toQR } from 'toqr';

export type Run = {
  readonly dark: boolean;
  /** Módulos claros que preceden a este tramo desde el tramo oscuro anterior. */
  readonly offset: number;
  readonly length: number;
};

/**
 * Cada fila como tramos: los oscuros llevan cuántos módulos claros los
 * preceden, así que sólo ellos se pintan. Exportada para poder comprobar la
 * geometría sin renderizar nada.
 */
export function runs(value: string): readonly (readonly Run[])[] {
  const matrix = toQR(value);
  const side = Math.round(Math.sqrt(matrix.length));
  const result: Run[][] = [];
  for (let y = 0; y < side; y++) {
    const row: { dark: boolean; offset: number; length: number }[] = [];
    let gap = 0;
    for (let x = 0; x < side; x++) {
      const dark = matrix[y * side + x] === 1;
      const last = row[row.length - 1];
      if (dark) {
        if (last !== undefined && last.dark && gap === 0) last.length += 1;
        else {
          row.push({ dark: true, offset: gap, length: 1 });
          gap = 0;
        }
      } else {
        gap += 1;
      }
    }
    if (gap > 0) row.push({ dark: false, offset: 0, length: gap });
    result.push(row);
  }
  return result;
}
