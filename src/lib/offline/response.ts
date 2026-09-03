/**
 * LA CLASIFICACIÓN DE UNA RESPUESTA, ESCRITA DESDE LO MEDIDO.
 *
 * ADR-028 §11 hace depender de esta tabla la decisión más peligrosa de la fase
 * —si se puede o no proponer registrar el gasto otra vez— y exige por eso medir
 * la tripleta `estado HTTP · código de frontera · SQLSTATE` contra el stack
 * real antes de escribirla. La medida está en
 * `scripts/offline-taxonomy-probe.sh` y esto es su resultado:
 *
 * ```
 * éxito                    200  —                                already_processed=false
 * replay                   200  —                                already_processed=true
 * clave reusada            409  IDEMPOTENCY_KEY_REUSED
 * sin JWT                  401  42501            ← el SQLSTATE llega como código
 * JWT inválido             401  PGRST301
 * ámbito ajeno             403  NOT_AUTHORIZED   ← con sesión válida y fresca
 * payload                  400  PAYLOAD_INVALID
 * categoría inservible     422  CATEGORY_NOT_USABLE
 * moneda distinta          422  CURRENCY_CONVERSION_UNSUPPORTED
 * ```
 *
 * **`42501` NO significa «sesión caducada», y tampoco al revés.** Medido: llega
 * con **401** cuando no hay JWT —PostgREST no puede ni entrar al schema— y una
 * denegación de autorización de verdad, con sesión válida, llega con **403 y
 * `NOT_AUTHORIZED`**. Por eso **manda el estado HTTP** y el código sólo afina:
 * mapear `42501` por sí solo es exactamente el error que el ADR prohíbe.
 *
 * **Lo que no se pudo producir, y se dice:** un `403` con `42501` crudo —una
 * denegación de `GRANT` o de RLS que no pase por la frontera—. La frontera
 * autoriza antes y responde `NOT_AUTHORIZED`. El mapa lo trata igual que
 * cualquier otro `403`: autorización permanente, sin reintento. Es la lectura
 * conservadora, y sigue siendo la correcta si algún día ese caso aparece.
 */

import type { QueueEntryState } from './queue-entry';

/** Cómo llegó la sesión local en el momento de enviar. */
export type SessionStatus = 'signed-in' | 'signed-out' | 'restoring' | 'unavailable';

/**
 * Lo que el transporte pudo averiguar. Deliberadamente pobre: sólo lo que
 * existe de verdad en una respuesta, para que nadie clasifique por el texto.
 */
export type TransportOutcome =
  /** El servidor contestó 200 con su sobre. */
  | { readonly kind: 'ok'; readonly operationId: string; readonly alreadyProcessed: boolean }
  /** El servidor contestó, con estado y —si lo había— código de frontera. */
  | { readonly kind: 'http'; readonly status: number; readonly code: string | null }
  /** No hubo respuesta: sin red, DNS, TCP, plazo agotado, o el cuerpo no se pudo leer. */
  | { readonly kind: 'unreachable'; readonly reason: 'offline' | 'timeout' | 'transport' };

/** Las siete clases de ADR-028 §11. */
export type ResponseClass =
  | 'success'
  | 'transport'
  | 'authRecoverable'
  | 'authorizationPermanent'
  | 'payloadInvalid'
  | 'domainRejection'
  | 'idempotencyConflict'
  | 'currencyConflict';

export type Classification = {
  readonly responseClass: ResponseClass;
  readonly state: QueueEntryState;
  /** El código que se guarda para que F7.E pueda decir algo concreto. */
  readonly code: string | null;
};

const CURRENCY_CODES = [
  'CURRENCY_CONVERSION_UNSUPPORTED',
  'CURRENCY_NOT_SUPPORTED',
  'CURRENCY_CODE_AMBIGUOUS',
] as const;

function classified(
  responseClass: ResponseClass,
  state: QueueEntryState,
  code: string | null,
): Classification {
  return { responseClass, state, code };
}

/**
 * Clasifica una respuesta, con los tres datos que de verdad existen.
 *
 * El orden de las reglas importa y no es alfabético:
 *
 * 1. **Sin respuesta, el resultado es DESCONOCIDO.** Es la regla que impide
 *    duplicar dinero: el servidor pudo haberla ejecutado, así que se reintenta
 *    con la misma clave y no se toca nada más.
 * 2. **La sesión local se consulta ANTES que el estado.** Si no estamos
 *    `signed-in`, el 401 que acaba de llegar es de sesión y no de permisos,
 *    diga lo que diga el código.
 * 3. **Manda el estado HTTP.** 401 es autenticación; 403, autorización. El
 *    código afina dentro de 4xx y nunca cambia esa lectura.
 * 4. **Lo que no encaje cae en la fila más conservadora**, nunca en la más
 *    cómoda: resultado desconocido → `retryable`; terminal indemostrable →
 *    `review`.
 */
export function classifyResponse(
  outcome: TransportOutcome,
  session: SessionStatus,
): Classification {
  if (outcome.kind === 'ok') return classified('success', 'confirmed', null);

  if (outcome.kind === 'unreachable') {
    // Nunca `rejected`: sin respuesta no se puede demostrar que no haya efectos.
    return classified('transport', 'retryable', outcome.reason);
  }

  const { status, code } = outcome;

  if (session !== 'signed-in') return classified('authRecoverable', 'blocked_session', code);

  if (status === 401) return classified('authRecoverable', 'blocked_session', code);
  if (status === 403) {
    // Con sesión válida y fresca, un 403 es una denegación real de autorización
    // —medido: `NOT_AUTHORIZED`— y reintentarlo sólo sería un bucle.
    return classified('authorizationPermanent', 'rejected', code);
  }

  if (status === 408 || status === 429 || status >= 500) {
    return classified('transport', 'retryable', code);
  }

  if (code === 'IDEMPOTENCY_KEY_REUSED') {
    /*
     * NO se puede demostrar que no haya efectos: esa clave la usó otra
     * intención, y crear una nueva podría duplicar una operación existente.
     * Es la única fila que va a `review`.
     */
    return classified('idempotencyConflict', 'review', code);
  }

  if (code !== null && (CURRENCY_CODES as readonly string[]).includes(code)) {
    return classified('currencyConflict', 'conflict', code);
  }

  if (code === 'PAYLOAD_INVALID') return classified('payloadInvalid', 'rejected', code);

  if (status === 400 || status === 422 || status === 409) {
    /*
     * El resto de 4xx con código de frontera son rechazos de dominio: la
     * frontera respondió de forma terminal ANTES de escribir, así que la
     * ausencia de efectos sí es demostrable.
     */
    if (code !== null) return classified('domainRejection', 'rejected', code);
  }

  /*
   * Un 4xx sin código, o cualquier estado que no encaje. El servidor respondió
   * de forma terminal pero no hay con qué demostrar que no produjo efectos, así
   * que **no** se propone repetir el gasto: revisión.
   */
  return classified('idempotencyConflict', 'review', code);
}
