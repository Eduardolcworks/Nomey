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

/*
 * ══════════ AQUÍ VIVÍA `PERSONAL_DEBT_AMOUNTS`, Y SE HA RETIRADO ══════════
 *
 * Era una colección vacía constante, justificada por una ausencia que entonces
 * era cierta: nada producía dimensión de deuda, `core.participant_user_link`
 * no tenía ruta de escritura, y la constante decía exactamente eso.
 *
 * **Dejó de ser cierta en F9.** `api.create_group` escribe el vínculo del
 * creador y `record_group_expense` asienta efectos de deuda, así que la
 * constante pasó de describir el mundo a contradecirlo: la tarjeta afirmaba
 * `0,00 €` con deudas reales encima, y como el cero era «conocido» no había
 * ningún estado que delatara el fallo.
 *
 * Quien pasa ahora la colección es la ruta de Inicio, que es la única capa que
 * puede ver Personal y Grupos a la vez. **Y no se ha sustituido por otra
 * constante**: si no hay lectura, `homeDebt` recibe `{ loaded: false }` y la
 * tarjeta dice «no disponible». La lección es la que ya estaba escrita arriba:
 * cero y desconocido son dos respuestas, y sólo una de ellas es una cifra.
 */

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
