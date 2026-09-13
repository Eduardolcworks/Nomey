/**
 * EL ENLACE DE INVITACIÓN, Y EL QR: LA MISMA CADENA. F09/ADR-004.
 *
 * Hoja PURA. Un enlace es `<esquema>://join?t=<token>`; el QR lleva exactamente
 * esa cadena. El token es opaco —base64url de 32 bytes— y **sólo el servidor
 * sabe si vale**: aquí no se decide nada, sólo se extrae lo que hay que mandar
 * a `api.preview_invitation`.
 *
 * **Lo que NO se hace con lo pegado o escaneado.** No se abre ninguna
 * dirección: una URL ajena a Nomey devuelve `null` y se dice que no es una
 * invitación. El esquema se compara por el sufijo `join`, como el enlace de
 * recuperación: en una build propia es `nomey://join`, en Expo Go
 * `exp://<host>/--/join`, y el destino es el mismo. Un token suelto también se
 * admite, para pegar sólo lo que va tras `t=`.
 *
 * **El enlace no depende de la IP de Metro** ni de ninguna web: la identidad
 * de la invitación es el token, verificado en servidor, y el esquema es el de
 * la app. No hay Universal Links ni App Links configurados, y no se declara lo
 * contrario.
 */
export const JOIN_PATH = 'join';

const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;

/** El token de una invitación, o `null` si eso no es una invitación de Nomey. */
export function readInvitation(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  const raw = text.trim();
  if (raw === '') return null;
  if (TOKEN.test(raw)) return raw;

  const query = raw.indexOf('?');
  if (query === -1) return null;
  const path = raw.slice(0, query).replace(/\/+$/, '');
  // Sólo esquemas de app: nada de http(s), que sería abrir una web ajena.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /^https?:\/\//i.test(path)) return null;
  if (!path.endsWith(`/${JOIN_PATH}`) && !path.endsWith(`://${JOIN_PATH}`)) return null;
  const token = new URLSearchParams(raw.slice(query + 1)).get('t');
  return token !== null && TOKEN.test(token) ? token : null;
}

/** El enlace canónico para un esquema de app dado. Es lo que también va en el QR. */
export function invitationLink(scheme: string, token: string): string {
  return `${scheme}://${JOIN_PATH}?t=${token}`;
}
