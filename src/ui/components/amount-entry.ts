/**
 * LA CIFRA MIENTRAS SE ESCRIBE: el modelo del teclado, y nada más.
 *
 * **Es estado de edición, no dinero.** No conoce monedas, ni definiciones
 * monetarias, ni `bigint`: sólo qué dígitos lleva puestos la persona en cada
 * mitad de la cifra y en qué mitad está escribiendo. Convertir eso en un importe
 * exacto es de `domain/money` —`toMinorUnits`—, y presentarlo es de quien pinta.
 *
 * **Vive en `ui/` porque lo comparten dos dominios.** Estuvo en
 * `features/personal` mientras el Modo Personal era el único que escribía
 * cifras; el gasto compartido escribe las mismas, y una feature no puede leer de
 * otra. Aquí no hay ninguna dependencia —ni de React, ni de `lib/`, ni de
 * `domain/`—, así que la capa lo admite sin excepciones.
 *
 * Nada de lo que sigue cambia de comportamiento por la mudanza: es el mismo
 * reductor, con las mismas reglas y las mismas razones escritas.
 */

/**
 * EL IMPORTE MIENTRAS SE ESCRIBE.
 *
 * No es una cadena que se va limpiando, sino los dígitos que la persona lleva
 * puestos en cada mitad de la cifra. La diferencia importa: con una cadena hay
 * estados que se pueden escribir y no significan nada —`12,`, `,53`, `12,534`,
 * la cadena vacía—, y luego hay que acordarse de no pintarlos. Aquí **no
 * existen**: con esta forma sólo se puede representar una cantidad válida, y
 * lo que se pinta se deriva de ella.
 *
 * - `whole` son los dígitos de la parte entera, sin ceros a la izquierda.
 *   Vacío significa cero, y por eso el `0` inicial desaparece en cuanto se
 *   teclea otra cosa sin que nadie lo borre.
 * - `fraction` son los céntimos YA escritos, de cero a `scale`. Los que faltan
 *   se rellenan al pintar, nunca al guardar.
 * - `inFraction` dice si se pulsó el separador. Es lo que distingue `5` de
 *   `0,5`, y no se puede deducir de los otros dos.
 * - `seeded` marca una cantidad que llegó PRECARGADA y que nadie ha tocado
 *   todavía. Sólo la pone `amountEntryFromMinor`, se apaga en cuanto se escribe
 *   o se borra, y no participa en el valor: `amountValue` no la mira.
 */
export type AmountEntry = {
  readonly whole: string;
  readonly fraction: string;
  readonly inFraction: boolean;
  readonly seeded?: boolean;
};

export const EMPTY_AMOUNT: AmountEntry = { whole: '', fraction: '', inFraction: false };

/**
 * Un tope a la parte entera.
 *
 * No sale de ninguna regla de negocio: es lo que cabe holgadamente en un
 * `bigint` y en la pantalla, y evita que mantener pulsada una tecla construya
 * una cifra de mil dígitos. Si algún día hay un límite real, vendrá del importe
 * máximo de una operación y no de aquí.
 */
const MAX_WHOLE_DIGITS = 15;

const DIGIT = /^[0-9]$/;

function pushDigit(entry: AmountEntry, digit: string, scale: number): AmountEntry {
  if (entry.inFraction) {
    // El tercer decimal no se acepta ni se redondea: simplemente no entra.
    if (scale === 0 || entry.fraction.length >= scale) return entry;
    return { ...entry, fraction: entry.fraction + digit };
  }

  // Un cero a la izquierda no se acumula: la parte entera vacía YA se pinta
  // como cero, así que teclear ceros delante no cambia nada.
  if (entry.whole === '' && digit === '0') return entry;
  if (entry.whole.length >= MAX_WHOLE_DIGITS) return entry;
  return { ...entry, whole: entry.whole + digit };
}

function pushSeparator(entry: AmountEntry, scale: number): AmountEntry {
  // Una moneda sin decimales no tiene parte decimal a la que pasar, y un
  // segundo separador no abre una tercera mitad.
  if (scale === 0 || entry.inFraction) return entry;
  return { ...entry, inFraction: true };
}

/**
 * Borrar, y por qué son dos reglas y no una.
 *
 * Con céntimos escritos se quita el último. Sin ellos, la pulsación hace las
 * DOS cosas a la vez: sale de la parte decimal y se come un dígito entero. Si
 * sólo saliera, la persona vería exactamente la misma cifra que antes —`12,00`
 * sigue siendo `12,00`— y el botón parecería roto.
 */
