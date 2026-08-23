import { describe, expect, it } from 'vitest';
import money from '../vectors/money.json';
import split from '../vectors/split.json';
import conversion from '../vectors/conversion.json';
import { DOMAIN_ERROR_CODES, DomainError, isDomainError, splitExpense } from '../../src/domain';
import { currency, participant } from './vectors';

/**
 * El **código** de un error de dominio es contrato entre la implementación de
 * referencia, los vectores y la futura implementación autoritativa. El mensaje
 * humano no lo es.
 */
describe('contrato de errores', () => {
  it('los códigos son únicos', () => {
    expect(new Set(DOMAIN_ERROR_CODES).size).toBe(DOMAIN_ERROR_CODES.length);
  });

  it('todo código esperado por un vector existe en el contrato', () => {
    const files = [money, split, conversion] as { cases: { expectError?: string }[] }[];
    const expected = new Set(
      files.flatMap((file) => file.cases.map((item) => item.expectError)).filter(Boolean),
    );
    expect(expected.size).toBeGreaterThan(0);
    for (const code of expected) {
      expect(DOMAIN_ERROR_CODES as readonly string[], `código ${String(code)}`).toContain(code);
    }
  });

  it('un error de dominio expone su código y es reconocible', () => {
    try {
      splitExpense({
        total: { minor: 1000n, currency: currency('eur') },
        participants: [participant('B')],
        payer: participant('A'),
        method: { kind: 'equal' },
      });
      expect.unreachable('debería haber lanzado');
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('SPLIT_PAYER_NOT_PARTICIPANT');
      // El mensaje existe pero no es contrato: no se afirma su texto.
      expect(typeof (error as DomainError).message).toBe('string');
    }
  });
});
