/**
 * UNA INVITACIÓN QUE LLEGA POR ENLACE, esperando a quien la use. F09/ADR-004.
 *
 * Hoja pura. El enlace pulsado —desde WhatsApp, Notas, la cámara del sistema
 * o un arranque en frío— deja aquí su token, y quien está en condiciones de
 * usarlo lo recoge: la hoja de «Únete», que lo trata exactamente igual que uno
 * pegado o escaneado. Así QR, enlace pegado y enlace pulsado recorren el mismo
 * camino y las mismas comprobaciones del servidor.
 *
 * **Sobrevive al inicio de sesión.** Si el enlace llega sin sesión, el token
 * espera aquí hasta que las pestañas se monten con una; nada lo consume antes.
 * No se persiste en disco ni viaja en un parámetro de ruta: vive en memoria y
 * la última llegada gana.
 */
import { readInvitation } from './invitation-link';

type Listener = (token: string) => void;

let pending: string | null = null;
const listeners = new Set<Listener>();

/** Deja el token de un enlace válido; una URL ajena no deja nada. */
export function arriveInvitation(url: string | null | undefined): boolean {
  const token = readInvitation(url);
  if (token === null) return false;
  pending = token;
  for (const listener of listeners) listener(token);
  return true;
}

/** ¿Hay una invitación esperando? Sin consumirla. */
export function peekInvitation(): string | null {
  return pending;
}

/** Recoge la invitación pendiente, una sola vez. */
export function takeInvitation(): string | null {
  const token = pending;
  pending = null;
  return token;
}

export function subscribeInvitation(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/*
 * LA INVITACIÓN CON LA QUE SE ENTRÓ EN CADA GRUPO, por si hay que volver a
 * «¿Quién eres?» (F09/ADR-006 §4): rectificar una reclamación no consume la
 * invitación, y el camino de vuelta es el mismo enlace. En memoria y nada
 * más, como la pendiente: si la app se reinició, se pide una nueva.
 */
const redeemed = new Map<string, string>();

export function rememberRedeemedInvitation(scopeId: string, token: string): void {
  redeemed.set(scopeId, token);
}

/** El token con el que se entró en ese grupo en esta ejecución, o `null`. */
export function redeemedInvitation(scopeId: string): string | null {
  return redeemed.get(scopeId) ?? null;
}

/** Sólo para pruebas. */
export function resetInvitationArrival(): void {
  pending = null;
  listeners.clear();
  redeemed.clear();
}
