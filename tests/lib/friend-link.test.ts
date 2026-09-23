import { beforeEach, describe, expect, it } from 'vitest';

import { FRIEND_PATH, friendLink, readFriendLink } from '../../src/features/friends/friend-link';
import {
  arriveFriendLink,
  peekFriendLink,
  resetFriendLinkArrival,
  subscribeFriendLink,
  takeFriendLink,
} from '../../src/features/friends/friend-link-arrival';
import { invitationLink, readInvitation } from '../../src/features/groups/invitation-link';

/**
 * EL ENLACE DE AMISTAD: construirlo, leerlo y dejarlo esperando.
 *
 * Tres cosas se fijan aquí, y las tres son de las que fallan en silencio:
 * que el enlace **no lleve el `@username`** —lo que hace que cambiarlo no lo
 * rompa—, que una URL ajena no se abra, y que el de amistad y el de
 * invitación no se confundan el uno con el otro.
 */

const TOKEN = 'a'.repeat(43);
const OTHER = 'b'.repeat(43);

describe('construir y leer', () => {
  it('el enlace canónico es `<esquema>://friend?t=<token>`', () => {
    expect(friendLink('nomey-dev', TOKEN)).toBe(`nomey-dev://${FRIEND_PATH}?t=${TOKEN}`);
    expect(friendLink('nomey', TOKEN)).toBe(`nomey://friend?t=${TOKEN}`);
    expect(friendLink('nomey-staging', TOKEN)).toBe(`nomey-staging://friend?t=${TOKEN}`);
  });

  it('se lee de cualquiera de los esquemas, y también de Expo Go', () => {
    for (const scheme of ['nomey', 'nomey-dev', 'nomey-staging']) {
      expect(readFriendLink(friendLink(scheme, TOKEN))).toBe(TOKEN);
    }
    expect(readFriendLink(`exp://192.168.1.136:8081/--/friend?t=${TOKEN}`)).toBe(TOKEN);
  });

  it('un token suelto vale, para pegar sólo lo que va tras `t=`', () => {
    expect(readFriendLink(TOKEN)).toBe(TOKEN);
    expect(readFriendLink(`  ${TOKEN}  `)).toBe(TOKEN);
  });

  it('sin token, con token malformado o sin `?`, no hay enlace', () => {
    expect(readFriendLink('nomey://friend')).toBeNull();
    expect(readFriendLink('nomey://friend?')).toBeNull();
    expect(readFriendLink('nomey://friend?t=')).toBeNull();
    expect(readFriendLink('nomey://friend?t=corto')).toBeNull();
    expect(readFriendLink(`nomey://friend?t=${'a'.repeat(200)}`)).toBeNull();
    expect(readFriendLink(`nomey://friend?t=no-vale-esto!${TOKEN}`)).toBeNull();
    expect(readFriendLink(null)).toBeNull();
    expect(readFriendLink(undefined)).toBeNull();
    expect(readFriendLink('')).toBeNull();
  });

  /** Abrir una web ajena porque alguien mandó un «enlace» es el fallo que esto cierra. */
  it('no se abre http(s): sólo esquemas de app', () => {
    expect(readFriendLink(`https://malo.example/friend?t=${TOKEN}`)).toBeNull();
    expect(readFriendLink(`http://malo.example/friend?t=${TOKEN}`)).toBeNull();
    expect(readFriendLink(`otracosa://friend?t=${TOKEN}`)).toBe(TOKEN);
  });

  /**
   * EL HANDLE NO VIAJA EN EL ENLACE, y por eso cambiar de username no lo
   * rompe: el token nombra a la CUENTA, y la identidad se resuelve en cada
   * preview. Si alguien lo metiera, el enlace de ayer mostraría el nombre de
   * ayer, o dejaría de valer.
   */
  it('el enlace no contiene el @username, y cambiarlo no cambia el enlace', () => {
    const link = friendLink('nomey', TOKEN);
    expect(link).not.toMatch(/@/);
    expect(link).not.toMatch(/edu13|handle|username/i);
    // El mismo token antes y después de cambiar de handle: el enlace es el mismo.
    expect(friendLink('nomey', TOKEN)).toBe(link);
    expect(readFriendLink(link)).toBe(TOKEN);
  });

  it('y rotar SÍ lo cambia: otro token, otro enlace', () => {
    expect(friendLink('nomey', OTHER)).not.toBe(friendLink('nomey', TOKEN));
    expect(readFriendLink(friendLink('nomey', OTHER))).toBe(OTHER);
  });
});

