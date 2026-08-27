import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type ViewProps } from 'react-native';

import { Glass, type GlassLevel, Radius, Tactile, type TactileState } from '@/ui/theme';

export type GlassSurfaceProps = ViewProps & {
  /** Which material this surface is. See `ui/theme/elevation.ts`. */
  level?: GlassLevel;
  /** How it sits: raised at rest, pressed when held, and so on. */
  depth?: TactileState | 'flat';
  radius?: number;
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
  radius = Radius.lg,
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  const token = Glass[level];
  const enhanced = useNativeGlass();

  const surface = [
    styles.surface,
    {
      backgroundColor: token.tint,
      borderColor: token.border,
      borderRadius: radius,
      // The light lands on the top edge first, then the state's own shading.
      boxShadow: [
        { offsetX: 0, offsetY: 1, blurRadius: 0, color: token.highlight, inset: true },
        ...(depth === 'flat' ? [] : Tactile[depth]),
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
 * Whether the native effect will do anything on this device, right now.
 *
 * Reduce Transparency is read asynchronously and subscribed to, because a user
 * can turn it on while the app is open and a surface that ignored that would
 * be overriding an accessibility setting.
 */
function useNativeGlass(): boolean {
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
