import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing, useTheme } from '@/ui/theme';

import { GlassSurface } from './glass-surface';
import { ThemedText } from './themed-text';

/**
 * EL CALENDARIO DEL SISTEMA, con la presentación de Nomey alrededor.
 *
 * **Por qué no se usa el `BottomSheet` de `@expo/ui`, que es la razón por la que
 * antes no pasaba nada al pulsar.** Esa hoja monta su PROPIO `Host` y envuelve a
 * sus hijos en un `Group` de SwiftUI, de modo que lo que se le pasa se renderiza
 * **dentro de SwiftUI**. Se le estaban dando vistas de React Native, y una vista
 * de React Native no puede existir en una jerarquía de SwiftUI: la hoja se
 * quedaba sin nada que presentar y **no abría, sin lanzar ningún error**.
 *
 * Lo que presenta ahora es el `Modal` del núcleo de React Native: existe en
 * cualquier entorno, se anima solo desde abajo, y deja que el contenido sea
 * React Native — que es lo que permite que la hoja siga hablando el lenguaje
 * visual de Nomey en vez de ser cromo de plataforma suelto.
 *
 * **Y el control sigue siendo nativo de verdad.** `DateTimePicker` trae su
 * propio `Host`, así que dentro de un árbol de React Native funciona tal cual: el
 * calendario es el del sistema. Lo que se sustituyó fue el envoltorio.
 *
 * En Android se monta y se desmonta sin hoja: su presentación por defecto ya es
 * el diálogo del sistema, que se abre solo, y quien lo llama debe desmontarlo al
 * recibir el evento. En iOS es siempre en línea, así que necesita dónde vivir.
 *
 * ═══════════ POR QUÉ VIVE AQUÍ, Y EN `Date` ═══════════
 *
 * Lo comparten el alta de un movimiento personal y el alta de un gasto
 * compartido, y una feature no puede leer de otra. Para poder vivir en `ui/` no
 * puede depender de `lib/`: por eso habla en `Date` —el tipo del control nativo—
 * y no en `CalendarDate`, y por eso sus tres textos llegan ya traducidos. Quien
 * lo monta convierte, que es quien sabe en qué calendario está.
 */
export function DateSheet({
  visible,
  value,
  onSelect,
  onClose,
  title,
  doneLabel,
  closeLabel,
  mode = 'date',
}: {
  readonly visible: boolean;
  readonly value: Date;
  readonly onSelect: (date: Date) => void;
  readonly onClose: () => void;
  /** Ya traducidos: este control no conoce el catálogo. */
  readonly title: string;
  readonly doneLabel: string;
  readonly closeLabel: string;
  /**
   * Fecha o hora: el MISMO selector del sistema, con la misma presentación.
   * `datetime` no entra: no existe en Android, y dos hojas encadenadas dicen lo
   * mismo en las dos plataformas.
   */
  readonly mode?: 'date' | 'time';
}) {
  const theme = useTheme();

  if (!visible) return null;

  const picker = (
    <DateTimePicker
      value={value}
      mode={mode}
      display={Platform.OS === 'ios' ? 'inline' : 'default'}
      accentColor={theme.accent}
      themeVariant="dark"
      style={styles.date}
      onValueChange={(_event, date) => {
        onSelect(date);
        if (Platform.OS !== 'ios') onClose();
      }}
      onDismiss={onClose}
    />
  );

  if (Platform.OS !== 'ios') return picker;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.canvas}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
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
                {doneLabel}
              </ThemedText>
            </Pressable>
          </View>
          {picker}
        </GlassSurface>
      </View>
    </Modal>
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
