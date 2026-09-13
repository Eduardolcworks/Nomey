/**
 * LO TECLEADO, CONVERTIDO A UNIDADES MENORES DE SU MONEDA.
 *
 * **Toda la conversión es sobre texto y `bigint`.** El separador se admite en
 * las dos formas que un teclado puede producir —coma y punto—, la parte decimal
 * se rellena o se rechaza según la escala de la moneda, y en ningún momento hay
 * un `Number` por medio: `parseFloat('0.29') * 100` da `28.999999999999996`, y
 * ése es exactamente el error que F02/ADR-001 §1 prohíbe.
 *
 * **La escala viene de la definición monetaria**, nunca fijada a dos: JPY tiene
 * 0, BHD tiene 3, y la misma función tiene que servir para las tres.
 *
 * ═══════════ POR QUÉ VIVE EN `domain/` Y NO EN UNA PANTALLA ═══════════
 *
 * Es la frontera entre lo que una persona escribe y un importe exacto, y esa
 * traducción es una regla monetaria, no una decisión de presentación: si dos
 * pantallas la implementaran por su cuenta, una podría redondear el tercer
 * decimal y la otra rechazarlo, y las dos parecerían correctas. Estuvo en
 * `features/personal` mientras sólo la usaba el Modo Personal; el gasto
 * compartido la necesita igual, y una feature no puede leer de otra.
 *
 * Devuelve `null` si el texto no es un importe válido. Un importe de cero
 * también suele ser inadmisible, pero eso lo decide quien valida el formulario:
 * esta función sólo traduce, no juzga.
 */

const DIGITS = /^[0-9]*$/;

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
 * Y EL CAMINO DE VUELTA: de unidades menores al texto que se puede editar.
 *
 * Existe por la corrección de un movimiento. Un formulario precargado tiene que
 * enseñar lo que hay guardado, y lo que hay guardado es un entero exacto: la
 * única forma de escribirlo sin pasar por coma flotante es partir la cadena de
 * dígitos por la escala de su moneda. `Number(1000) / 100` es benigno; con
 * `2_305_843_009_213_693_951` deja de serlo, y la regla de F02/ADR-001 §1 no admite
 * excepciones por tamaño.
 *
 * **Va emparejada con `toMinorUnits`, y aquí es donde se ve por qué las dos
 * viven juntas**: lo que ésta produce, aquélla lo tiene que aceptar. Con el
 * punto como separador, que es el que la otra normaliza.
 *
 * **Los ceros de la derecha se quitan.** Un campo precargado con `10` se lee
 * como lo que alguien escribiría; `10.00` sería la misma cantidad escrita como
 * la escribe una base de datos.
 */
export function fromMinorUnits(minor: bigint, scale: number): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString();
  const sign = negative ? '-' : '';

  if (scale <= 0) return `${sign}${digits}`;

  const padded = digits.padStart(scale + 1, '0');
  const whole = padded.slice(0, padded.length - scale);
  const fraction = padded.slice(padded.length - scale).replace(/0+$/, '');

  return fraction === '' ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}
