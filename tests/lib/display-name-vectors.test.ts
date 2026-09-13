import { describe, expect, it } from 'vitest';

import vectors from '../vectors/display-names.json';
import { normaliseName } from '../../src/features/groups/group-draft';

/**
 * LA PARIDAD DEL NOMBRE CANONICO, mitad cliente.
 *
 * Los mismos vectores los reproduce PostgreSQL en la seccion F de
 * `supabase/checks/group-provisioning.sql`, contra `sec.canonical_display_name`.
 * Ninguna de las dos implementaciones importa a la otra: la paridad se garantiza
 * con estos casos, igual que F01/ADR-001 §7 y F03/ADR-006 §1 hacen con el dominio
 * monetario.
 *
 * **Importa porque el valor canonico entra en la intencion del comando.** Si el
 * cliente y el servidor discreparan en un espacio, un reintento legitimo se
 * leeria como una clave reutilizada — y eso ocurre horas despues, sin red de por
 * medio y sin nada que lo explique.
 */
describe('la forma canonica de un nombre visible', () => {
  it('trae vectores de verdad, no cuatro casos amables', () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(30);
    // Y cubre las tres familias que de verdad se cuelan.
    for (const id of ['nbsp', 'nfd-se-compone', 'espacio-ideografico']) {
      expect(
        vectors.cases.some((c) => c.id === id),
        id,
      ).toBe(true);
    }
  });

  it.each(vectors.cases.map((c) => [c.id, c.in, c.out] as const))('%s', (_id, entrada, salida) => {
    if (salida === null) {
      // El cliente devuelve la cadena vacia; quien decide que eso no nombra a
      // nadie es `participantIssues`, y el servidor lo rechaza por su cuenta.
      expect(normaliseName(entrada)).toBe('');
    } else {
      expect(normaliseName(entrada)).toBe(salida);
    }
  });
});
