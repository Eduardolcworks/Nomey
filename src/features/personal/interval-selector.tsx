import { Pressable, StyleSheet, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { Icon, ThemedText } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

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
        style={({ pressed }) => [
          styles.calendar,
          { backgroundColor: theme.surface, borderColor: theme.border },
          pressed && { backgroundColor: theme.surfaceSunken },
        ]}>
        <Icon name="calendar" size={20} colour={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

const CALENDAR = 44;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  group: {
    flex: 1,
    flexDirection: 'row',
    padding: Spacing.xxs,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
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
