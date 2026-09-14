import { describe, expect, it } from 'vitest';

import {
  type AmountEntry,
  amountEntryFromMinor,
  amountFieldSelection,
  amountFieldStep,
  amountValue,
  EMPTY_AMOUNT,
} from '../../src/ui/components/amount-entry';

/**
 * EL OBLONGO DE UNA CUOTA EN «Cantidad», como secuencia de eventos: al tocarlo
 * la cuota vigente se siembra como precargada, la primera tecla la sustituye,
 * y a partir de ahí lo tecleado sigue las reglas del importe total. Es la
 * misma máquina que `AmountField`; aquí se afirma el contrato del campo.
 */

/** El campo al entrar: la cuota vigente sembrada, o nada si no la hay. */
function focus(quota: bigint | null, scale: number) {
  let entry: AmountEntry =
    quota === null ? EMPTY_AMOUNT : amountEntryFromMinor(quota.toString(), scale);
  let pinned = false;
  return {
    get value() {
      return amountValue(entry);
    },
    get pinned() {
      return pinned;
    },
    // Lo que el nativo entrega tras una tecla, y lo que el campo fija.
    type(next: string): string {
      const step = amountFieldStep({ entry, pinToEnd: false }, next, scale);
      entry = step.entry;
      if (step.pinToEnd) pinned = true;
      return amountValue(entry);
    },
    caret() {
      return amountFieldSelection({ entry, pinToEnd: pinned });
    },
  };
}

describe('tocar una cuota', () => {
  it('siembra la vigente con la escala del grupo, y sin cuota no siembra nada', () => {
    expect(focus(1000n, 2).value).toBe('10.00');
    expect(focus(4n, 0).value).toBe('4');
    expect(focus(3334n, 3).value).toBe('3.334');
    expect(focus(null, 2).value).toBe('');
  });

  it('la PRIMERA cifra sustituye: 10,00 → «2» → 2 → «0» → 20, y el cursor va al final', () => {
    const field = focus(1000n, 2);
    expect(field.type('10.002')).toBe('2');
    expect(field.pinned).toBe(true);
    expect(field.caret()).toEqual({ start: 1, end: 1 });
    // Con el cursor ya al final, la segunda cifra se añade detrás.
    expect(field.type('20')).toBe('20');
  });

  it('también con el cursor por delante o en medio: lo tecleado sustituye igual', () => {
    expect(focus(1000n, 2).type('210.00')).toBe('2');
    expect(focus(1000n, 2).type('10.200')).toBe('2');
  });

  it('borrar sobre la sembrada empieza desde lo que había, no desde cero', () => {
    expect(focus(1000n, 2).type('10.0')).toBe('10.0');
  });

  it('después de empezar, separador y decimales siguen la escala', () => {
    const field = focus(1000n, 2);
    field.type('10.002');
    expect(field.type('2,')).toBe('2.');
    expect(field.type('2.5')).toBe('2.5');
    expect(field.type('2.55')).toBe('2.55');
    expect(field.type('2.555')).toBe('2.55');
    expect(field.type('2.5')).toBe('2.5');

    const yen = focus(4n, 0);
    yen.type('42');
    expect(yen.type('2.')).toBe('2');
  });

  it('vaciarlo lo deja vacío: no vale cero ni vuelve solo a automático', () => {
    const field = focus(1000n, 2);
    field.type('10.002');
    expect(field.type('')).toBe('');
  });
});
