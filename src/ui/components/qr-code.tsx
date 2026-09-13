import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * UN CÓDIGO QR DIBUJADO CON VISTAS, sin SVG ni módulo nativo.
 *
 * `toqr` —puro JS, ya en el árbol de dependencias de Expo— devuelve la matriz
 * de módulos; aquí se pinta **negro sobre blanco con zona de silencio de cuatro
 * módulos**, que es lo que la especificación pide y lo que cualquier lector
 * espera. No se tematiza: un QR en gris sobre cristal se lee peor y no aporta
 * nada; el contraste es la única estética que importa aquí.
 *
 * **Filas por tramos, no un View por módulo.** Una versión 4 son 33×33 = 1.089
 * módulos; pintar cada uno sería un View por celda. Cada fila se recorre y
 * los módulos oscuros consecutivos se funden en un solo tramo, que deja un QR
 * típico en un par de cientos de vistas.
 *
 * `size` es el lado total, zona de silencio incluida; el módulo se calcula
 * para que quepa entero y el resto se reparte como margen, así que los bordes
 * de los módulos caen en píxeles enteros y no se emborronan.
 */
import { runs } from './qr-matrix';

const QUIET = 4;

export function QrCode({
  value,
  size,
  label,
}: {
  readonly value: string;
  /** Lado total en puntos, zona de silencio incluida. */
  readonly size: number;
  /** Lo que un lector de pantalla anuncia: nunca el contenido codificado. */
  readonly label: string;
}) {
  const rows = useMemo(() => runs(value), [value]);
  const modules = rows.length + QUIET * 2;
  const cell = Math.floor(size / modules);
  const margin = (size - cell * modules) / 2 + QUIET * cell;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[styles.sheet, { width: size, height: size, padding: margin }]}>
      {rows.map((row, y) => (
        <View key={y} style={[styles.row, { height: cell }]}>
          {/* Sólo los tramos oscuros se pintan; los claros son el hueco anterior. */}
          {row
            .filter((run) => run.dark)
            .map((run, i) => (
              <View
                key={i}
                style={{
                  marginLeft: run.offset * cell,
                  width: run.length * cell,
                  height: cell,
                  backgroundColor: '#000000',
                }}
              />
            ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
  },
});