describe('amistad e invitación no se confunden', () => {
  it('`/join` no se lee como amistad, ni `/friend` como invitación', () => {
    expect(readFriendLink(invitationLink('nomey', TOKEN))).toBeNull();
    expect(readInvitation(friendLink('nomey', TOKEN))).toBeNull();
  });

  /**
   * Un token suelto es ambiguo por diseño —los dos usan el mismo generador—
   * y lo resuelve el contexto: quien lo pega en «Únete» busca una invitación
   * y quien escanea en Amigos busca un enlace de amistad. Lo que NO puede
   * pasar es que una URL completa se lea como la otra clase.
   */
  it('un token suelto lo desambigua quien pregunta, no la cadena', () => {
    expect(readFriendLink(TOKEN)).toBe(TOKEN);
    expect(readInvitation(TOKEN)).toBe(TOKEN);
  });
});

describe('la llegada', () => {
  beforeEach(() => {
    resetFriendLinkArrival();
  });

  it('un enlace válido deja su token esperando; una URL ajena no deja nada', () => {
    expect(arriveFriendLink(friendLink('nomey', TOKEN))).toBe(true);
    expect(peekFriendLink()).toBe(TOKEN);

    resetFriendLinkArrival();
    expect(arriveFriendLink('https://example.com')).toBe(false);
    expect(arriveFriendLink(null)).toBe(false);
    expect(peekFriendLink()).toBeNull();
  });

  it('mirar no consume; recoger sí, y una sola vez', () => {
    arriveFriendLink(friendLink('nomey', TOKEN));
    expect(peekFriendLink()).toBe(TOKEN);
    expect(peekFriendLink()).toBe(TOKEN);
    expect(takeFriendLink()).toBe(TOKEN);
    expect(takeFriendLink()).toBeNull();
    expect(peekFriendLink()).toBeNull();
  });

  /** La última llegada gana: dos enlaces seguidos dejan el segundo. */
  it('la última llegada gana', () => {
    arriveFriendLink(friendLink('nomey', TOKEN));
    arriveFriendLink(friendLink('nomey', OTHER));
    expect(peekFriendLink()).toBe(OTHER);
  });

  it('avisa a quien esté escuchando, con el token', () => {
    const seen: string[] = [];
    const stop = subscribeFriendLink((token) => seen.push(token));
    arriveFriendLink(friendLink('nomey', TOKEN));
    expect(seen).toEqual([TOKEN]);
    stop();
    arriveFriendLink(friendLink('nomey', OTHER));
    expect(seen).toEqual([TOKEN]);
  });

  /**
   * ESPERA A QUIEN PUEDA USARLO. El arranque en frío, la app abierta y el QR
   * escaneado dejan lo mismo aquí, y nada lo consume por el camino: sin
   * sesión, como invitado o sin username, el token sigue esperando.
   */
  it('sobrevive a todo lo que ocurre antes de poder resolverlo', () => {
    arriveFriendLink(friendLink('nomey', TOKEN));
    // Se entra, se convierte la cuenta, se elige username… nada lo toca.
    expect(peekFriendLink()).toBe(TOKEN);
    expect(peekFriendLink()).toBe(TOKEN);
    expect(takeFriendLink()).toBe(TOKEN);
  });
});
