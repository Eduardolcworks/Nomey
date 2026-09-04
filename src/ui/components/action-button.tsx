import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { ControlMaterial } from './control-material';
import { DepthLayer } from './depth-layer';
import { ThemedText } from './themed-text';
import {
  controlEdge,
  emphasisDepth,
  Radius,
  Spacing,
  surfaceDepth,
  type TactileState,
  useTheme,
} from '@/ui/theme';

export type ActionButtonProps = {
  label: string;
  onPress: () => void;
  /**
   * `primary` is a filled control for the one action a surface is asking for;
   * `secondary` is outlined, for anything alongside it.
   *
   * `brand` is the yellow call to action, and it exists for one situation: a
   * card that asks a question about money and needs the answer that CONTINUES
   * to be obvious. It rides on `accent` / `accentPressed` / `onAccent`, the
   * same three tokens the sheet's save button uses, so there is one yellow in
   * the app and not two.
   */
  tone?: 'primary' | 'secondary' | 'brand';
  disabled?: boolean;
  /**
   * The action is running. Reaches assistive tech as ,
   * which is the difference between "this button is off" and "this button is
   * working" - a disabled control with no busy state reads as broken.
   */
  busy?: boolean;
  /**
   * El material de Android, **por adhesión y nunca por omisión**.
   *
   * Sin él el botón queda exactamente como estaba, que es lo que necesitan sus
   * consumidores fuera de Perfil. Con `'control'` recibe el material neutro
   * aprobado: relleno plano, rim base y acento superior, y ninguna sombra —ni
   * el `inset` del estado ni la proyección exterior—. En iOS no cambia nada en
   * ninguno de los dos casos.
   */
  material?: 'control';
  style?: ViewStyle;
};

/**
 * A labelled action, with the depth the rest of the app uses.
 *
 * Three surfaces had grown their own version of this - the create-group call
 * to action, the retry on an error, the action inside an empty state - each
 * repeating the same resting-raised, pressed-sunken shading and the same 48pt
 * minimum. What it removes is that repetition; what it fixes is that the three
 * had already started to drift apart in radius and padding.
 *
 * **The brand accent used to be absent here, and now has one door.** The rule
 * it protected is still the rule — the filled yellow is the action a surface is
 * asking for, and nothing else earns it — so `primary` remains a lifted neutral
 * surface. What changed is that a surface appeared where the neutral pair was
 * not enough: an incident asks a question about money, and which answer
 * CONTINUES has to be obvious at a glance. That is `brand`, and it takes the
 * same three tokens as the save button rather than a colour of its own.
 */
export function ActionButton({
  label,
  onPress,
  tone = 'secondary',
  disabled = false,
  busy = false,
  material,
  style,
}: ActionButtonProps) {
  const theme = useTheme();
  const brand = tone === 'brand';
  const primary = tone === 'primary';
  const neutro = material === 'control' && !brand;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => {
        /*
         * El estado táctil, resuelto UNA vez. Lo leen el fondo de la vista y la
         * capa de relieve, y tienen que ser la misma expresión: dos escrituras
         * equivalentes se separan en cuanto una cambie.
         */
        const tacto = estado(pressed, primary);

        if (brand) {
          /*
           * El amarillo es opaco y se pinta solo: ni material neutro ni capa de
           * relieve encima, que lo taparían. El tacto lo lleva `accentPressed`,
           * que es el token que ya existe para eso.
           */
          return [
            styles.button,
            {
              backgroundColor: pressed ? theme.accentPressed : theme.accent,
              borderColor: 'transparent',
              opacity: disabled ? 0.5 : 1,
            },
            style,
          ];
        }

        return [
          styles.button,
          {
            backgroundColor: pressed
              ? theme.surfaceSunken
              : primary
                ? theme.surfaceRaised
                : theme.surface,
            borderColor: neutro
              ? controlEdge(primary ? theme.borderInteractive : theme.border)
              : primary
                ? theme.borderInteractive
                : theme.border,
            boxShadow: neutro ? emphasisDepth(tacto) : surfaceDepth(tacto),
            opacity: disabled ? 0.5 : 1,
          },
          style,
        ];
      }}>
      {({ pressed }) => (
        <>
          {/*
           * La proyeccion exterior, en su vista y solo en Android. En iOS
           * `DepthLayer` no monta nada y `surfaceDepth` devuelve el token
           * entero: este control queda como estaba.
           */}
          {brand ? null : neutro ? (
            /*
             * El material neutro. `fill` sigue al estado: al pulsar se retira
             * el relleno plano y aparece el `surfaceSunken` del host, que es
             * exactamente la respuesta táctil que este botón ya tenía. El rim
             * se queda en los dos estados.
             */
            <ControlMaterial radius={Radius.full} fill={!pressed} />
          ) : (
            <DepthLayer state={estado(pressed, primary)} radius={Radius.full} />
          )}
          <ThemedText
            variant="label"
            themeColor={disabled ? 'textDisabled' : brand ? 'onAccent' : 'text'}>
            {label}
          </ThemedText>
        </>
      )}
    </Pressable>
  );
}

/**
 * El estado tactil del boton, en un solo sitio.
 *
 * Lo leen la sombra de la vista y la capa de proyeccion, y tienen que coincidir:
 * dos expresiones equivalentes se separan en cuanto una cambie.
 */
function estado(pressed: boolean, primary: boolean): TactileState {
  if (pressed) return 'pressed';
  return primary ? 'selected' : 'raised';
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.full,
  },
});
