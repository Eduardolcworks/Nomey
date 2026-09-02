import type { CalendarDate } from '@/lib/format';

/**
 * Qué se está registrando, y qué contrato le corresponde.
 *
 * `transfer` está en la lista porque el selector la ofrece, **no** porque haya
 * una ruta de escritura para ella. La razón está en `canRecord`, que es donde
 * un futuro contrato tendría que entrar, y no en un comentario suelto.
 */
export type EntryKind = 'expense' | 'income' | 'transfer';

export const ENTRY_KINDS: readonly EntryKind[] = ['expense', 'income', 'transfer'];

/** Lo que abre el `+`: un gasto, que es lo que se registra casi siempre. */
export const INITIAL_ENTRY_KIND: EntryKind = 'expense';

/**
 * Si esta clase tiene hoy una ruta de escritura cerrada.
 *
 * **Transferencia no la tiene, y no es un descuido.** Existen dos funciones en
 * `api` que se llaman transferencia y ninguna sirve para esta pantalla:
 *
 * - `record_internal_transfer` exige `from_scope_id` y `to_scope_id`
 *   **distintos**, y en la Fase 6 una persona tiene exactamente un ámbito. No
 *   hay segundo ámbito al que mover nada hasta que existan Grupos o Pareja.
 * - `record_external_transfer` sí acepta un solo ámbito, pero su payload
 *   admite `scope_id`, `delta`, moneda y fecha, y **nada más**: no lleva
 *   concepto ni hora. Cablearla desde aquí tiraría en silencio el concepto que
 *   la persona acaba de escribir.
 *
 * Inventar una tercera sería inventar una operación económica nueva, que es
 * exactamente lo que no se hace sin decisión.
 */
export function canRecord(kind: EntryKind): boolean {
  return kind === 'expense' || kind === 'income';
}

/** Si la categoría forma parte del contrato de esta clase (ADR-027 §3). */
export function usesCategory(kind: EntryKind): boolean {
  return kind === 'expense';
}

/**
 * Lo que la persona ha escrito, tal cual, antes de validarse.
 *
 * El importe se guarda como **texto**: es lo que se teclea, y convertirlo a
 * número en cada pulsación introduciría un `Number` en el camino de un valor
 * monetario justo donde ADR-003 dice que no.
 */
export type EntryDraft = {
  readonly kind: EntryKind;
  readonly amount: string;
  readonly concept: string;
  readonly categoryId: string | null;
  readonly date: CalendarDate;
  readonly time: string;
};

/** Por qué todavía no se puede guardar. `null` significa que sí se puede. */
export type EntryBlocker =
  'noRoute' | 'noScope' | 'amountMissing' | 'amountInvalid' | 'conceptMissing' | 'categoryMissing';

const DIGITS = /^[0-9]*$/;

/**
 * El importe tecleado, en unidades menores de su moneda.
 *
 * **Toda la conversión es sobre texto y `bigint`.** El separador se admite en
 * las dos formas que un teclado puede producir —coma y punto—, la parte
 * decimal se rellena o se rechaza según la escala de la moneda, y en ningún
 * momento hay un `Number` por medio: `parseFloat('0.29') * 100` da
 * `28.999999999999996`, y ese es exactamente el error que ADR-003 §1 prohíbe.
 *
 * **La escala viene de la definición monetaria**, nunca fijada a dos: JPY tiene
 * 0 y la misma pantalla tiene que servir.
 *
 * Devuelve `null` si el texto no es un importe válido. Un importe de cero
 * también es inválido aquí, pero eso lo decide `blockerFor`: esta función sólo
 * traduce, no juzga.
 */
export function toMinorUnits(input: string, scale: number): bigint | null {
  const trimmed = input.trim().replace(',', '.');
  if (trimmed === '') return null;

  const parts = trimmed.split('.');
  if (parts.length > 2) return null;

  const whole = parts[0] === '' ? '0' : parts[0];
  const fraction = parts[1] ?? '';

  if (!DIGITS.test(whole) || !DIGITS.test(fraction)) return null;
  // Más decimales de los que la moneda tiene NO se redondean en silencio: un
  // céntimo perdido sin avisar es peor que un rechazo.
  if (fraction.length > scale) return null;

  const padded = fraction.padEnd(scale, '0');
  return BigInt(`${whole}${padded}`);
}

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
 * Qué impide guardar, en el orden en que la pantalla debería resolverlo.
 *
 * Se devuelve **uno** y no una lista: el botón dice una cosa, y enumerar tres
 * problemas a la vez sobre un formulario de cuatro campos es ruido.
 */
export function blockerFor(
  draft: EntryDraft,
  scale: number,
  hasScope: boolean,
): EntryBlocker | null {
  if (!canRecord(draft.kind)) return 'noRoute';
  if (!hasScope) return 'noScope';

  if (draft.amount.trim() === '') return 'amountMissing';
  const minor = toMinorUnits(draft.amount, scale);
  if (minor === null || minor <= 0n) return 'amountInvalid';

  if (draft.concept.trim() === '') return 'conceptMissing';
  if (usesCategory(draft.kind) && draft.categoryId === null) return 'categoryMissing';

  return null;
}

