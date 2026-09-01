import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { calendarDateOf, dateFromCalendar } from './movement-entry';
import { type CalendarDate } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { GlassSurface, ThemedText } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

/**
 * Los dos selectores del formulario. Los controles son los del sistema; lo que
 * los presenta no.
 *
 * **Por qué no se usa el `BottomSheet` de `@expo/ui`, que es la razón por la que
 * antes no pasaba nada al pulsar.** Esa hoja monta su PROPIO `Host` y envuelve a
 * sus hijos en un `Group` de SwiftUI, de modo que lo que se le pasa se renderiza
 * **dentro de SwiftUI**. Se le estaban dando vistas de React Native —un `View`,
 * un `Text` y otro `Host` anidado—, y una vista de React Native no puede existir
 * en una jerarquía de SwiftUI: la hoja se quedaba sin nada que presentar y **no
 * abría, sin lanzar ningún error**. Dos controles distintos fallaban por la
 * misma pieza, que es lo que delataba que la causa era compartida.
 *
 * Lo que presenta ahora es el `Modal` del núcleo de React Native: existe en
 * cualquier entorno, se anima solo desde abajo, y deja que el contenido sea
 * React Native — que es lo que permite que la hoja siga hablando el lenguaje
 * visual de Nomey en vez de ser cromo de plataforma suelto.
 *
 * **Y los controles siguen siendo nativos de verdad.** `Picker` y
 * `DateTimePicker` traen su propio `Host`, así que dentro de un árbol de React
 * Native funcionan tal cual: la rueda es la de SwiftUI y el calendario es el del
 * sistema. Lo que se sustituyó fue el envoltorio, no el control.
 */

/** El armazón común: velo que cierra al tocarlo y hoja de vidrio abajo. */
function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.canvas}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('action.close')}
          onPress={onClose}
          style={styles.veil}
        />

        <GlassSurface
          level="heavy"
          depth="selected"
          rim="soft"
          radius={Radius.xl}
          style={styles.sheet}>
          <View style={styles.head}>
            <ThemedText variant="label" themeColor="textSecondary" style={styles.headTitle}>
              {title}
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={Spacing.sm}>
              <ThemedText variant="label" style={{ color: theme.accent }}>
                {t('action.done')}
              </ThemedText>
            </Pressable>
          </View>
          {children}
        </GlassSurface>
      </View>
    </Modal>
  );
}

/**
 * El calendario del sistema.
 *
 * En Android se monta y se desmonta sin hoja: su presentación por defecto ya es
 * el diálogo del sistema, que se abre solo, y quien lo llama debe desmontarlo al
 * recibir el evento. En iOS es siempre en línea, así que necesita dónde vivir.
 */
export function DateSheet({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: CalendarDate;
  onSelect: (date: CalendarDate) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (!visible) return null;

  const picker = (
    <DateTimePicker
      value={dateFromCalendar(value)}
      mode="date"
      display={Platform.OS === 'ios' ? 'inline' : 'default'}
      accentColor={theme.accent}
      themeVariant="dark"
      style={styles.date}
      onValueChange={(_event, date) => {
        onSelect(calendarDateOf(date));
        if (Platform.OS !== 'ios') onClose();
      }}
      onDismiss={onClose}
    />
  );

  if (Platform.OS !== 'ios') return picker;

  return (
    <Sheet visible title={t('entry.dateTitle')} onClose={onClose}>
      {picker}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  veil: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  sheet: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xl,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  headTitle: {
    flexShrink: 1,
  },
  date: {
    minHeight: 360,
  },
});
