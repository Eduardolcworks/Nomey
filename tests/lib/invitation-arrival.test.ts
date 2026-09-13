import { afterEach, describe, expect, it } from 'vitest';

import {
  arriveInvitation,
  peekInvitation,
  resetInvitationArrival,
  subscribeInvitation,
  takeInvitation,
} from '../../src/features/groups/invitation-arrival';

/**
 * EL ENLACE PULSADO deja su token esperando; quien lo recoge es la hoja de
 * «Únete», una sola vez. Aquí se fija que sólo entra una invitación de Nomey,
 * que la última gana, y que recoger vacía.
 */
const TOKEN = 'Ab3-_9Xy'.repeat(6).slice(0, 43);

describe('la llegada de una invitación', () => {
  afterEach(resetInvitationArrival);

  it('acepta el enlace de la app y el de Expo Go, y deja el token esperando', () => {
    expect(arriveInvitation(`nomey-dev://join?t=${TOKEN}`)).toBe(true);
    expect(peekInvitation()).toBe(TOKEN);
    resetInvitationArrival();
    expect(arriveInvitation(`exp://172.20.10.6:8081/--/join?t=${TOKEN}`)).toBe(true);
    expect(peekInvitation()).toBe(TOKEN);
  });

  it('ignora lo que no es una invitación: la URL del proyecto, una web, nada', () => {
    expect(arriveInvitation('exp://172.20.10.6:8081')).toBe(false);
    expect(arriveInvitation(`https://example.com/join?t=${TOKEN}`)).toBe(false);
    expect(arriveInvitation(null)).toBe(false);
    expect(peekInvitation()).toBeNull();
  });

  it('recoger es una sola vez, y la última llegada gana', () => {
    const other = 'Zz'.repeat(22).slice(0, 43);
    arriveInvitation(`nomey://join?t=${TOKEN}`);
    arriveInvitation(`nomey://join?t=${other}`);
    expect(takeInvitation()).toBe(other);
    expect(takeInvitation()).toBeNull();
  });

  it('avisa a quien escucha, y deja de avisar al darse de baja', () => {
    const seen: string[] = [];
    const stop = subscribeInvitation((token) => seen.push(token));
    arriveInvitation(`nomey://join?t=${TOKEN}`);
    stop();
    arriveInvitation(`nomey://join?t=${TOKEN}`);
    expect(seen).toEqual([TOKEN]);
  });
});