export function backspaceAmount(entry: AmountEntry): AmountEntry {
  // Borrar YA es escribir: a partir de aquí la cantidad es de quien la edita, y
  // la siguiente cifra se añade en vez de sustituirla.
  const { seeded, ...touched } = entry;
  void seeded;

  if (touched.inFraction && touched.fraction.length > 0) {
    return { ...touched, fraction: touched.fraction.slice(0, -1) };
  }
  if (touched.inFraction) {
    return { whole: touched.whole.slice(0, -1), fraction: '', inFraction: false };
  }
  return { ...touched, whole: touched.whole.slice(0, -1) };
}

/** La cadena canónica: lo que ve la frontera y lo que lleva el campo oculto. */
export function amountValue(entry: AmountEntry): string {
  return entry.inFraction ? `${entry.whole}.${entry.fraction}` : entry.whole;
}

/** Las dos mitades ya listas para pintarse, con los céntimos completados. */
export function amountParts(
  entry: AmountEntry,
  scale: number,
): {
  whole: string;
  fraction: string;
} {
  return {
    whole: entry.whole === '' ? '0' : entry.whole,
    fraction: entry.fraction.padEnd(scale, '0'),
  };
}

/** Si hay algo escrito, para decidir si la cifra se pinta apagada o encendida. */
export function amountTouched(entry: AmountEntry): boolean {
  return entry.whole !== '' || entry.inFraction;
}

/** Puesto por la persona, o todavía pendiente de que lo ponga. */
export type AmountTone = 'entered' | 'pending';

/**
 * QUÉ PARTE DE LA CIFRA YA ES SUYA.
 *
 * La cifra siempre se lee entera —`5,00` y no `5`—, y sin esto no habría forma
 * de distinguir los ceros que la persona escribió de los que están ahí para
 * completar la forma. Un `5,00` todo en blanco afirma que hay cero céntimos
 * puestos a mano; y no los hay.
 *
 * Tres piezas y tres condiciones, todas derivadas del MISMO estado de edición.
 * No hay una segunda verdad de presentación que pueda desincronizarse: si
 * borrar devuelve el editor a la parte entera, los tonos vuelven solos.
 *
 * - **El entero** se enciende en cuanto hay algo escrito, y eso incluye haber
 *   pulsado sólo el separador: `0,` ya es una cantidad que se está escribiendo.
 * - **El separador** se enciende al pulsarlo. Es lo que dice «ahora van los
 *   céntimos» sin necesidad de un cursor.
 * - **Los céntimos** se encienden con el PRIMERO, los dos a la vez. En cuanto
 *   se empieza a escribir la fracción, la fracción entera es suya: dejar el
 *   segundo cero apagado en `53,40` lo leería como un hueco, cuando lo que
 *   queda es una cantidad terminada a la que aún se le puede añadir un dígito.
 *
 * ================ UNA CANTIDAD PRECARGADA TODAVÍA NO ES SUYA ================
 *
 * `seeded` apaga las tres a la vez, y es lo que iguala corregir un movimiento
 * con editar el Disponible. Allí el importe anterior se enseña como
 * `reference` sobre un editor vacío, así que sale apagado por no haber nada
 * escrito; aquí el importe anterior **es** el borrador, y sin esto salía
 * encendido desde el primer fotograma: la misma ventana afirmaba dos cosas
 * distintas según de dónde viniera la cifra.
 *
 * La condición es la misma en los dos casos —**lo que se ve, ¿lo ha puesto
 * quien edita?**— y por eso vive aquí y no en cada ventana. Se apaga sola: la
 * primera tecla parte de vacío y el borrado retira `seeded`, así que en cuanto
 * se toca la cifra las tres reglas de arriba vuelven a mandar.
 */
export function amountTones(entry: AmountEntry): {
  whole: AmountTone;
  separator: AmountTone;
  fraction: AmountTone;
} {
  const tone = (on: boolean): AmountTone => (on && entry.seeded !== true ? 'entered' : 'pending');

  return {
    whole: tone(amountTouched(entry)),
    separator: tone(entry.inFraction),
    fraction: tone(entry.fraction.length > 0),
  };
}

/**
 * Si la cantidad está terminada, que es cuando el teclado sobra.
 *
 * **Generalizado por escala, no fijado a dos.** «Terminada» significa que los
 * céntimos están completos, y cuántos son lo dice la moneda: dos en euros, tres
 * en dinares, y en yenes —escala 0— **nunca**, porque no hay parte decimal que
 * completar y cerrar el teclado por sorpresa mientras se escribe una cifra
 * entera sería justo lo contrario de lo que se pide.
 */
export function amountComplete(entry: AmountEntry, scale: number): boolean {
  return scale > 0 && entry.fraction.length === scale;
}

