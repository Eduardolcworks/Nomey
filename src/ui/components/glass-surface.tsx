import { GlassView } from 'expo-glass-effect';
import { StyleSheet, View, type BoxShadowValue } from 'react-native';

import { Glass, innerShading, Radius, RimBlur, Tactile, type TactileState } from '@/ui/theme';

import type { GlassRim, GlassSurfaceProps } from './glass-surface-props';
import { useNativeGlass } from './use-native-glass';

export type { GlassRim, GlassSurfaceProps } from './glass-surface-props';

/**
 * A translucent surface that reads as an object, and stays legible when the
 * translucency does not arrive.
 *
 * **Esta es la implementación de iOS —y de cualquier plataforma que no sea
 * Android—, y es la aprobada.** Android tiene la suya en
 * `glass-surface.android.tsx`, y Metro elige por extensión: aquí no hay ni una
 * rama de plataforma, ni un condicional, ni una capa que exista para otro
 * renderizador. Lo que este fichero resuelve es lo que resolvía antes de que
 * Android entrara en escena.
 *
 * **Y todo cabe en UNA vista porque aquí eso funciona.** Core Animation funde
 * la lista entera de un `boxShadow` en un solo paso, con una caída continua, así
 * que el rim, el sombreado del estado, su proyección y la lente del material se
 * componen sin pisarse. Separarlas en capas no arreglaría nada y cambiaría el
 * árbol; Android hace lo contrario —apila una silueta por entrada— y por eso
 * necesita otra topología.
 *
 * **The tokens paint the surface; the native effect only enhances it.** That
 * order is the whole design. `expo-glass-effect` does not degrade gracefully -
 * it disappears: on iOS before 26, `GlassView` renders a plain `View` with no
 * tint and no blur, so a control that trusted it would be invisible on a black
 * ground. Everything that makes this look like glass - the lifted tint, the
 * rim, the top highlight and the inner shading - is painted here with ordinary
 * React Native styles and needs nothing native.
 *
 * **The depth is applied on the view that paints the surface**, which is the
 * detail the first version got wrong. Inset shadows on a transparent parent
 * are drawn and then covered by the child that fills it, so the resting state
 * rendered nothing while the pressed state - which happened to be readable
 * against what little surface there was - came through. Rest looked flat and a
 * press looked like the effect switching on.
 *
 * `GlassView` is layered on only when it will actually do something. Three
 * conditions, each a real failure mode: the API is present (some iOS 26 betas
 * ship without it and crash when it is used), Liquid Glass is in use, and
 * Reduce Transparency is off - a user who asked the system for less
 * translucency gets less translucency, not a decorative exception.
 */
export function GlassSurface({
  level = 'regular',
  depth = 'raised',
  rim = 'catch',
  radius = Radius.lg,
  nativeEffect = true,
  castsShadow = true,
  clip = false,
  // Deshabilitado se dice aquí con la opacidad de quien llama, como siempre.
  // Sólo Android lo mira, y por eso este parámetro se recoge y no se usa.
  disabled: _disabled = false,
  // El material declarado es de Android: aqui la composicion no cambia.
  material: _material = 'surface',
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  const token = Glass[level];
  // Both conditions have to hold: the device must be able to do something with
  // it, and this surface must want it. The default keeps every existing call
  // site exactly as it was.
  const enhanced = useNativeGlass() && nativeEffect;

  const surface = [
    styles.surface,
    {
      backgroundColor: token.tint,
      borderColor: token.border,
      borderRadius: radius,
      /*
       * Order matters: the first entry paints on top. The rim catch stays
       * visible in every state, the state's own shading comes next so a press
       * overrides the resting light, and the level's lens sits underneath as
       * the material the states act on.
       */
      boxShadow: [
        ...rimShadow(rim, token.highlight),
        ...depthShadow(depth, castsShadow),
        ...(token.lens ?? []),
      ],
      ...(clip ? { overflow: 'hidden' as const } : {}),
    },
    style,
  ];

  if (!enhanced) {
    return (
      <View style={surface} {...rest}>
        {children}
      </View>
    );
  }

  return (
    <GlassView
      style={surface}
      glassEffectStyle="regular"
      tintColor={token.tint}
      colorScheme="dark"
      {...rest}>
      {children}
    </GlassView>
  );
}

/**
 * The state's own shading, and whether it also falls on the ground.
 *
 * The two halves are separate entries of the same token, so dropping the outer
 * one is a filter over the exact same values — never a second set of numbers.
 */
function depthShadow(depth: TactileState | 'flat', casts: boolean): readonly BoxShadowValue[] {
  if (depth === 'flat') return [];
  return casts ? Tactile[depth] : innerShading(depth);
}

/**
 * The top-edge light, at the requested hardness.
 *
 * The blur is the whole mechanism: at 0 the inset offset draws a hard line
 * that wraps the corners and spikes there; spread over a few points it becomes
 * a wash along the top and the corners stop standing out.
 */
function rimShadow(rim: GlassRim, highlight: string): BoxShadowValue[] {
  if (rim === 'none') return [];
  return [
    {
      offsetX: 0,
      offsetY: 1,
      blurRadius: rim === 'soft' ? RimBlur.soft : RimBlur.catch,
      color: highlight,
      inset: true,
    },
  ];
}

const styles = StyleSheet.create({
  surface: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
