/**
 * QUÉ ENSEÑAR EN EL BLOQUE DE DEUDAS, Y CUÁNDO NO ENSEÑAR NADA.
 *
 * **Cero, «no se sabe» y «no hay red» son TRES cosas, y sólo la primera es
 * `0,00 €`.**
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
/**
 * Lo que se sabe de las deudas del actor cuando se va a pintar la tarjeta.
 *
 * **`loaded` responde a «¿llegó el dato?», nunca a «¿hay red?».** Son cosas
 * distintas y confundirlas es el error que esta distinción existe para impedir:
 * una carga que terminó bien y no encontró ninguna deuda **sabe** que la deuda
 * es cero, y un refresco posterior que falla no lo desconoce otra vez si el
 * snapshot anterior sigue en pie.
 */
export type DebtSnapshot =
  /** No hay snapshot fiable: cargando, o falló sin dejar ninguno. */
  | { readonly loaded: false }
  /** El snapshot llegó. `amounts` es la colección de deudas, y puede ser vacía. */
  | { readonly loaded: true; readonly amounts: readonly string[] };

/**
 * Las deudas que el Modo Personal puede tener hoy: ninguna, y por estructura.
 *
 * **No es una suposición, y por eso puede producir un cero CONOCIDO.** Una
 * dimensión de deuda sólo llega a un ámbito personal a través de
 * `core.participant_user_link` —es el vínculo por el que `api.claimed_dimension`
 * atribuye las dos puntas de una deuda (ADR-016)—, esa relación **no tiene ruta
 * de escritura para nadie** salvo el propietario de la base, y hasta F10 no
 * existe el comando que la abra. Medido: cero vínculos y cero efectos de deuda
 * en ámbitos personales.
 *
 * **Lo que cambia en F9/F10 es esta constante, y nada más.** En cuanto haya
 * deudas reales se pasa la colección de verdad y `homeDebt` ya las suma, con su
 * signo, sin tocar la tarjeta ni esta lógica.
 */
export const PERSONAL_DEBT_AMOUNTS: readonly string[] = [];

/**
 * Resuelve la deuda a partir del snapshot cargado.
 *
 * Sin snapshot, desconocido. Con snapshot y **ninguna** deuda, cero de verdad —
 * que es la diferencia con dejar la tarjeta en `—` para siempre—. Con deudas,
 * su suma con signo. Y si una sola de ellas es ilegible, **desconocido**: una
 * cifra que no se puede defender no se convierte en el resto de la suma.
 */
export function homeDebt(snapshot: DebtSnapshot): DebtDisplay {
  if (!snapshot.loaded) return UNKNOWN;

  let total = 0n;
  for (const amount of snapshot.amounts) {
    const one = debtDisplay(amount);
    if (one.kind === 'unknown') return UNKNOWN;
    total += one.minor;
  }

  return { kind: 'amount', minor: total };
}

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