/** Relee una cadena cualquiera —un pegado— y se queda con lo que es cantidad. */
function fromRaw(raw: string, scale: number): AmountEntry {
  const kept = raw.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
  // Manda el ULTIMO separador, no el primero: en `1.234,56` el punto agrupa
  // millares y la coma separa decimales, y en `1,234.56` es al reves. Los
  // decimales son siempre el grupo final, asi que el ultimo acierta en las dos;
  // el primero convertia `1.234,56` en `1,23` — medido.
  const cut = kept.lastIndexOf('.');

  const wholeRaw = (cut === -1 ? kept : kept.slice(0, cut)).replace(/\./g, '');
  const fractionRaw = cut === -1 ? '' : kept.slice(cut + 1).replace(/\./g, '');

  const whole = wholeRaw.replace(/^0+/, '').slice(0, MAX_WHOLE_DIGITS);
  const inFraction = cut !== -1 && scale > 0;

  return { whole, fraction: inFraction ? fractionRaw.slice(0, scale) : '', inFraction };
}

/**
 * Los caracteres que `next` tiene y `current` no, en su orden: el prefijo
 * común por delante y el sufijo común por detrás se descartan, y lo de en
 * medio es lo insertado. Para una inserción en un solo punto —que es lo único
 * que un teclado produce— es exacto.
 */
function inserted(current: string, next: string): string {
  let start = 0;
  while (start < current.length && current[start] === next[start]) start += 1;
  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
    endCurrent -= 1;
    endNext -= 1;
  }
  return next.slice(start, endNext);
}

/**
 * Lo que llega del campo, convertido en un cambio de estado.
 *
 * **El campo es sólo un capturador de teclado.** Su texto es invisible y su
 * cursor está oculto, así que la persona nunca edita por el medio: sólo añade
 * al final o borra. Eso es lo que permite leer la intención comparando lo que
 * llega con lo que había, en vez de intentar reconstruirla del texto.
 *
 * Tres casos, y el orden importa:
 *
 * 1. **Más corto** — se ha borrado. Una pulsación, una regla de borrado.
 * 2. **Empieza por lo que había** — se ha añadido al final: se alimenta carácter
 *    a carácter, de modo que un pegado de varios entra por las mismas reglas
 *    que teclearlos, incluido el tope de decimales.
 * 3. **Cualquier otra cosa** — un pegado que sustituye: se relee entero.
 */
export function applyAmountInput(entry: AmountEntry, next: string, scale: number): AmountEntry {
  const current = amountValue(entry);

  if (next.length < current.length) return backspaceAmount(entry);

  /*
   * ═══════ UNA PRECARGADA SE SUSTITUYE ESTÉ DONDE ESTÉ EL CURSOR ═══════
   *
   * El caso 2 de abajo ya sustituía la cantidad sembrada… si lo tecleado
   * llegaba AL FINAL. Pero el cursor del campo está oculto, no controlado: en
   * iOS un toque lo deja donde se tocó, y una cifra insertada por delante o
   * por el medio de `35` no «empieza por lo que había»: caía en el caso 3 y se
   * releía entera —`135`— como si la persona hubiera escrito los tres. Con una
   * cantidad precargada la intención es una sola, la de una selección
   * completa: lo tecleado, sea donde sea, empieza de vacío. Se toman los
   * caracteres nuevos —los que no estaban— y se alimentan uno a uno desde
   * `EMPTY_AMOUNT`, con las mismas reglas de dígitos y separador.
   */
  if (entry.seeded === true && next.length > current.length) {
    let out: AmountEntry = EMPTY_AMOUNT;
    for (const ch of inserted(current, next)) {
      if (DIGIT.test(ch)) out = pushDigit(out, ch, scale);
      else if (ch === '.' || ch === ',') out = pushSeparator(out, scale);
    }
    return out;
  }

  if (next.startsWith(current)) {
    let out = entry;
    for (const ch of next.slice(current.length)) {
      /*
       * UNA CANTIDAD PRECARGADA SE COMPORTA COMO UNA SELECCIÓN COMPLETA: la
       * primera cifra la sustituye.
       *
       * Sin esto no se podía corregir un importe. `amountEntryFromMinor` siembra
       * los céntimos COMPLETOS y `inFraction: true`, que es exactamente el
       * estado que `pushDigit` rechaza por la regla del tercer decimal — así que
       * cada tecla devolvía el mismo objeto, el campo controlado volvía a su
       * texto y la cifra se quedaba clavada con el teclado abierto.
       *
       * **La regla del tercer decimal no se toca**: sigue rechazando el tercero
       * cuando los dos los ha escrito la persona. Lo que se distingue es de
       * dónde viene la cantidad, y eso no se podía deducir de sus dígitos.
       */
      const desde = out.seeded === true ? EMPTY_AMOUNT : out;

      if (DIGIT.test(ch)) out = pushDigit(desde, ch, scale);
      else if (ch === '.' || ch === ',') out = pushSeparator(desde, scale);
      // Cualquier otra cosa —letras, signos— se ignora en silencio: el signo lo
      // pone la clase de movimiento, no quien escribe.
    }
    return out;
  }

  return fromRaw(next, scale);
}

