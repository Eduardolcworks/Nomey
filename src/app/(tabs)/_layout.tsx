import { SceneStyleInterpolators, Tabs } from 'expo-router/tabs';
import { Easing } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { DESTINATIONS, NomeyTabBar } from '@/features/shell';
import { Motion } from '@/ui/theme';

/**
 * The two root destinations.
 *
 * The bar is entirely Nomey's - the default one cannot hold an action that is
 * not a tab, and the action is the point. Screens are declared from the same
 * array the bar renders from, so the two cannot disagree about what exists.
 *
 * MOTION. The screen moves with the dock, and does so through the navigator's
 * own options rather than around them.
 *
 * `animation: 'shift'` is a supported screen option of the bottom tabs
 * navigator: it already knows which way the change went, from the difference
 * in tab index, so the content leaves in the direction you came from with no
 * state of our own tracking it. **Nothing here reimplements navigation**, and
 * that was the condition for animating the screen at all - if it had needed a
 * gesture handler, a pager or a second source of truth about the active tab,
 * it would not have been worth having.
 *
 * The preset's own interpolator travels 50 points, which at this speed reads
 * as a page turn competing with the dock for attention. Passing a
 * `sceneStyleInterpolator` is also a supported option and overrides the
 * preset's, so the travel comes down to 16 and the transition becomes what it
 * should be: a short displacement confirming the change, not the change
 * itself. The opacity still runs to zero, because both scenes are stacked and
 * an outgoing screen that stays partly visible shows through the incoming one.
 */

/**
 * The built-in `shift`, with the travel brought down.
 *
 * Typed off the preset it replaces rather than by hand: the navigator does not
 * re-export the interpolator's type, and a hand-written approximation of an
 * `Animated` signature is a copy that goes stale silently. `progress` is -1,
 * 0 or 1 - which side the scene is on - and the sign is where the direction
 * comes from.
 */
const shiftScene: typeof SceneStyleInterpolators.forShift = ({ current }) => ({
  sceneStyle: {
    opacity: current.progress.interpolate({
      inputRange: [-1, 0, 1],
      outputRange: [0, 1, 0],
    }),
    transform: [
      {
        translateX: current.progress.interpolate({
          inputRange: [-1, 0, 1],
          outputRange: [-Motion.screen.travel, 0, Motion.screen.travel],
        }),
      },
    ],
  },
});

export default function TabsLayout() {
  /*
   * The explicit Reduce Motion path for the screen.
   *
   * The dock's own motion is handled by the tokens - every spring and timing
   * declares `ReduceMotion.System`, so Reanimated lands them instantly. This
   * transition is not Reanimated's, it is the navigator's, so it has to be
   * turned off here. `'none'` still changes the screen; it just stops it
   * travelling to get there.
   */
  const reduceMotion = useReducedMotion();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? 'none' : 'shift',
        sceneStyleInterpolator: shiftScene,
        transitionSpec: {
          animation: 'timing',
          config: {
            duration: Motion.screen.duration,
            easing: Easing.out(Easing.ease),
          },
        },
      }}
      tabBar={(props) => <NomeyTabBar {...props} />}>
      {DESTINATIONS.map((destination) => (
        <Tabs.Screen key={destination.route} name={destination.route} />
      ))}
    </Tabs>
  );
}
