import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { Radius, Spacing } from '@/ui/theme';

import { GlassSurface } from './glass-surface';
import { ThemedText } from './themed-text';

/**
 * UNA MAGNITUD SECUNDARIA DENTRO DE UNA TARJETA: su etiqueta y su cifra.
 *
 * Es el oblongo de `Deudas` de Inicio, extraído tal cual. **No es un control**:
 * `depth="flat"` porque el neumorfismo es para lo que responde al dedo, y esto
 * no responde a nada. Sin `Pressable`, sin rol de botón y sin sombreado táctil.
 *
 * **Por qué vive en `ui/` y no en una feature.** Lo necesitan dos dominios que
 * no pueden importarse entre sí —Inicio y Grupos—, y lo que comparten es
 * exactamente esto: el material, el borde, la profundidad, el radio y la
 * jerarquía «etiqueta encima, cifra debajo». Copiarlo habría sido tener dos
 * piezas que se separan al primer retoque, que es justo lo que esta capa existe
 * para impedir.
 *
 * **Y es neutral de verdad.** No sabe qué es una deuda, ni un saldo, ni una
 * moneda: recibe la etiqueta ya traducida y la cifra ya formateada. `ui/` no
 * puede importar `lib/`, así que ni traduce ni formatea, y esa restricción es la
 * que mantiene la pieza reutilizable en vez de convertirla en «el oblongo de
 * deudas» con otro nombre.
 */
export type AmountPlateProps = {
  /** Qué nombra la cifra. Ya traducido. */
  readonly label: string;
  /**
   * La cifra, ya compuesta por quien llama.
   *
   * Se recibe como nodo y no como texto porque el rol tipográfico y el color
   * son decisión de cada tarjeta: Inicio le da `amountRow`, y el tono lo elige
   * el signo del importe. Fijarlos aquí obligaría a esta pieza a conocer la
   * semántica de lo que muestra.
   */
  readonly children: ReactNode;
  /**
   * Cuánto ocupa. `regular` es el de Inicio; `compact` cabe dentro de una fila
   * de lista sin dominarla.
   */
  readonly size?: 'regular' | 'compact';
};

export function AmountPlate({ label, children, size = 'regular' }: AmountPlateProps) {
  return (
    <GlassSurface
      level="regular"
      depth="flat"
      radius={Radius.md}
      style={[styles.plate, size === 'compact' ? styles.compact : styles.regular]}>
      <ThemedText variant="caption" themeColor="textTertiary">
        {label}
      </ThemedText>
      {children}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  plate: {
    alignItems: 'flex-start',
    gap: Spacing.xxs,
  },
  /**
   * El relleno vertical del oblongo de Inicio, que es también lo que
   * `BalanceCard` compensa en su columna izquierda para que las dos etiquetas
   * se lean a la misma altura.
   */
  regular: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  compact: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
});
