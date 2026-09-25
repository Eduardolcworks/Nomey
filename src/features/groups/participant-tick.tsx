import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

/**
 * EL TICK DE UNA FILA DE PARTICIPANTE.
 *
 * Extraído de `SplitParticipantsCard` cuando el modo Transferencia necesitó
 * exactamente el mismo control: **hay UN tick en el producto, no dos que se
 * parecen**. El cuadrado, el radio, el área táctil, el relleno de acento al
 * marcar y el `checkmark` son los mismos objetos, no una copia con los mismos
 * tokens.
 *
 * Lo que NO se comparte es la fila entera. La del gasto lleva partes, importe
 * fijado y cuota calculada, y depende del borrador de un gasto; la de una
 * transferencia lleva un nombre y lo que le tocaría. Compartir el contenedor
 * habría obligado a fabricar un borrador de gasto para pintar una lista de
 * destinatarios, que es justo el acoplamiento que esta extracción evita.
 *
 * **Deshabilitado no es mudo**: `accessibilityState.disabled` lo declara y
 * quien monta pasa la pista con el motivo, de modo que quien no ve la
 * pantalla recibe una razón y no un control que no responde.
 */
export function ParticipantTick({
  checked,
  disabled = false,
  label,
  hint,
  onPress,
}: {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly hint?: string;
  readonly onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={onPress}
      style={styles.tick}>
      <View
        style={[
          styles.box,
          {
            borderColor: checked ? theme.accent : theme.border,
            backgroundColor: checked ? theme.accent : 'transparent',
          },
        ]}>
        {checked ? <Icon name={Symbols.confirm} size={14} colour={theme.onAccent} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /** El área táctil, más grande que el cuadrado que se ve. */
  tick: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: -Spacing.sm,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