/**
 * El payload de la frontera, ya con la forma que admite cada clase.
 *
 * **La categoría entra sólo en el gasto**, y no por un `if` de presentación:
 * un ingreso que la lleve se rechaza por FORMA del payload —`PAYLOAD_INVALID`,
 * antes de mirar a qué apunta el identificador— porque `category_id` dejó de
 * ser un campo admisible de su contrato (ADR-027 §3).
 *
 * **El importe sale como texto** y el `bigint` no llega a cruzar JSON: ADR-008
 * §1 no admite un número donde hay dinero.
 */
export type EntryPayload = {
  readonly client_operation_id: string;
  readonly command_contract_version: 2;
  readonly scope_id: string;
  readonly currency_definition_id: string;
  readonly amount: string;
  readonly effective_date: string;
  readonly effective_time: string;
  readonly concept: string;
  readonly category_id?: string;
  /**
   * Los dos campos que convierten un alta en una CORRECCIÓN.
   *
   * **Es la misma función de la frontera**, y no un writer aparte: crear y
   * corregir comparten `api.record_personal_expense` y
   * `api.record_personal_income`, y lo que las distingue es que el payload
   * traiga estos dos. Con ellos, `sec.lock_and_cas` comprueba que la versión
   * que se dice corregir siga siendo la vigente y encadena la nueva detrás.
   *
   * Ausentes, es un alta. Presentes, una corrección de esa misma operación —
   * nunca una operación nueva, y nunca un `UPDATE` sobre la anterior.
   */
  readonly operation_id?: string;
  readonly expected_version_id?: string;
};

/** La versión que se está corrigiendo. Ausente en un alta. */
export type EntryTarget = {
  readonly operationId: string;
  readonly expectedVersionId: string;
};

export function buildPayload(
  draft: EntryDraft,
  scope: { scopeId: string; currencyDefinitionId: string; currencyScale: number },
  clientOperationId: string,
  target?: EntryTarget,
): EntryPayload | null {
  if (blockerFor(draft, scope.currencyScale, true) !== null) return null;

  const minor = toMinorUnits(draft.amount, scope.currencyScale);
  if (minor === null) return null;

  const base = {
    client_operation_id: clientOperationId,
    command_contract_version: 2,
    scope_id: scope.scopeId,
    currency_definition_id: scope.currencyDefinitionId,
    amount: minor.toString(),
    effective_date: draft.date,
    effective_time: draft.time,
    concept: draft.concept.trim(),
  } as const;

  const withCategory =
    usesCategory(draft.kind) && draft.categoryId !== null
      ? { ...base, category_id: draft.categoryId }
      : base;

  /*
   * La corrección se declara AÑADIENDO dos campos, no cambiando de función.
   * Lo demás del payload es idéntico al de un alta, así que no hay dos formas
   * de describir el mismo movimiento que puedan separarse.
   */
  return target === undefined
    ? withCategory
    : {
        ...withCategory,
        operation_id: target.operationId,
        expected_version_id: target.expectedVersionId,
      };
}

/**
 * El importe de una versión vigente, listo para el editor.
 *
 * **Sobre texto, nunca sobre `number`.** Las unidades mínimas llegan como
 * cadena (ADR-008 §1) y se parten por posición según la escala de la moneda: un
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
 * Si dos borradores describen el MISMO movimiento.
 *
 * Sirve para no escribir una versión que no corrige nada: abrir el editor,
 * mirar y cerrar no debe dejar una v2 idéntica a la v1 en el historial.
 *
 * **Compara la forma canónica, no lo que se ve.** El importe se compara en
 * unidades mínimas —así `5`, `5,0` y `5,00` son el mismo importe— y el concepto
 * recortado, que es exactamente lo que `buildPayload` acaba mandando. Comparar
 * las cadenas del formulario daría por distinto un espacio de más.
 */
export function sameEntry(a: EntryDraft, b: EntryDraft, scale: number): boolean {
  const left = toMinorUnits(a.amount, scale);
  const right = toMinorUnits(b.amount, scale);

  return (
    a.kind === b.kind &&
    left !== null &&
    right !== null &&
    left === right &&
    a.concept.trim() === b.concept.trim() &&
    (a.categoryId ?? '') === (b.categoryId ?? '') &&
    a.date === b.date &&
    a.time === b.time
  );
}

/**
 * La hora efectiva de ahora mismo, `HH:MM`, en el reloj **local**.
 *
 * Local y no UTC por lo mismo que `todayInDeviceCalendar`: el par fecha+hora es
 * un reloj de pared (ADR-020 §3), y tomarla en UTC pondría a media Europa una
 * cena de las 22:30 al día siguiente.
 */
export function currentClockTime(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** La fecha de un `Date` del selector nativo, en el calendario del aparato. */
export function calendarDateOf(value: Date): CalendarDate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` as CalendarDate;
}

/** Un `CalendarDate` de vuelta a `Date`, para dárselo al selector nativo. */
export function dateFromCalendar(value: CalendarDate): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}
