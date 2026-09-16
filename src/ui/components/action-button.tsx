import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { actionSurface, tactileState } from './action-button-style';
import { ControlMaterial } from './control-material';
import { DepthLayer } from './depth-layer';
import { ThemedText } from './themed-text';
import { controlEdge, emphasisDepth, Radius, Spacing, surfaceDepth, useTheme } from '@/ui/theme';

export type ActionButtonProps = {
  label: string;
  onPress: () => void;
  /**
   * `primary` is a filled control for the one action a surface is asking for;
   * `secondary` is outlined, for anything alongside it.
   *
   * `brand` is the yellow call to action: the one answer a surface asks for
   * and needs to be obvious at a glance — the incident card's «continue», and
   * the guest's «Crear cuenta» in Inicio and Perfil. It rides on `accent` /
   * `accentPressed` / `onAccent`, the same three tokens the sheet's save
   * button uses, so there is one yellow in the app and not two. Disabled, it
   * is a GREY switched-off control, never a pale yellow (`action-button-style`).
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
  /**
   * La indicación accesible, cuando la etiqueta no basta.
   *
   * El sistema la anuncia DESPUÉS del nombre y tras una pausa, así que dice
   * para qué sirve el botón —o por qué no está disponible— sin alargar el
   * nombre. Opcional: la mayoría de acciones se explican con su etiqueta.
   */
  hint?: string;
  style?: ViewStyle;
  /**
   * `compact`: el mismo oblongo —materiales, tono, radio— en un cuerpo más
   * bajo, para vivir dentro de una fila junto a una cifra. Lo que se ve mide
   * 32; lo que se toca sigue siendo 44, por `hitSlop`.
   */
  size?: 'regular' | 'compact';
  /**
   * Un botón que despliega o pliega algo: se anuncia con
   * `accessibilityState.expanded`, para que quien no ve la pantalla sepa en
   * qué estado está. Sin él, el botón es una acción y no un conmutador.
   */
  expanded?: boolean;
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
  hint,
  style,
  size = 'regular',
  expanded,
}: ActionButtonProps) {
  const theme = useTheme();
  const brand = tone === 'brand';
  const primary = tone === 'primary';
  const neutro = material === 'control' && !brand;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled, busy, expanded }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={size === 'compact' ? COMPACT_HIT_SLOP : undefined}
      style={({ pressed }) => {
        /*
         * La superficie, resuelta UNA vez y en un sitio puro
         * (`action-button-style`): fondo, borde, relieve y opacidad salen de la
         * misma decision que lee el texto de abajo, y esa decision se prueba
         * sin renderer. El amarillo de `brand` es opaco y se pinta solo: sin
         * material ni capa de relieve encima, que lo taparian.
         */
        const surface = actionSurface({ tone, disabled, pressed, neutral: neutro, theme });
        const depth = surface.depth;
        return [
          styles.button,
          size === 'compact' ? styles.compact : null,
          {
            backgroundColor: surface.backgroundColor,
            borderColor: surface.neutralEdge
              ? controlEdge(surface.borderColor)
              : surface.borderColor,
            // The shadow is always a token state through the platform helpers.
            boxShadow:
              depth === null ? undefined : neutro ? emphasisDepth(depth) : surfaceDepth(depth),
            opacity: surface.opacity,
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
            <DepthLayer state={tactileState(pressed, primary)} radius={Radius.full} />
          )}
          <ThemedText
            variant={size === 'compact' ? 'caption' : 'label'}
            themeColor={
              actionSurface({ tone, disabled, pressed, neutral: neutro, theme }).textColor
            }
            numberOfLines={1}>
            {label}
          </ThemedText>
        </>
      )}
    </Pressable>
  );
}

/** Lo que le falta a 32 de alto para tocarse como 44. */
const COMPACT_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 };

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.full,
  },
  /** El cuerpo compacto: más bajo y más estrecho; nada más cambia. */
  compact: {
    minHeight: 32,
    paddingHorizontal: Spacing.md,
    flexShrink: 0,
  },
});
