import { Pressable, StyleSheet, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { ControlMaterial, Icon, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import { INTERVALS, type IntervalKind } from './interval';

const LABEL: Readonly<
  Record<
    IntervalKind,
    'home.intervalDay' | 'home.intervalMonth' | 'home.intervalYear' | 'home.intervalAll'
  >
> = {
  day: 'home.intervalDay',
  month: 'home.intervalMonth',
  year: 'home.intervalYear',
  all: 'home.intervalAll',
};

export type IntervalSelectorProps = {
  readonly value: IntervalKind;
  readonly onChange: (next: IntervalKind) => void;
  /** Qué hacer al tocar el calendario. Hoy sólo explica que aún no está. */
  readonly onCalendar: () => void;
};

/**
 * El intervalo que gobierna la pantalla, y el calendario que todavía no existe.
 *
 * **El estado seleccionado no depende del color.** Lleva fondo, peso tipográfico
 * y `accessibilityState.selected`, porque `design-direction.md` §8 prohíbe que
 * un solo canal —y menos el color— comunique significado por su cuenta.
 *
 * **El botón de calendario es una affordance inerte, y se dice en voz alta.**
 * El calendario personalizado es Premium (F14/F15) y aquí no hay entitlement
 * que consultar: en vez de simular uno con un booleano en el cliente —que sería
 * exactamente el hardcode inseguro que no se quiere— el control existe,
 * anuncia que es Premium y no promete nada más. Cuando F14 traiga el
 * entitlement real, este sitio es donde se conecta.
 */
export function IntervalSelector({ value, onChange, onCalendar }: IntervalSelectorProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {/*
         * El material neutro de Android, **con el radio de la caja que lo
         * contiene**.
         *
         * Aquí decía `Radius.full`, y eso pintaba una píldora de radio 22
         * dentro de un host de radio 12: dos siluetas para un mismo contenedor.
         * El indicador del estado seleccionado —radio 8, separado 2 del canto—
         * cabe holgadamente dentro de la de 12 y NO dentro de la de 22, así que
         * en `Día` y en `Todo` sus esquinas salían por encima del rim. Medido:
         * a 17 px del borde superior el rim de la píldora caía en x≈79 y el
         * indicador llegaba a x=65 — trece píxeles fuera.
         *
         * El círculo del calendario sí es una píldora de verdad y conserva su
         * `Radius.full`; la diferencia está en la forma del host, no en el
         * material.
         */}
        <ControlMaterial radius={Radius.md} />
        {INTERVALS.map((kind) => {
          const selected = kind === value;
          return (
            <Pressable
              key={kind}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={t(LABEL[kind])}
              onPress={() => onChange(kind)}
              style={({ pressed }) => [
                styles.option,
                selected && { backgroundColor: theme.surfaceRaised },
                pressed && !selected && { backgroundColor: theme.surfaceSunken },
              ]}>
              <ThemedText
                variant={selected ? 'bodyStrong' : 'bodySmall'}
                themeColor={selected ? 'text' : 'textSecondary'}>
                {t(LABEL[kind])}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('home.calendarLabel')}
        accessibilityHint={t('home.calendarPremium')}
        onPress={onCalendar}
        // El dibujo baja a 40; el objetivo táctil sube a 48. Compactar lo
        // visible no puede compactar lo que se toca.
        hitSlop={Spacing.xs}
        style={({ pressed }) => [
          styles.calendar,
          { backgroundColor: theme.surface, borderColor: theme.border },
          pressed && { backgroundColor: theme.surfaceSunken },
        ]}>
        <ControlMaterial radius={Radius.full} />
        <Icon name={Symbols.calendar} size={20} colour={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

/**
 * El círculo del calendario mide 40, y su zona táctil 48.
 *
 * El `hitSlop` de abajo es lo que separa las dos cosas: el control se ve
 * compacto y se toca con holgura. Reducir el dibujo no puede reducir el
 * objetivo.
 */
const CALENDAR = 40;

const styles = StyleSheet.create({
  /*
   * `flex-start` y no `space-between`: la fila NO reparte el ancho.
   *
   * Antes el grupo llevaba `flex: 1` y cada opción otro, así que el selector se
   * estiraba hasta el borde y empujaba el calendario al extremo derecho,
   * dominando la pantalla por tamaño en vez de por importancia. Ahora los dos
   * miden lo que su contenido pide y el espacio sobrante se queda a la derecha,
   * visible y vacío, que es lo que dice que este control es secundario.
   */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: Spacing.sm,
  },
  group: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    padding: Spacing.xxs,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    /*
     * Protección final, con EXACTAMENTE el radio del contenedor.
     *
     * No es el arreglo —el arreglo es el radio del material, arriba—, y por eso
     * llega después: una máscara sobre una posición incorrecta recorta el
     * síntoma y deja el indicador descentrado. Con la geometría ya correcta,
     * esto sólo garantiza que nada futuro vuelva a asomar.
     */
    overflow: 'hidden',
  },
  /*
   * Ancho intrínseco, sin `flex`. `minHeight` de 40 mantiene la zona táctil de
   * cada opción por encima del mínimo cómodo aunque el texto sea corto — el
   * grupo entero mide 44 con su propio padding.
   */
  option: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
  },
  calendar: {
    width: CALENDAR,
    height: CALENDAR,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
