/**
 * UN ENLACE DE AMISTAD QUE LLEGA, esperando a quien pueda usarlo. F12/ADR-006.
 *
 * Hoja pura, hermana de `invitation-arrival.ts` y con su misma forma: el
 * enlace pulsado —desde WhatsApp, la cámara del sistema o un arranque en
 * frío— y el QR escaneado dejan aquí su token, y quien está en condiciones de
 * usarlo lo recoge. Así enlace pulsado, enlace pegado y QR recorren el mismo
 * camino y las mismas comprobaciones del servidor.
 *
 * **Sobrevive a todo lo que hay antes de poder resolverlo**, que es lo que la
 * amistad exige de más que una invitación de grupo: sin sesión, como invitado
 * y como cuenta sin username definitivo, `api.preview_friend_link` responde
 * `NOT_AUTHORIZED` o `USERNAME_REQUIRED` **antes de mirar el token**. El
 * enlace no es, por tanto, una API pública de resolución de identidad — y el
 * cliente no la convierte en una: no pregunta hasta que el actor es elegible.
 * Mientras tanto el token espera aquí.
 *
 * **En memoria y nada más.** No se persiste en disco, no viaja en un
 * parámetro de ruta y no se guarda en el servidor: si la app se reinicia, se
 * vuelve a abrir el enlace. La última llegada gana.
 */
import { readFriendLink } from './friend-link';

type Listener = (token: string) => void;

let pending: string | null = null;
const listeners = new Set<Listener>();

/** Deja el token de un enlace válido; una URL ajena no deja nada. */
export function arriveFriendLink(url: string | null | undefined): boolean {
  const token = readFriendLink(url);
  if (token === null) return false;
  pending = token;
  for (const listener of listeners) listener(token);
  return true;
}

/** ¿Hay un enlace de amistad esperando? Sin consumirlo. */
export function peekFriendLink(): string | null {
  return pending;
}

/**
 * Recoge el enlace pendiente, una sola vez.
 *
 * Se consume cuando la respuesta se resuelve —aceptada, rechazada, inválida—
 * o cuando la pantalla se cierra, nunca al abrirla: si el proceso muere a
 * medias, el enlace se vuelve a abrir desde donde estaba.
 */
export function takeFriendLink(): string | null {
  const token = pending;
  pending = null;
  return token;
}

export function subscribeFriendLink(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sólo para pruebas. */
export function resetFriendLinkArrival(): void {
  pending = null;
  listeners.clear();
}
