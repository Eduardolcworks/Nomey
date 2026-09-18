import { describe, expect, it } from 'vitest';

import vectors from '../vectors/username.json';
import {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  HANDLE_SHAPE,
  RESERVED_HANDLE_PREFIXES,
  RESERVED_HANDLES,
  isReservedHandle,
  normalizeHandle,
  validateHandle,
} from '../../src/domain';

/**
 * LA PARIDAD DEL USERNAME, mitad cliente (F12/ADR-001 §3, §4).
 *
 * Los mismos vectores los reproduce PostgreSQL en `supabase/checks/username.sql`
 * contra `sec.normalize_handle` y `sec.assert_handle_valid`. Ninguna de las dos
 * implementaciones importa a la otra: la paridad se garantiza con estos casos,
 * como F01/ADR-001 §7 hace con el reparto.
 *
 * Importa porque el cliente previsualiza y el servidor decide: si discreparan,
 * un formulario diria «vale» a un handle que el servidor rehusa —o rehusaria
 * uno que el servidor aceptaria— y nadie sabria por que. La unicidad
 * (`USERNAME_TAKEN`) no se prueba aqui: es del servidor y solo suya.
 */
describe('la sintaxis y la normalizacion del username', () => {
  it('trae vectores de verdad, no cuatro casos amables', () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(60);
    for (const id of [
      'fullwidth',
      'ligadura-fi',
      'i-con-punto-turca',
      'eszett',
      'doble-guion-bajo',
      'empieza-guion-bajo',
      'termina-guion-bajo',
      'empieza-digito',
      'largo-tras-nfkc',
      'cirilica-homoglifo',
      'nfd-se-compone-y-rehusa',
      'invalido-antes-que-reservado',
    ]) {
      expect(
        vectors.cases.some((c) => c.id === id),
        id,
      ).toBe(true);
    }
    const ids = vectors.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('las reglas del dominio son las del vector', () => {
    expect(HANDLE_MIN_LENGTH).toBe(vectors.rules.minLength);
    expect(HANDLE_MAX_LENGTH).toBe(vectors.rules.maxLength);
    expect(HANDLE_SHAPE.source).toBe(vectors.rules.shape);
    expect(vectors.rules.normalization).toBe('NFKC');
  });

  it('los reservados del dominio son exactamente los del vector: 25 exactos y 4 prefijos', () => {
    expect(vectors.reserved.exact).toHaveLength(25);
    expect(vectors.reserved.prefixes).toHaveLength(4);
    expect([...RESERVED_HANDLES].sort()).toEqual([...vectors.reserved.exact].sort());
    expect([...RESERVED_HANDLE_PREFIXES].sort()).toEqual([...vectors.reserved.prefixes].sort());
    // Y todos son, ellos mismos, handles con forma valida: si no, jamas se
    // podria intentar tomarlos y la reserva no protegeria nada.
    for (const h of [...RESERVED_HANDLES, ...RESERVED_HANDLE_PREFIXES]) {
      expect(normalizeHandle(h), h).toBe(h);
      expect(isReservedHandle(h), h).toBe(true);
    }
  });

  it.each(vectors.cases.map((c) => [c.id, c.in, c.out, c.problem] as const))(
    '%s',
    (_id, entrada, salida, problema) => {
      expect(normalizeHandle(entrada)).toBe(salida);
      const v = validateHandle(entrada);
      if (problema === null) {
        expect(v).toEqual({ ok: true, handle: salida });
      } else if (problema === 'invalid') {
        expect(v).toEqual({ ok: false, problem: 'invalid' });
      } else {
        expect(v).toEqual({ ok: false, problem: 'reserved', handle: salida });
      }
    },
  );
});
