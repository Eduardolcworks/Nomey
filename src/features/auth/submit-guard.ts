/**
 * One submission at a time.
 *
 * The failure this prevents is not theoretical: on a slow connection a tap on
 * "Crear cuenta" that does not respond immediately gets tapped again, and two
 * `signUp` calls go out. GoTrue answers the second one differently from the
 * first, so the user sees an error for an operation that actually succeeded.
 *
 * Disabling the button is the visible half and is not enough on its own -
 * between the tap and the re-render there is a window, and React Native
 * coalesces neither. This is the half that actually holds.
 *
 * It is deliberately a plain closure rather than a hook: a `useRef` guard
 * cannot be tested without a renderer, and this can.
 */

export const SKIPPED = Symbol('submit-skipped');

export type ExclusiveRunner = <T>(task: () => Promise<T>) => Promise<T | typeof SKIPPED>;

export function createExclusiveRunner(): ExclusiveRunner {
  let inFlight = false;

  return async function run<T>(task: () => Promise<T>): Promise<T | typeof SKIPPED> {
    if (inFlight) return SKIPPED;
    inFlight = true;
    try {
      return await task();
    } finally {
      // In `finally` so a rejection does not wedge the form shut. A failed
      // submission has to be retryable - that is the whole point of showing
      // the error next to a form that kept what was typed.
      inFlight = false;
    }
  };
}
