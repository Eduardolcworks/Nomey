import { fail } from '../errors';
import type { CurrencyDefinition } from './currency-definition';
import { sameCurrencyDefinition } from './currency-definition';

/**
 * Un importe monetario exacto.
 *
 * `minor` es un entero en la unidad mínima de su definición monetaria: 86,20 €
 * son `8620n`. ADR-003 §2. **Nunca `number`**, ni siquiera para valores
 * pequeños: la regla es del tipo, no del tamaño.
 */
export interface Money {
  readonly minor: bigint;
  readonly currency: CurrencyDefinition;
}

export function money(minor: bigint, currency: CurrencyDefinition): Money {
  return Object.freeze({ minor, currency });
}

/**
 * Construye desde la representación textual de la unidad mínima.
 *
 * Es la forma en que los importes cruzan cualquier frontera —vectores de
 * prueba incluidos— porque un número JSON grande se degrada al parsearse.
 */
export function moneyFromMinorString(minor: string, currency: CurrencyDefinition): Money {
  let parsed: bigint;
  try {
    parsed = BigInt(minor);
  } catch {
    fail('MONEY_MINOR_NOT_INTEGER', `No es un entero en unidad mínima: "${minor}"`);
  }
  return money(parsed, currency);
}

/**
 * Representación textual exacta de la unidad mínima.
 *
 * **No es formateo.** Dar «1.234,56 €» depende del locale y vive en
 * `lib/format`; aquí solo se produce el entero como texto.
 */
export function moneyToMinorString(value: Money): string {
  return value.minor.toString();
}

function assertSameCurrency(a: Money, b: Money): void {
  if (!sameCurrencyDefinition(a.currency, b.currency)) {
    fail(
      'MONEY_CURRENCY_MISMATCH',
      `No se pueden combinar importes de definiciones monetarias distintas: ${a.currency.id} y ${b.currency.id}`,
    );
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export function negateMoney(value: Money): Money {
  return money(-value.minor, value.currency);
}

export function absMoney(value: Money): Money {
  return money(value.minor < 0n ? -value.minor : value.minor, value.currency);
}

/** −1, 0 o 1. Lanza si las definiciones monetarias difieren. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.minor < b.minor) return -1;
  if (a.minor > b.minor) return 1;
  return 0;
}

export function moneyEquals(a: Money, b: Money): boolean {
  return sameCurrencyDefinition(a.currency, b.currency) && a.minor === b.minor;
}

export function isZeroMoney(value: Money): boolean {
  return value.minor === 0n;
}

export function isNegativeMoney(value: Money): boolean {
  return value.minor < 0n;
}

export function zeroMoney(currency: CurrencyDefinition): Money {
  return money(0n, currency);
}

/**
 * Suma una lista de importes.
 *
 * `currency` es obligatorio si la lista puede estar vacía: sin él no existe un
 * cero que devolver, y **inventar una moneda sería exactamente la agregación
 * silenciosa que ADR-003 §3 prohíbe**.
 */
export function sumMoney(values: readonly Money[], currency?: CurrencyDefinition): Money {
  if (values.length === 0) {
    if (currency === undefined) {
      fail(
        'MONEY_SUM_WITHOUT_CURRENCY',
        'Sumar una lista vacía exige indicar la definición monetaria del cero',
      );
    }
    return zeroMoney(currency);
  }

  return values.reduce((acc, value) => addMoney(acc, value));
}
