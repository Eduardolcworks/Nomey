import { describe, expect, it } from 'vitest';

import {
  calendarDayOf,
  canChangeUsername,
  canEnterApp,
  IDENTITY_IDLE,
  IDENTITY_REQUIRED,
  IDENTITY_UNAVAILABLE,
  identityFromRow,
  isIdentityPending,
  needsUsernameGate,
} from '../../src/features/auth/identity-state';
import {
  IDENTITY_CACHE_KEY,
  parseIdentity,
  recallIdentity,
  rememberIdentity,
  serializeIdentity,
} from '../../src/features/auth/identity-cache';
import { onIdentityWake, wakeIdentity } from '../../src/features/auth/identity-wake';
import type { CatalogueCache } from '../../src/lib/offline/catalogue-cache';

/**
 * La identidad publica en el cliente, decidida sin pantalla (F12/ADR-001, F12.A3).
 *
 * Lo que aqui se fija es quien ve el gate y quien no, y cuando se puede cambiar
 * de username. El servidor manda en todo ello; estas funciones solo traducen
 * su respuesta a la rama del navegador y a la affordance del lapiz.
 */
describe('la fila de api.my_account_handle', () => {
  it('se lee tal cual: handle, nombre, estado, reserved_until y can_change_at, y nada mas', () => {
    const claimed = identityFromRow({
      handle: 'eduardo',
      public_name: 'Eduardo',
      state: 'claimed',
      reserved_until: null,
      can_change_at: '2026-10-19T10:00:00+00:00',
    });
    expect(claimed).toEqual({
      handle: 'eduardo',
      publicName: 'Eduardo',
      state: 'claimed',
      reservedUntil: null,
      canChangeAt: '2026-10-19T10:00:00+00:00',
    });
    expect(Object.keys(claimed).sort()).toEqual(
      ['canChangeAt', 'handle', 'publicName', 'reservedUntil', 'state'].sort(),
    );
  });

  it('una reserva provisional conserva reserved_until y no can_change_at; un estado desconocido es ninguno', () => {
    const reserved = identityFromRow({
      handle: 'ana',
      public_name: 'Ana',
      state: 'reserved',
      reserved_until: '2026-09-26T10:00:00+00:00',
      can_change_at: null,
    });
    expect(reserved.state).toBe('reserved');
    expect(reserved.reservedUntil).toBe('2026-09-26T10:00:00+00:00');
    expect(reserved.canChangeAt).toBeNull();
    expect(
      identityFromRow({
        handle: null,
        public_name: 'Solo nombre',
        state: null,
        reserved_until: null,
        can_change_at: null,
      }),
    ).toEqual({
      handle: null,
      publicName: 'Solo nombre',
      state: null,
      reservedUntil: null,
      canChangeAt: null,
    });
    expect(identityFromRow(null).handle).toBeNull();
    // Lo que no es un string no se cuela como uno.
    expect(
      identityFromRow({
        handle: 12 as never,
        public_name: '',
        state: 'held' as never,
        reserved_until: null,
        can_change_at: null,
      }),
    ).toEqual({
      handle: null,
      publicName: null,
      state: null,
      reservedUntil: null,
      canChangeAt: null,
    });
  });
});

describe('quien ve el gate (F12/ADR-001 §7)', () => {
  const ready = {
    status: 'ready' as const,
    identity: identityFromRow({
      handle: 'edu',
      public_name: 'Edu',
      state: 'claimed',
      reserved_until: null,
      can_change_at: null,
    }),
  };

  it('solo el veredicto del servidor: required. Ni listo, ni sin respuesta de red, ni un invitado', () => {
    expect(needsUsernameGate(IDENTITY_REQUIRED)).toBe(true);
    expect(needsUsernameGate(ready)).toBe(false);
    expect(needsUsernameGate(IDENTITY_UNAVAILABLE)).toBe(false);
    expect(needsUsernameGate(IDENTITY_IDLE)).toBe(false);
  });

  it('sin respuesta del servidor una cuenta normal ENTRA (offline first), y no al gate', () => {
    // F07/ADR-001: Nomey abre sin red. Un fallo de transporte no es un
    // veredicto; la cuenta entra con lo que sabe y el ciclo vuelve a preguntar.
    expect(canEnterApp(IDENTITY_UNAVAILABLE, true)).toBe(true);
    expect(needsUsernameGate(IDENTITY_UNAVAILABLE)).toBe(false);
    // Con handle definitivo, tabs; con USERNAME_REQUIRED, gate; pendiente, nada.
    expect(canEnterApp(ready, true)).toBe(true);
    expect(canEnterApp(IDENTITY_REQUIRED, true)).toBe(false);
    expect(canEnterApp(IDENTITY_IDLE, true)).toBe(false);
    // Un invitado entra siempre: el ciclo no le pregunta.
    expect(canEnterApp(IDENTITY_IDLE, false)).toBe(true);
    expect(canEnterApp(IDENTITY_UNAVAILABLE, false)).toBe(true);
  });

  it('una cuenta normal sin respuesta esta pendiente (nada se monta); un invitado nunca lo esta', () => {
    expect(isIdentityPending(IDENTITY_IDLE, true)).toBe(true);
    expect(isIdentityPending(IDENTITY_IDLE, false)).toBe(false);
    // Con respuesta —la que sea— ya no hay nada que esperar; un reintento tras
    // unavailable no vuelve a retener la app.
    expect(isIdentityPending(ready, true)).toBe(false);
    expect(isIdentityPending(IDENTITY_REQUIRED, true)).toBe(false);
    expect(isIdentityPending(IDENTITY_UNAVAILABLE, true)).toBe(false);
  });
});

