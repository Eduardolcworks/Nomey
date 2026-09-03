/**
 * EL BACKOFF DE ADR-028 §12, con su suelo.
 *
 * ```
 * techo   = min(base · 2^intentos, tope)
 * retardo = minimo + aleatorio() · (techo − minimo)
 * ```
 *
 * **El suelo no es un detalle de afinado.** El jitter completo —`aleatorio() ·
 * techo`— puede devolver un retardo prácticamente nulo, y entonces el backoff
 * deja de serlo: una entrada que falla contra un servidor caído se reintentaría
 * en bucle, gastando batería y datos. Con mínimo, el peor caso sigue siendo un
 * intento por segundo y el caso normal se separa solo.
 *
 * **Reloj y RNG se inyectan** para que las pruebas puedan fijar los dos
 * extremos —`aleatorio() = 0` da el suelo, `= 1` da el techo— en vez de
 * comprobar que el resultado «parece razonable».
 */

/** Un reloj, para poder detener el tiempo en una prueba. */
export type Clock = { now: () => number };

/** Una fuente de aleatoriedad en `[0, 1)`. No es criptográfica y no lo necesita. */
export type Random = () => number;

export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MINIMUM_MS = 1_000;
export const BACKOFF_CEILING_MS = 300_000;

/**
 * Cuánto esperar antes del intento número `attempts + 1`.
 *
 * `attempts` es cuántos han fallado ya: con 0 el techo es la base, así que el
 * primer reintento cae exactamente en el suelo y no depende del azar.
 */
export function backoffDelayMs(attempts: number, random: Random): number {
  const exponent = Math.min(attempts, 30); // 2^30 · 1 s ya supera el tope con creces
  const ceiling = Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_CEILING_MS);
  const span = Math.max(ceiling - BACKOFF_MINIMUM_MS, 0);

  return Math.round(BACKOFF_MINIMUM_MS + random() * span);
}

/** Cuándo toca el siguiente intento, en ISO 8601. */
export function nextAttemptAt(attempts: number, clock: Clock, random: Random): string {
  return new Date(clock.now() + backoffDelayMs(attempts, random)).toISOString();
}

/** Si ya venció el plazo de una entrada. Sin `next_attempt_at`, se puede ya. */
export function isDue(nextAttempt: string | null, clock: Clock): boolean {
  if (nextAttempt === null) return true;
  const due = Date.parse(nextAttempt);
  // Una fecha ilegible no puede bloquear una entrada para siempre: se intenta.
  return Number.isNaN(due) || due <= clock.now();
}
