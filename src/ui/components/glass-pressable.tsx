import { useState } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { type GlassRim, GlassSurface } from './glass-surface';
import { usePressScale } from '@/ui/theme/motion-runtime';
import { Radius, type TactileState } from '@/ui/theme';

export type GlassPressableProps = {
  onPress: () => void;
  /** Siempre obligatorio: un control sin nombre accesible se anuncia «botón». */
  label: string;
  /** Cómo descansa cuando no está pulsado. */
  depth?: TactileState;
  disabled?: boolean;
  busy?: boolean;
  /** Marca el control como elegido, para un segmento o un conmutador. */
  selected?: boolean;
  /** Cuánto brilla el borde superior. Ver `GlassRim`. */
  rim?: GlassRim;
  radius?: number;
  /**
   * Recorta el contenido a la forma redondeada de la superficie.
   *
   * Lo pide quien mete dentro un relleno OPACO que ocupa la caja entera: sin
   * máscara ese hijo decide la forma, y si la pierde tapa la del control.
   */
  clip?: boolean;
  /**
   * Qué material recibe en Android. Por omisión el neutro sólido.
   *
   * Se declara porque hay controles que NO pueden volverse opacos: el CTA
   * apagado es transparente a propósito, y sustituirle el relleno le quitaba
   * eso. Es una excepción nombrada, no una propagación.
   */
  material?: 'control' | 'translucent-control';
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

/**
 * Una superficie de vidrio que además se deja pulsar, y se nota.
 *
 * Existe porque el `+` trajo cinco controles a la vez —cerrar, moneda,
 * categoría, calendario y guardar— y los cinco piden lo mismo: vidrio,
 * profundidad en reposo y hundirse al mantenerlos. Sin esto cada uno habría
 * vuelto a escribir el par `Tactile.raised` / `Tactile.pressed` con su propio
 * radio, que es exactamente cómo empezaron a separarse los tres botones que
 * `ActionButton` acabó unificando.
 *
 * **La escala la anima Reanimated y la profundidad no.** `boxShadow` no es una
 * propiedad que el hilo de UI pueda interpolar, así que el hundimiento se
 * consigue cambiando el estado táctil de `GlassSurface` —un cambio discreto,
 * que es lo que un toque es— y sólo la escala viaja por el `timing`. Un
 * componente que fingiera animar la sombra estaría animando en el hilo de JS y
 * perdería fotogramas justo con el dedo encima.
 *
 * **Reduce Motion viene de `usePressScale`**, que es donde `ReduceMotion.System`
 * está declarado. La profundidad sigue cambiando aunque el movimiento se
 * apague, porque eso no es movimiento: es la respuesta que dice que el control
 * ha recibido el toque.
 */
export function GlassPressable({
  onPress,
  label,
  depth = 'raised',
  disabled = false,
  busy = false,
  selected = false,
  rim = 'catch',
  radius = Radius.full,
  clip = false,
  material = 'control',
  style,
  children,
}: GlassPressableProps) {
  const [pressed, setPressed] = useState(false);
  const press = usePressScale();

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: press.scale.value }] }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy, selected }}
      disabled={disabled || busy}
      onPressIn={() => {
        setPressed(true);
        press.handlers.onPressIn();
      }}
      onPressOut={() => {
        setPressed(false);
        press.handlers.onPressOut();
      }}
      onPress={onPress}
      style={style}>
      <Animated.View style={animated}>
        <GlassSurface
          level={selected ? 'heavy' : 'regular'}
          depth={pressed ? 'pressed' : selected ? 'selected' : depth}
          rim={rim}
          radius={radius}
          clip={clip}
          /*
           * EL RELIEVE DE LOS CONTROLES, y aquí porque esto ES un control.
           *
           * Un botón de cristal se lee mejor con el relieve de los tokens
           * —el rim de arriba y el sombreado interior— que con la refraccion
           * nativa encima, que sobre un fondo casi opaco aporta poco y aplana
           * ese relieve. Decidido sobre el aparato.
           *
           * **No es una renuncia global.** `GlassSurface` sigue con el efecto
           * nativo por defecto, y quien lo apaga es esta pieza, cuya definicion
           * es «superficie que se pulsa». Las estructurales —ventana, tarjetas,
           * grupos, hoja del calendario, fondo del dock— no pasan por aqui.
           */
          /*
           * Un control, por definicion: esta pieza ES «superficie que se
           * pulsa». Con esto la moneda, el calendario, el cierre y los CTA
           * reciben el material neutro de Android sin pedirlo cada uno.
           */
          material={material}
          nativeEffect={false}
          /*
           * Deshabilitado, dicho DOS veces y a proposito: la opacidad es la
           * respuesta compartida y no cambia, y `disabled` deja que Android
           * elija ademas su variante de profundidad. iOS lo ignora.
           */
          disabled={disabled}
          style={disabled ? { opacity: 0.45 } : undefined}>
          {children}
        </GlassSurface>
      </Animated.View>
    </Pressable>
  );
}
