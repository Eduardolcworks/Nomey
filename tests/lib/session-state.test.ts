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

    it('con usuario es `signed-in`, y lleva el id, el email y el nombre', () => {
      const state = stateFromUser({
        id: 'abc-123',
        email: 'alguien@example.com',
        user_metadata: { display_name: 'Eduardo' },
      });

      expect(state).toEqual({
        status: 'signed-in',
        identity: { userId: 'abc-123', email: 'alguien@example.com', displayName: 'Eduardo' },
      });
    });

    it('un usuario sin email sigue siendo una sesión válida', () => {
      expect(stateFromUser({ id: 'abc-123' })).toEqual({
        status: 'signed-in',
        identity: { userId: 'abc-123', email: null, displayName: null },
      });
    });

    it('un id vacío NO es una sesión', () => {
      // Defensivo a propósito: una identidad vacía que pasara por buena
      // mandaría a la rama protegida a alguien sin identidad.
      expect(stateFromUser({ id: '' })).toEqual(SIGNED_OUT);
    });

    describe('el nombre de presentación', () => {
      const withName = (display_name: unknown) =>
        stateFromUser({ id: 'u', user_metadata: { display_name } });

      function identityOf(state: SessionState) {
        if (state.status !== 'signed-in') throw new Error('debería estar dentro');
        return state.identity;
      }

      it('sale de `user_metadata.display_name`', () => {
        expect(identityOf(withName('Eduardo')).displayName).toBe('Eduardo');
      });

      it('se recorta', () => {
        expect(identityOf(withName('  Eduardo  ')).displayName).toBe('Eduardo');
      });

      it('solo espacios es NULL, no una cadena vacía', () => {
        // Es lo que decide que Inicio salude sin nombre en vez de saludar a
        // nadie con un hueco.
        expect(identityOf(withName('   ')).displayName).toBeNull();
      });

      it('sin metadata es null', () => {
        expect(identityOf(stateFromUser({ id: 'u' })).displayName).toBeNull();
        expect(identityOf(stateFromUser({ id: 'u', user_metadata: {} })).displayName).toBeNull();
        expect(identityOf(stateFromUser({ id: 'u', user_metadata: null })).displayName).toBeNull();
      });

      it.each([42, true, null, { nombre: 'Eduardo' }, ['Eduardo']])(
        'un %s en el metadata no se cuela como nombre',
        (value) => {
          // `user_metadata` es JSON libre que edita el propio titular de la
          // cuenta, así que su forma se comprueba, no se supone.
          expect(identityOf(withName(value)).displayName).toBeNull();
        },
      );
    });

    describe('lo que la identidad NO puede llevar', () => {
      /*
       * Este bloque cambió al añadirse `displayName`, pero su objetivo es el
       * mismo y no se ha aflojado: la identidad expone lo justo para pintar
       * una pantalla, y **jamás** un token ni la sesión entera. Sigue fallando
       * si alguien mete cualquiera de las dos cosas.
       */
      const state = stateFromUser({
        id: 'abc-123',
        email: 'a@b.c',
        user_metadata: { display_name: 'Eduardo', telefono: '600', interno: 'secreto' },
      });
      const identity = state.status === 'signed-in' ? state.identity : null;

      it('son exactamente tres campos de presentación', () => {
        expect(Object.keys(identity ?? {}).sort()).toEqual(['displayName', 'email', 'userId']);
      });

      it('ninguno se parece a un token', () => {
        for (const key of Object.keys(identity ?? {})) {
          expect(key).not.toMatch(/token|jwt|secret|password|session/i);
        }
      });

      it('NO arrastra el `user_metadata` entero', () => {
        const serialised = JSON.stringify(identity);
        expect(serialised).not.toContain('telefono');
        expect(serialised).not.toContain('secreto');
        expect(serialised).not.toContain('user_metadata');
      });
    });
  });

  describe('qué se puede montar', () => {
    const ALL: SessionState[] = [
      RESTORING,
      SIGNED_OUT,
      UNAVAILABLE,
      { status: 'signed-in', identity: { userId: 'u', email: null, displayName: null } },
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
