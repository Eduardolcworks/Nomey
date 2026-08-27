import { ReduceMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Motion } from '@/ui/theme';

/**
 * The shell's motion, as Reanimated configs, plus the press every control
 * shares.
 *
 * The numbers live in `ui/theme/motion.ts`, which stays free of Reanimated so
 * it can be executed by tests. This file is where they become animations, and
 * the split has one consequence worth stating: **`ReduceMotion.System` is
 * written here, once.**
 *
 * That is the whole accessibility mechanism. Reanimated jumps straight to the
 * target value when the system setting is on, so the state still changes and
 * changes clearly - the depth, the opacity and the selection all land - it
 * just lands instantly. No component has to remember it, and no component can
 * quietly forget it: the only way to lose it is to stop using these configs
 * and hand-write one, which is visible in a diff.
 *
 * The screen transition is the exception and cannot be covered here, because
 * it belongs to the tab navigator rather than to Reanimated. It reads the same
 * system setting explicitly in `app/(tabs)/_layout.tsx`.
 */

/** The one spring, shared by both controls. */
export const SPRING = { ...Motion.spring, reduceMotion: ReduceMotion.System } as const;

/** A timing that honours the setting, for the moves a spring would overshoot. */
export function timing(duration: number) {
  return { duration, reduceMotion: ReduceMotion.System } as const;
}

const PRESS = timing(Motion.press.duration);

/**
 * The press, shared by every control in the shell.
 *
 * Three controls needed the identical four lines - both destination pills, the
 * action button and the scope switch - and three copies of a touch response is
 * how a dock ends up with three slightly different ones. It is a hook rather
 * than a token because the value has to live per control.
 *
 * Down is a short timing and up is the spring: pressing should feel immediate,
 * releasing should feel like the object returning. A spring on the way down
 * adds latency to the one moment the user is waiting for confirmation that the
 * tap registered.
 *
 * The caller spreads `handlers` onto its `Pressable` and reads `scale` inside
 * its own `useAnimatedStyle`. Nothing here knows what it is animating, and that
 * is as far as this abstraction is allowed to go.
 */
export function usePressScale() {
  const scale = useSharedValue(1);

  return {
    scale,
    handlers: {
      onPressIn: () => {
        scale.value = withTiming(Motion.press.scale, PRESS);
      },
      onPressOut: () => {
        scale.value = withSpring(1, SPRING);
      },
    },
  };
}