describe('cuando se puede cambiar de username (F12/ADR-001 §9)', () => {
  const now = new Date('2026-09-19T12:00:00Z');
  const row = (state: 'claimed' | 'reserved', canChangeAt: string | null) =>
    identityFromRow({
      handle: 'edu',
      public_name: 'Edu',
      state,
      reserved_until: state === 'reserved' ? '2026-09-26T00:00:00Z' : null,
      can_change_at: canChangeAt,
    });

  it('un definitivo sin cooldown, o con el cooldown vencido, puede; en cooldown, no; una reserva, nunca', () => {
    expect(canChangeUsername(row('claimed', null), now)).toBe(true);
    expect(canChangeUsername(row('claimed', '2026-09-19T11:59:59Z'), now)).toBe(true);
    expect(canChangeUsername(row('claimed', '2026-09-19T12:00:00Z'), now)).toBe(true);
    expect(canChangeUsername(row('claimed', '2026-10-19T12:00:00Z'), now)).toBe(false);
    expect(canChangeUsername(row('reserved', null), now)).toBe(false);
  });

  it('el dia del cooldown se enseña en el calendario DEL DISPOSITIVO', () => {
    const local = new Date(2026, 9, 19, 23, 30); // 19 de octubre, 23:30 hora local
    expect(calendarDayOf(local.toISOString())).toBe('2026-10-19');
    expect(calendarDayOf('no es una fecha')).toBeNull();
  });
});

describe('el respaldo local de la identidad (offline first, F07/ADR-001)', () => {
  const claimed = identityFromRow({
    handle: 'edu',
    public_name: 'Edu',
    state: 'claimed',
    reserved_until: null,
    can_change_at: '2026-10-19T12:00:00Z',
  });

  function memoryCache(): CatalogueCache & { readonly rows: Map<string, string> } {
    const rows = new Map<string, string>();
    return {
      rows,
      read: async (actorId, key) => {
        const document = rows.get(`${actorId}/${key}`);
        return document === undefined ? null : { document, cachedAt: 'now' };
      },
      write: async (actorId, key, document) => {
        rows.set(`${actorId}/${key}`, document);
      },
      clear: async (actorId, key) => {
        rows.delete(`${actorId}/${key}`);
      },
    };
  }

  it('solo se recuerda un handle DEFINITIVO, y solo lo publico: handle, nombre, cooldown', () => {
    const document = serializeIdentity(claimed);
    expect(document).not.toBeNull();
    expect(JSON.parse(document ?? '')).toEqual({
      v: 1,
      handle: 'edu',
      publicName: 'Edu',
      canChangeAt: '2026-10-19T12:00:00Z',
    });
    expect(parseIdentity(document ?? '')).toEqual(claimed);
    // Una reserva provisional no se recuerda: no es una identidad publica.
    expect(
      serializeIdentity(
        identityFromRow({
          handle: 'edu',
          public_name: 'Edu',
          state: 'reserved',
          reserved_until: '2026-09-26T00:00:00Z',
          can_change_at: null,
        }),
      ),
    ).toBeNull();
  });

  it('un documento que no se puede creer es null: version, forma, handle vacio, basura', () => {
    expect(parseIdentity('{"v":2,"handle":"edu"}')).toBeNull();
    expect(parseIdentity('{"v":1,"handle":""}')).toBeNull();
    expect(parseIdentity('{"v":1}')).toBeNull();
    expect(parseIdentity('no json')).toBeNull();
    expect(parseIdentity('[]')).toBeNull();
  });

  it('se guarda y se lee POR CUENTA, con la clave propia, y sin actor no se toca nada', async () => {
    const cache = memoryCache();
    expect(await rememberIdentity(cache, 'a', claimed, 'now')).toBe('stored');
    expect(cache.rows.has(`a/${IDENTITY_CACHE_KEY}`)).toBe(true);
    expect(await recallIdentity(cache, 'a')).toEqual(claimed);
    expect(await recallIdentity(cache, 'b')).toBeNull();
    expect(await rememberIdentity(cache, '', claimed, 'now')).toBe('skipped');
    expect(await recallIdentity(cache, '')).toBeNull();
    expect(cache.rows.size).toBe(1);
  });

  it('una base que falla no tumba a nadie: failed / null, nunca una excepcion', async () => {
    const broken: CatalogueCache = {
      read: async () => {
        throw new Error('sin base');
      },
      write: async () => {
        throw new Error('sin base');
      },
      clear: async () => undefined,
    };
    expect(await rememberIdentity(broken, 'a', claimed, 'now')).toBe('failed');
    expect(await recallIdentity(broken, 'a')).toBeNull();
  });
});

describe('la señal de reconexion (el unico AppState, F07/ADR-001 §12)', () => {
  it('wakeIdentity avisa a quien escucha, y darse de baja deja de avisar', () => {
    let count = 0;
    const off = onIdentityWake(() => {
      count += 1;
    });
    wakeIdentity();
    wakeIdentity();
    expect(count).toBe(2);
    off();
    wakeIdentity();
    expect(count).toBe(2);
  });
});
