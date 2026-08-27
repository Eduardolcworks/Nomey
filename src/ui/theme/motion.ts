/**
 * How Nomey moves.
 *
 * **One curve, two registers.** The bottom navigation and the scope switch are
 * different kinds of control - one changes where you are, the other changes
 * whose money you are looking at - but they must read as the same system. So
 * they share the spring exactly, and differ only in how far things travel.
 * Same physics, different amplitude, which is what makes two controls feel
 * related without making them feel identical.
 *
 * This is a token file, not an animation framework. It holds the numbers so
 * they cannot drift apart between two components; it does not wrap Reanimated,
 * and nothing should be added here that has one consumer.
 *
 * **The spring is deliberately close to critically damped.** With mass 0.6,
 * stiffness 300 and damping 24 the ratio is about 0.9: it settles in roughly
 * 200 ms with a barely perceptible overshoot. That is the difference between a
 * control that feels tactile and one that feels bouncy - and bounce is what
 * turns a micro-interaction tiring after a few minutes of real use.
 *
 * **Numbers only, and no import of Reanimated.** This file has to stay
 * executable by Vitest, which has no React Native transform - the same reason
 * `elevation.ts` imports a type and never a value. Reduce Motion is therefore
 * not declared here but in `features/shell/shell-motion.ts`, which turns these
 * numbers into animation configs and is the single place that flag is written.
 */
export const Motion = {
  /** The one spring. Everything that moves uses it. */
  spring: {
    mass: 0.6,
    stiffness: 300,
    damping: 24,
  },

  /** For the things a spring would overshoot pointlessly, like a press. */
  press: {
    scale: 0.97,
    duration: 90,
  },

  /**
   * Primary navigation - Inicio / Grupos. The louder register.
   *
   * `lift` is in points and moves the whole pill; `restOpacity` is what the
   * unselected content fades back to. Opacity rather than a colour swap so the
   * change can actually be animated, and because dimming keeps the label above
   * AA on the pill either way.
   */
  destination: {
    iconScale: 1.06,
    lift: 2,
    restOpacity: 0.62,
  },

  /**
   * Context change - Personal / Pareja. The same curve, one dimension less.
   *
   * No lift at all, a third of the scale, and the surface never reaches the
   * selected depth. Changing the duration instead would have read as a
   * different system rather than a quieter one, so the timing register is
   * identical and only the travel comes down.
   */
  scope: {
    surfaceScale: 1.02,
    /** How far the swap glyph leans, in points, before it settles back. */
    nudge: 3,
    /** How long the kick out takes before the spring brings it home. */
    kick: 70,
  },

  /**
   * The screen behind the dock, when the destination changes.
   *
   * 16 points rather than the 50 the built-in `shift` preset uses: at 50 the
   * content reads as a page turn competing with the dock, which is the
   * opposite of the point. The duration matches the spring's settling time so
   * the screen and the pill finish together.
   */
  screen: {
    duration: 200,
    travel: 16,
  },
} as const;
