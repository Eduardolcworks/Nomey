import { describe, expect, it } from 'vitest';

import {
  invitationLink,
  JOIN_PATH,
  readInvitation,
} from '../../src/features/groups/invitation-link';

/**
 * EL ENLACE DE INVITACIÓN Y EL QR: la misma cadena, y sólo se extrae el token.
 * Nada de aquí decide si la invitación vale — eso es del servidor —; aquí se
 * decide qué NO se manda ni se abre.
 */
const TOKEN = 'Ab3-_9Xy'.repeat(6).slice(0, 43); // 43 caracteres base64url

describe('leer una invitación', () => {
  it('acepta el enlace canónico de cualquier esquema de la app, y el de Expo Go', () => {
    expect(readInvitation(`nomey://${JOIN_PATH}?t=${TOKEN}`)).toBe(TOKEN);
    expect(readInvitation(`nomey-dev://${JOIN_PATH}?t=${TOKEN}`)).toBe(TOKEN);
    expect(readInvitation(`exp://172.20.10.6:8081/--/${JOIN_PATH}?t=${TOKEN}`)).toBe(TOKEN);
    // Con espacios alrededor, como llega al pegar.
    expect(readInvitation(`  nomey://${JOIN_PATH}?t=${TOKEN}\n`)).toBe(TOKEN);
  });

  it('acepta el token suelto, y sólo con la forma del servidor', () => {
    expect(readInvitation(TOKEN)).toBe(TOKEN);
    expect(readInvitation('A'.repeat(39))).toBeNull();
    expect(readInvitation('A'.repeat(65))).toBeNull();
    expect(readInvitation(`${TOKEN.slice(0, 40)}+/=`)).toBeNull();
  });

  it('NO abre ni acepta una web ni un QR ajeno', () => {
    expect(readInvitation(`https://example.com/${JOIN_PATH}?t=${TOKEN}`)).toBeNull();
    expect(readInvitation(`http://evil.test/?t=${TOKEN}`)).toBeNull();
    expect(readInvitation('WIFI:S:casa;T:WPA;P:secreto;;')).toBeNull();
    expect(readInvitation(`nomey://otra?t=${TOKEN}`)).toBeNull();
    expect(readInvitation(`nomey://${JOIN_PATH}?x=${TOKEN}`)).toBeNull();
    expect(readInvitation('')).toBeNull();
    expect(readInvitation(null)).toBeNull();
  });

  it('un enlace editado es OTRO token, nunca el mismo: quien decide si vale es el servidor', () => {
    const full = `nomey://${JOIN_PATH}?t=${TOKEN}`;
    // La forma no delata un token recortado o alargado —cabe en el rango—; lo
    // que garantiza el cliente es que no lo confunde con el anterior, y el
    // número de serie de la previsualización descarta la respuesta vieja.
    expect(readInvitation(full.slice(0, -1))).not.toBe(TOKEN);
    expect(readInvitation(`${full}x`)).not.toBe(TOKEN);
    // Y demasiado corto o largo, ni se pregunta.
    expect(readInvitation(full.slice(0, -5))).toBeNull();
  });

  it('el enlace canónico se construye con el esquema de la app y el mismo token', () => {
    const link = invitationLink('nomey-dev', TOKEN);
    expect(link).toBe(`nomey-dev://${JOIN_PATH}?t=${TOKEN}`);
    expect(readInvitation(link)).toBe(TOKEN);
  });
});
