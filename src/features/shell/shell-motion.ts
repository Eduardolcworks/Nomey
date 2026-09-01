/**
 * The shell's motion.
 *
 * The configs themselves - the spring, the timing and the shared press - now
 * live in `ui/theme/motion-runtime.ts`, and this file is a re-export.
 *
 * They moved because the shell stopped being the only consumer: `GlassPressable`
 * is part of the design system and `ui/` may not import from `features/`, and
 * `features/personal` may not import from `features/shell` either. With two
 * consumers in layers that cannot reach this one, keeping the declaration here
 * would have meant a second copy of `ReduceMotion.System` - which is precisely
 * how an accessibility setting ends up honoured in half an app.
 *
 * **The guarantee is unchanged and is stated where it now lives:**
 * `ReduceMotion.System` is written once, in `motion-runtime.ts`, and a guard in
 * `tests/infra/shell-motion.test.ts` checks that no component anywhere in
 * `src/` hand-writes a config that would bypass it.
 *
 * This file stays so that the dock's call sites keep reading their motion from
 * the shell, which is where a reader of `nomey-tab-bar.tsx` will look for it.
 */
export { SPRING, timing, usePressScale } from '@/ui/theme/motion-runtime';
