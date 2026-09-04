/**
 * QUÉ ENSEÑAR EN EL BLOQUE DE DEUDAS, Y CUÁNDO NO ENSEÑAR NADA.
 *
 * **Cero y «no se sabe» son dos respuestas distintas, y sólo una es `0,00 €`.**
 * «No debes nada» es un hecho sobre el dinero de alguien; «todavía no hay dato»
 * no lo es. Presentar el segundo como el primero es afirmar una cifra contable
 * que nadie ha derivado — exactamente lo que `AGENTS.md` §1 llama un valor de
 * registro y lo que `design-direction.md` exige que nunca sea ambiguo cuando se
 * trata de una deuda.
 *
 * **El fallo que corrige.** Hasta F8.A4 la tarjeta tenía un
 * `DEBT_PLACEHOLDER = '0'` de interfaz aplicado como parámetro por defecto, y
 * nadie pasaba la deuda. El resultado no era «sin conexión sale mal»: era que
 * salía `0,00 €` **siempre**, con servidor y sin él. Se vio en un arranque en
 * frío sin frontera sólo porque allí el resto de la tarjeta degradaba a `—` y
 * el contraste lo delató.
 *
 * **Un texto ilegible es desconocido, nunca cero.** Es la diferencia con
 * `toMinor`, que devuelve `0n` ante cualquier cosa que no parsee — decisión
 * correcta para un total de gastos, donde un cero visible es diagnosticable, y
 * equivocada para una deuda, donde el cero **es** una de las respuestas
 * legítimas y por tanto no puede significar además «no lo sé».
 *
 * **Nada de esto decide de dónde sale el dato.** El Modo Personal no tiene
 * dimensión de deuda hasta F9, y el vínculo que la traería —
 * `core.participant_user_link`— está vacío hasta F10. Cuando llegue, lo único
 * que cambia es quién pasa el valor: cero seguirá siendo cero, y ausente
 * seguirá siendo desconocido, sin tocar esta función.
 */

/** La deuda neta, resuelta a lo que la tarjeta puede afirmar. */
export type DebtDisplay =
  /** No hay información durable de deuda para este actor. */
  | { readonly kind: 'unknown' }
  /**
   * Hay un dato fiable. `minor` va con signo y en unidad mínima, con el mismo
   * criterio que los efectos de deuda de `core`: negativo = debes, positivo =
   * te deben, cero = en paz.
   */
  | { readonly kind: 'amount'; readonly minor: bigint };

const UNKNOWN: DebtDisplay = { kind: 'unknown' };

/**
 * Resuelve qué se puede afirmar sobre la deuda.
 *
 * Ausente —`null` o `undefined`— es desconocido. Un `'0'` explícito es cero de
 * verdad y se muestra como tal. Y un texto que no es un entero es desconocido,
 * porque no hay ninguna cifra que se pueda defender.
 */
export function debtDisplay(debt: string | null | undefined): DebtDisplay {
  if (debt === null || debt === undefined) return UNKNOWN;

  /*
   * `BigInt('')` y `BigInt('   ')` devuelven `0n` SIN lanzar. Es el mismo
   * colapso de «no hay dato» a «cero», entrando por otra puerta: una cadena
   * vacía es exactamente lo que llega de un campo que no vino. Se descarta
   * antes de intentar convertir nada.
   */
  if (debt.trim() === '') return UNKNOWN;

  try {
    return { kind: 'amount', minor: BigInt(debt) };
  } catch {
    return UNKNOWN;
  }
}
