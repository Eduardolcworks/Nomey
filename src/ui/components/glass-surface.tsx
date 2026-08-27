import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type ViewProps } from 'react-native';

import { Glass, type GlassLevel, Radius } from '@/ui/theme';

export type GlassSurfaceProps = ViewProps & {
  /** Which depth this surface has. See `ui/theme/elevation.ts`. */
  level?: GlassLevel;
  /** Corner radius. A bar usually wants none. */
  radius?: number;
};

/**
 * A translucent surface that stays legible when the translucency does not
 * arrive.
 *
 * **The tokens paint the surface; the native effect only enhances it.** That
 * order is the whole design. `expo-glass-effect` does not degrade gracefully -
 * it disappears: on Android and on iOS before 26, `GlassView` renders a plain
 * `View` with no tint and no blur at all. A surface that trusted it would be
 * invisible on half the devices Nomey ships to, and a black bar on a black
 * background is not a bar, it is icons floating over nothing.
 *
 * So the tint, the hairline and the radius are always painted from the theme,
 * and `GlassView` is layered on top only when it will actually do something.
 * Three conditions have to hold, and each is a real failure mode:
 *
 * - `isGlassEffectAPIAvailable()` - some iOS 26 betas ship without the API and
 *   crash when it is used, which is why the package exposes this check at all;
 * - `isLiquidGlassAvailable()` - the app is actually running the Liquid Glass
 *   design;
 * - Reduce Transparency is off - a user who asked the system for less
 *   translucency gets less translucency, not a decorative exception.
 */
export function GlassSurface({
  level = 'regular',
  radius = Radius.lg,
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  const token = Glass[level];
  const enhanced = useNativeGlass();

  const base = [
    styles.surface,
    {
      backgroundColor: token.tint,
      borderColor: token.border,
      borderRadius: radius,
    },
    style,
  ];

  if (!enhanced) {
    return (
      <View style={base} {...rest}>
        <Highlight colour={token.highlight} radius={radius} />
        {children}
      </View>
    );
  }

  return (
    <GlassView
      style={base}
      glassEffectStyle="regular"
      tintColor={token.tint}
      colorScheme="dark"
      {...rest}>
      <Highlight colour={token.highlight} radius={radius} />
      {children}
    </GlassView>
  );
}

/**
 * The light catch along the top edge.
 *
 * Ornamental, and deliberately incapable of carrying meaning: it is one
 * hairline of low-opacity white. `theme` is not read here because the value is
 * part of the glass token, not of the palette.
 */
function Highlight({ colour, radius }: { colour: string; radius: number }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.highlight,
        { backgroundColor: colour, borderTopLeftRadius: radius, borderTopRightRadius: radius },
      ]}
    />
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
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth * 2,
  },
});