/**
 * El importe de una versión vigente, listo para el editor.
 *
 * **Sobre texto, nunca sobre `number`.** Las unidades mínimas llegan como
 * cadena (F03/ADR-005 §1) y se parten por posición según la escala de la moneda: un
 * `parseInt` por medio devolvería un `double` y perdería la garantía por encima
 * de 2^53 sin que nada fallara.
 *
 * **Y se alimenta del importe DECLARADO, no del firmado.** `original_amount` es
 * la magnitud que la persona escribió —positiva en las dos clases—, mientras
 * que `balance_amount` lleva el signo que la clase le da al saldo. Precargar el
 * segundo pondría un menos en el editor de un gasto, que es exactamente lo que
 * el formulario no pide.
 */
export function amountEntryFromMinor(minor: string, scale: number): AmountEntry {
  const magnitude = minor.startsWith('-') ? minor.slice(1) : minor;
  const digits = magnitude.padStart(scale + 1, '0');
  const cut = digits.length - scale;
  return {
    whole: digits.slice(0, cut),
    fraction: scale === 0 ? '' : digits.slice(cut),
    // Con céntimos ya escritos, el editor arranca en la parte decimal: es
    // donde estaba el cursor lógico cuando se guardó.
    inFraction: scale > 0,
    /*
     * PRECARGADA Y SIN TOCAR, que es lo que la hace volver a ser escribible.
     *
     * La cantidad llega con los céntimos completos, así que sin esta marca
     * quedaría saturada y ninguna cifra entraría —era el fallo—. Marcarla aquí
     * y no en quien la consume es lo correcto: el hecho que se declara es que
     * la cantidad NO la ha escrito la persona, y eso lo sabe quien la siembra.
     *
     * No afecta al valor. `amountValue`, `toMinorUnits` y `sameEntry` no la
     * miran, así que la referencia apagada de «Editar disponible» —que usa esta
     * misma función y nunca pasa por el reductor— se pinta igual que antes.
     */
    seeded: true,
  };
}

/**
 * ═══════════ EL CAMPO, COMO ESTADO: texto, entrada y caret ═══════════
 *
 * **Lo que la máquina de arriba no puede saber: dónde deja iOS el cursor.**
 *
 * El campo nativo es controlado. Cuando JavaScript le manda un texto distinto
 * del que tiene, React Native en iOS conserva el cursor **relativo al FINAL del
 * texto anterior** (`RCTBaseTextInputView setAttributedText:`): con `101` y el
 * cursor al final queda al final de `1`; pero con `110` —la persona tocó la
 * cifra por delante y tecleó ahí— el cursor estaba a 2 del final, y en `1`
 * «2 del final» es **antes del principio**: cae en 0. La siguiente tecla, `2`,
 * se inserta delante y el campo entrega `21`. Medido en el iPhone: 10 → «1»,
 * «2» → 21. El reductor no podía verlo, porque le llega texto y no cursor.
 *
 * La corrección es de SELECCIÓN, no de texto: tras sustituir una cantidad
 * precargada, el campo fija el cursor al final UNA vez —`pinToEnd`— por la
 * prop `selection`, y lo suelta en cuanto el nativo confirma la posición. Ni
 * invertir cadenas, ni temporizadores, ni remontar nada. A partir de ahí el
 * cursor es de la persona, como siempre.
 *
 * `amountFieldStep` es esa regla, pura, para que una prueba pueda reproducir la
 * secuencia de eventos del teléfono —texto que entrega el nativo, actualización
 * controlada, regla del cursor de React Native— y no sólo llamadas ideales al
 * reductor.
 */
export type AmountFieldState = {
  readonly entry: AmountEntry;
  /** Fijar el cursor al final en el siguiente render. Se suelta al confirmarse. */
  readonly pinToEnd: boolean;
};

/** Lo que el campo hace con el texto que entrega el nativo. */
export function amountFieldStep(
  state: AmountFieldState,
  nativeText: string,
  scale: number,
): AmountFieldState {
  const moved = applyAmountInput(state.entry, nativeText, scale);
  // Sólo al sustituir una precargada: es el único momento en que el texto
  // controlado deja de parecerse al que el nativo tenía.
  const replaced = state.entry.seeded === true && moved.seeded !== true;
  return { entry: moved, pinToEnd: state.pinToEnd || replaced };
}

/** La selección que el campo declara en este render, o ninguna. */
export function amountFieldSelection(
  state: AmountFieldState,
): { readonly start: number; readonly end: number } | undefined {
  if (!state.pinToEnd) return undefined;
  const end = amountValue(state.entry).length;
  return { start: end, end };
}
