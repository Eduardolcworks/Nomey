/**
 * EL BACKOFF DE F07/ADR-001 §12, con su suelo.
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
 * LO QUE SE ESPERA CUANDO EL DÍA TODAVÍA NO ESTÁ FIJADO.
 *
 * `FX_RATE_NOT_YET_AVAILABLE` no es un servidor caído: es una respuesta
 * correcta que dice que el tipo del día de esa operación aún no existe
 * (F11/ADR-001 §3.4). Y ahí **esperar no cambia qué tipo se obtendrá, sólo
 * cuándo**: el mismo día se fija una sola vez, con la publicación disponible al
 * empezar en Fráncfort, así que la respuesta sólo puede cambiar cuando llega
 * una fijación nueva.
 *
 * El backoff general está pensado para fallos de transporte y tiene su techo en
 * cinco minutos. Aplicado aquí gastaría batería y datos en cientos de intentos
 * —una operación capturada de madrugada en un huso por delante de Fráncfort
 * puede esperar medio día— para recibir exactamente el mismo 503.
 *
 * Una hora, plana y sin exponencial. La fuente se observa al menos una vez al
 * comenzar cada día natural en Fráncfort, así que una hora acota la espera
 * inútil a unos pocos intentos y sigue recuperando pronto si la ingesta llegó
 * tarde. **No se toca nada más**: la entrada sigue siendo `retryable`, con su
 * misma clave, así que ni se da por buena ni se duplica la operación.
 */
export const FX_PENDING_DELAY_MS = 3_600_000;

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

/**
 * Cuándo reintentar una entrada que espera una fijación.
 *
 * No depende de los intentos: el plazo no es una penalización creciente, es
 * cuánto tarda en poder cambiar la respuesta.
 */
export function fxPendingAttemptAt(clock: Clock): string {
  return new Date(clock.now() + FX_PENDING_DELAY_MS).toISOString();
}

/** Si ya venció el plazo de una entrada. Sin `next_attempt_at`, se puede ya. */
export function isDue(nextAttempt: string | null, clock: Clock): boolean {
  if (nextAttempt === null) return true;
  const due = Date.parse(nextAttempt);
  // Una fecha ilegible no puede bloquear una entrada para siempre: se intenta.
  return Number.isNaN(due) || due <= clock.now();
}
