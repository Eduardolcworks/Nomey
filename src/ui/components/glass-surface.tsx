import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  type BoxShadowValue,
  type ViewProps,
} from 'react-native';

import {
  Glass,
  type GlassLevel,
  innerShading,
  Radius,
  Tactile,
  type TactileState,
} from '@/ui/theme';

/**
 * How hard the top edge catches the light.
 *
 * `catch` is the original and stays the default, so nothing that predates this
 * prop changes. The other two exist because of what the rim does on a ROUNDED
 * shape: a one-pixel inset offset with no blur meets the curve tangentially at
 * the ends, so the light piles up there and the corners read brighter than the
 * edge it is supposed to describe. On a pill it is two bright crescents.
 *
 * `soft` keeps the light and spreads it, which is what removes the pile-up
 * without removing the depth. `none` drops it entirely, for a surface whose
 * own fill already separates it from the ground.
 */
export type GlassRim = 'catch' | 'soft' | 'none';

export type GlassSurfaceProps = ViewProps & {
  /** Which material this surface is. See `ui/theme/elevation.ts`. */
  level?: GlassLevel;
  /** How it sits: raised at rest, pressed when held, and so on. */
  depth?: TactileState | 'flat';
  /** How hard the top edge catches the light. See `GlassRim`. */
  rim?: GlassRim;
  radius?: number;
  /**
   * Whether this surface may layer the native effect on top. Defaults to `true`.
   *
   * **An opt-out, never a style choice.** Both branches paint the same tokens -
   * tint, border, radius, rim and depth - so turning it off does not make the
   * surface a different material; it only gives up the live refraction of
   * whatever sits behind. Reach for it when hosting a `GlassView` in that
   * particular place is what breaks, not when a surface would look better flat.
   *
   * The one caller that sets it is the category trigger: `GlassView` used as
   * the label of a SwiftUI `Menu` flattens into a blurred rectangular plate for
   * about a second on dismiss - expo/expo#44126, closed upstream with no
   * published fix.
   */
  nativeEffect?: boolean;
  /**
   * Whether this surface casts the outer half of its depth. Defaults to `true`.
   *
   * **A relocation, not a removal.** With `false` the surface keeps its inner
   * shading — the rim and the state's own shading are untouched — and only stops
   * casting onto the ground, because something else is casting it for it. Both
   * halves are separate entries of the same token, so nothing is rewritten or
   * approximated: see `castShadow` and `innerShading`.
   *
   * The one caller that sets it is the category trigger on iOS, whose circle is
   * the label of a SwiftUI `Menu`. That label is recomposed when the menu is
   * dismissed, and an outer shadow inside it is what surfaces as a flattened
   * plate for about a second. The shadow moves to a stable sibling instead.
   */
  castsShadow?: boolean;
};

/**
 * A translucent surface that reads as an object, and stays legible when the
 * translucency does not arrive.
 *
 * **The tokens paint the surface; the native effect only enhances it.** That
 * order is the whole design. `expo-glass-effect` does not degrade gracefully -
 * it disappears: on Android and on iOS before 26, `GlassView` renders a plain
 * `View` with no tint and no blur, so a control that trusted it would be
 * invisible on a black ground. Everything that makes this look like glass -
 * the lifted tint, the rim, the top highlight and the inner shading - is
 * painted here with ordinary React Native styles and needs nothing native.
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
      blurRadius: rim === 'soft' ? 4 : 0,
      color: highlight,
      inset: true,
    },
  ];
}

/**
 * Whether the native effect will do anything on this device, right now.
 *
 * Reduce Transparency is read asynchronously and subscribed to, because a user
 * can turn it on while the app is open and a surface that ignored that would
 * be overriding an accessibility setting.
 */
export function useNativeGlass(): boolean {
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    let active = true;

    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (active) setReduceTransparency(enabled);
      })
      .catch(() => {
        // Not supported everywhere. Assuming "off" only costs an effect that
        // the checks below may refuse anyway.
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency,
    );

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  if (reduceTransparency) return false;
  return isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
}

const styles = StyleSheet.create({
  surface: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
