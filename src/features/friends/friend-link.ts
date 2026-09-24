/**
 * EL ENLACE DE AMISTAD, Y EL QR: LA MISMA CADENA. F12/ADR-006.
 *
 * Hoja PURA, hermana de `invitation-link.ts` y deliberadamente con su misma
 * forma: un enlace es `<esquema>://friend?t=<token>`, el QR lleva exactamente
 * esa cadena, el token es opaco —base64url de 32 bytes, el mismo generador
 * que las invitaciones (`sec.new_invitation_token`)— y **sólo el servidor
 * sabe si vale**. Aquí no se decide nada: se extrae lo que hay que mandar a
 * `api.preview_friend_link`.
 *
 * **El `@username` NO viaja en el enlace.** La identidad autoritativa es el
 * token, que apunta a una CUENTA; el handle se resuelve en cada preview
 * (`uid → identidad actual`, F12/ADR-001 §13). Por eso cambiar de username no
 * rompe un enlace ya compartido, y por eso un enlace no permite averiguar el
 * handle de nadie sin pasar por el servidor, que exige cuenta normal para
 * contestar.
 *
 * **Lo que NO se hace con lo pegado o escaneado.** No se abre ninguna
 * dirección: una URL ajena a Nomey devuelve `null`. El esquema se compara por
 * el sufijo `friend`, como el de invitación y el de recuperación: en una build
 * propia es `nomey-dev://friend`, en Expo Go `exp://<host>/--/friend`, y el
 * destino es el mismo. Un token suelto también se admite.
 *
 * **Sin Universal Links.** No hay App Links ni dominios asociados, y no se
 * declara lo contrario: el enlace sólo lo abre quien tiene la app.
 */
export const FRIEND_PATH = 'friend';

const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;

/** El token de un enlace de amistad, o `null` si eso no lo es. */
export function readFriendLink(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  const raw = text.trim();
  if (raw === '') return null;
  if (TOKEN.test(raw)) return raw;

  const query = raw.indexOf('?');
  if (query === -1) return null;
  const path = raw.slice(0, query).replace(/\/+$/, '');
  // Sólo esquemas de app: nada de http(s), que sería abrir una web ajena.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /^https?:\/\//i.test(path)) return null;
  if (!path.endsWith(`/${FRIEND_PATH}`) && !path.endsWith(`://${FRIEND_PATH}`)) return null;
  const token = new URLSearchParams(raw.slice(query + 1)).get('t');
  return token !== null && TOKEN.test(token) ? token : null;
}

/** El enlace canónico para un esquema de app dado. Es lo que también va en el QR. */
export function friendLink(scheme: string, token: string): string {
  return `${scheme}://${FRIEND_PATH}?t=${token}`;
}
