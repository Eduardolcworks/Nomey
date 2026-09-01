import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTranslation } from '@/lib/i18n';
import { GlassSurface, Icon, ThemedText } from '@/ui/components';
import { Glass, Motion, Radius, Spacing, useTheme } from '@/ui/theme';

import { SCOPE_LABEL, SCOPES, type Scope, useScope } from './scope-context';
import { SPRING, timing, usePressScale } from './shell-motion';

/** With two scopes, "the other one" is the whole cycle. */
function nextScope(current: Scope): Scope {
  return current === 'personal' ? 'couple' : 'personal';
}

/**
 * Which way the swap glyph leans, so the nudge agrees with the change.
 *
 * Forward through the list leans right, back leans left. With two scopes this
 * is barely more than a sign, but deriving it from the order rather than
 * hard-coding `personal` means a third scope would not silently make the
 * direction meaningless.
 */
function nudgeDirection(from: Scope, to: Scope): number {
  return SCOPES.indexOf(to) > SCOPES.indexOf(from) ? 1 : -1;
}

/**
 * One button that says which scope is active, and swaps to the other.
 *
 * A two-half segmented control spent half its width showing the option you are
 * not in, which is the wrong emphasis for something that answers "whose money
 * am I looking at". A single button states the answer, and the swap glyph says
 * it can change.
 *
 * The cost of that trade is that the alternative is no longer visible, so the
 * label carries the current scope in full-strength text and the accessible
 * name says where a press goes - "Cambiar a Pareja" - rather than leaving the
 * user to discover it by pressing.
 *
 * Glass for the surface, tactile depth for the press. Both, because this is
 * the control the whole screen hangs off: the balance below it and the action
 * button at the bottom both mean something different depending on it.
 *
 * **Personal and Pareja look identical.** Pareja has no implementation behind
 * it yet, and an earlier version said so by dimming it - which made one of two
 * equivalent scopes read as broken or lesser. What is missing is a feature,
 * not the standing of a scope, so the absence is stated where the feature
 * would be, in the sheet the action opens, and never in the control that names
 * them.
 *
 * MOTION. Same spring as the dock, one register down.
 *
 * The destinations lift, grow to 1.06 and reach the selected depth. This does
 * none of those: no lift at all, 1.02 instead of 1.06, and the surface never
 * leaves its resting depth. What was NOT changed is the timing - a faster
 * switch would read as a different system rather than as a quieter one, so the
 * curve and the duration are identical and only the travel comes down. That is
 * the whole family resemblance.
 *
 * It also moves for a different reason. A destination animates because
 * selection moved from one object to another; there is only one object here,
 * so what it animates is that its own meaning changed. Hence a kick and a
 * settle rather than a transfer: the surface swells briefly, a light passes
 * over the glass, and the swap glyph leans the way the change went.
 *
 * **The label is not cross-faded.** Sequencing a fade out, a text swap and a
 * fade in needs a timer holding a copy of state the swap has already changed,
 * and it buys about 80 ms of polish in exchange for a second source of truth
 * about which scope is showing. The kick covers the swap, and the label stays
 * one string read straight from the provider.
 */
export function ScopeSwitch() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { scope, setScope } = useScope();

  const target = nextScope(scope);

  const press = usePressScale();
  const swell = useSharedValue(1);
  const lean = useSharedValue(0);
  const sheen = useSharedValue(0);

  /*
   * The previous scope, in a ref rather than in state: it decides which way
   * the glyph leans and must not itself cause a render. On the first pass it
   * equals the current scope, so mounting never animates - the control appears
   * at rest, and only a real change moves it.
   */
  const previous = useRef(scope);

  useEffect(() => {
    const from = previous.current;
    previous.current = scope;
    if (from === scope) return;

    const kick = timing(Motion.scope.kick);

    swell.value = withSequence(withTiming(Motion.scope.surfaceScale, kick), withSpring(1, SPRING));

    lean.value = withSequence(
      withTiming(Motion.scope.nudge * nudgeDirection(from, scope), kick),
      withSpring(0, SPRING),
    );

    // The light passing over the glass. It never rests visible, so it cannot
    // change what the control looks like - only say that it just changed.
    sheen.value = withSequence(withTiming(1, kick), withTiming(0, timing(Motion.screen.duration)));
  }, [scope, swell, lean, sheen]);

  const surfaceStyle = useAnimatedStyle(() => ({
    transform: [{ scale: swell.value * press.scale.value }],
  }));

  const sheenStyle = useAnimatedStyle(() => ({ opacity: sheen.value }));

  const glyphStyle = useAnimatedStyle(() => ({ transform: [{ translateX: lean.value }] }));

  return (
    <Pressable
      accessibilityRole="button"
      // El nombre dice el estado y la pista dice la acción, que es justo la
      // ambigüedad de un pulsador cuya etiqueta cambia: "Personal" no aclara por
      // sí solo si es dónde estás o adónde vas.
      accessibilityLabel={`${t('scope.label')}: ${t(SCOPE_LABEL[scope])}`}
      accessibilityHint={t('scope.switchTo', { scope: t(SCOPE_LABEL[target]) })}
      onPress={() => {
        setScope(target);
      }}
      {...press.handlers}
      style={styles.pressable}>
      {({ pressed }) => (
        <Animated.View style={surfaceStyle}>
          <GlassSurface
            level="regular"
            depth={pressed ? 'pressed' : 'raised'}
            radius={Radius.full}
            /* Selector Personal/Pareja: se pulsa, y tiene estado pulsado. */
            nativeEffect={false}
            style={styles.surface}>
            <Animated.View
              pointerEvents="none"
              style={[styles.sheen, { borderColor: Glass.regular.highlight }, sheenStyle]}
            />
            <ThemedText variant="label" themeColor="text">
              {t(SCOPE_LABEL[scope])}
            </ThemedText>
            <Animated.View style={glyphStyle}>
              <Icon name="arrow.left.arrow.right" size={13} colour={theme.textTertiary} />
            </Animated.View>
          </GlassSurface>
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    borderRadius: Radius.full,
    // 44pt of height for a thumb, whatever the label measures.
    minHeight: 44,
    justifyContent: 'center',
  },
  surface: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 44,
  },
  /**
   * The light that passes over the glass when the scope changes.
   *
   * A rim and a very thin white veil, never anything that rests visible. Its
   * alpha only ever adds to what is behind it, so it cannot take contrast away
   * from the label the way fading the surface's own tint would.
   */
  sheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
});
