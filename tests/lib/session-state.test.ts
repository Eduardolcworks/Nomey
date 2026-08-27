import { describe, expect, it } from 'vitest';

import {
  isPublic,
  isResolved,
  isSignedIn,
  RESTORING,
  type SessionState,
  SIGNED_OUT,
  stateFromUser,
  UNAVAILABLE,
} from '../../src/features/session/session-state';

/**
 * El estado de sesión, que es una unión y no un booleano.
 *
 * Lo que estas pruebas protegen no es el mapeo —que es trivial— sino la
 * distinción de la que depende todo el arranque: **«hemos mirado y no hay
 * nadie» no es lo mismo que «todavía no hemos mirado»**. Un
 * `isAuthenticated: false` no sabe decir cuál de las dos es, y las dos tienen
 * que pintar cosas distintas.
 *
 * Y una decisión de seguridad que conviene que falle aquí si alguien la
 * cambia: **`unavailable` va a la rama pública.** Enseñar el acceso a quien
 * resulta estar dentro es una molestia; lo contrario monta pantallas de
 * producto para alguien a quien no hemos podido identificar.
 */

describe('estado de sesión', () => {
  describe('mapeo desde el usuario de Supabase', () => {
    it('sin usuario es `signed-out`', () => {
      expect(stateFromUser(null)).toEqual(SIGNED_OUT);
      expect(stateFromUser(undefined)).toEqual(SIGNED_OUT);
    });

    it('con usuario es `signed-in`, y lleva el id y el email', () => {
      const state = stateFromUser({ id: 'abc-123', email: 'alguien@example.com' });

      expect(state).toEqual({
        status: 'signed-in',
        identity: { userId: 'abc-123', email: 'alguien@example.com' },
      });
    });

    it('un usuario sin email sigue siendo una sesión válida', () => {
      expect(stateFromUser({ id: 'abc-123' })).toEqual({
        status: 'signed-in',
        identity: { userId: 'abc-123', email: null },
      });
    });

    it('un id vacío NO es una sesión', () => {
      // Defensivo a propósito: una identidad vacía que pasara por buena
      // mandaría a la rama protegida a alguien sin identidad.
      expect(stateFromUser({ id: '' })).toEqual(SIGNED_OUT);
    });

    it('no expone el token: la identidad tiene exactamente dos campos', () => {
      const state = stateFromUser({ id: 'abc-123', email: 'a@b.c' });
      if (state.status !== 'signed-in') throw new Error('debería estar dentro');

      expect(Object.keys(state.identity).sort()).toEqual(['email', 'userId']);
    });
  });

  describe('qué se puede montar', () => {
    const ALL: SessionState[] = [
      RESTORING,
      SIGNED_OUT,
      UNAVAILABLE,
      { status: 'signed-in', identity: { userId: 'u', email: null } },
    ];

    it('mientras restaura no hay nada resuelto', () => {
      expect(isResolved(RESTORING)).toBe(false);
    });

    it('cualquier otra respuesta sí resuelve, incluida la mala', () => {
      expect(isResolved(SIGNED_OUT)).toBe(true);
      expect(isResolved(UNAVAILABLE)).toBe(true);
      expect(isResolved(ALL[3])).toBe(true);
    });

    it('mientras restaura NINGUNA rama es elegible', () => {
      expect(isPublic(RESTORING)).toBe(false);
      expect(isSignedIn(RESTORING)).toBe(false);
    });

    it('`unavailable` cae en la pública, nunca en la protegida', () => {
      expect(isPublic(UNAVAILABLE)).toBe(true);
      expect(isSignedIn(UNAVAILABLE)).toBe(false);
    });

    it('las dos ramas se excluyen SIEMPRE, en todos los estados', () => {
      for (const state of ALL) {
        expect(isPublic(state) && isSignedIn(state)).toBe(false);
      }
    });

    it('y todo estado resuelto tiene exactamente una rama', () => {
      for (const state of ALL.filter(isResolved)) {
        expect([isPublic(state), isSignedIn(state)].filter(Boolean)).toHaveLength(1);
      }
    });
  });
});
