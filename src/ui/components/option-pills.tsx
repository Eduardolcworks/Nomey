import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing, useTheme } from '@/ui/theme';

import { ControlMaterial } from './control-material';
import { ThemedText } from './themed-text';

/**
 * DOS O MÁS OBLONGOS INDEPENDIENTES, y sólo uno elegido.
 *
 * **Cada opción es su propia cápsula**, con su superficie, su contorno y sus
 * extremos completamente redondeados. No hay caja exterior que las una: lo que
 * dice que forman un grupo es que comparten fila, anchura y separación, no un
 * marco alrededor.
 *
 * Sustituye al control segmentado que había —una sola caja de `Radius.md` con
 * las opciones dentro—. La diferencia no es decorativa: en aquella forma el
 * indicador de la opción elegida vivía **dentro** del contorno del grupo, y aquí
 * el contorno es de cada oblongo.
 *
 * **Materiales prestados, ninguno inventado.** `ControlMaterial` es el mismo
 * material neutro de los controles de Nomey, con el radio del propio oblongo —un
 * material con otro radio es otra forma—; el relleno, el borde y el estado
 * pulsado salen de los tokens del tema. Sin colores, sombras ni halos nuevos.
 *
 * **El estado elegido no depende del color.** Lleva relleno propio, peso
 * tipográfico, el acento contenido en el texto y `accessibilityState.selected`:
 * cuatro canales, porque `design-direction.md` §8 no admite que el color
 * comunique solo. El acento nunca es el relleno de la cápsula.
 *
 * **Vive en `ui/` porque es neutral**: recibe las etiquetas ya traducidas y
 * devuelve la clave elegida. No conoce el catálogo ni el dominio.
 */
export type OptionPill<K extends string> = {
  readonly key: K;
  /** Ya traducida. Este control no conoce el catálogo. */
  readonly label: string;
};

export type OptionPillsProps<K extends string> = {
  readonly options: readonly OptionPill<K>[];
  readonly value: K;
  readonly onChange: (next: K) => void;
};

export function OptionPills<K extends string>({ options, value, onChange }: OptionPillsProps<K>) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => {
              onChange(option.key);
            }}
            style={({ pressed }) => [
              styles.pill,
              {
                backgroundColor: selected ? theme.surfaceRaised : theme.surface,
                borderColor: theme.border,
              },
              pressed && !selected && { backgroundColor: theme.surfaceSunken },
            ]}>
            <ControlMaterial radius={Radius.full} />
            {/*
             * UNA LÍNEA, ENTERA Y SIN PARTIR PALABRAS.
             *
             * Medido a 411 dp con la letra del sistema al 150 %: recortada salía
             * «Moviment…», y una opción cuyo nombre no se lee deja de decir qué
             * elige; partida en dos líneas salía «Moviento / s», que es peor.
             * Encogerla un punto lo resuelve sin ninguna de las dos cosas, y el
             * suelo no baja del rol: al 150 % son 19,1 pt frente a los 15 base.
             */}
            <ThemedText
              variant={selected ? 'bodyStrong' : 'bodySmall'}
              themeColor={selected ? 'accent' : 'textSecondary'}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              style={styles.label}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * La fila que los sostiene, y **nada más**: no pinta fondo, ni borde, ni
   * radio. La separación es `sm`, el mismo hueco que el dock deja entre su
   * acción y sus destinos, para que dos cápsulas vecinas se lean como dos y no
   * como una partida.
   */
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  /**
   * `flex: 1` en cada oblongo: **los dos miden lo mismo**, midan lo que midan
   * sus palabras. Sin él, «Movimientos» sería casi el doble que «Saldos».
   *
   * El alto mínimo es el objetivo táctil, no el del texto: 44 es el mínimo de
   * Apple, y compactar el dibujo no puede compactar lo que se toca.
   */
  pill: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  /** Centrada, y encogida antes que recortada. */
  label: {
    textAlign: 'center',
  },
});
