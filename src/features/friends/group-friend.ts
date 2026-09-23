/**
 * EL ESTADO SOCIAL DE UN PARTICIPANTE DE GRUPO (F12.E.D).
 *
 * Lo que `api.group_friend_status` publica de cada participante del grupo, y
 * **nada más**: una palabra y, cuando hay una solicitud pendiente, su id. No
 * hay uid, ni correo, ni `@handle`, ni el nombre público de la cuenta — ni
 * aquí ni en el servidor. El nombre que la pantalla enseña sigue siendo el
 * del participante, que el grupo ya publicaba.
 *
 * **El cliente nunca traduce un participante a una cuenta.** Para pedir
 * amistad manda el `participant_id` que ya tenía de la lista y el servidor
 * resuelve a quién corresponde; eso es lo que permite ofrecer «Añadir amigo»
 * dentro del grupo sin publicar la identidad global de nadie
 * (F03/ADR-009 §1).
 */

/** Los seis estados del contrato, en el orden en que la UI los razona. */
export const GROUP_FRIEND_STATES = [
  'none',
  'outgoing_pending',
  'incoming_pending',
  'friends',
  'self',
  'unavailable',
] as const;

export type GroupFriendState = (typeof GROUP_FRIEND_STATES)[number];

export type GroupFriendStatus = {
  readonly participantId: string;
  readonly state: GroupFriendState;
  /** Sólo en las pendientes: es lo que aceptar, rechazar y cancelar necesitan. */
  readonly requestId: string | null;
};

function isState(value: unknown): value is GroupFriendState {
  return typeof value === 'string' && (GROUP_FRIEND_STATES as readonly string[]).includes(value);
}

/**
 * Una fila del servidor, o `null` si no es del contrato.
 *
 * Un estado desconocido se descarta en vez de pintarse: la fila desaparece
 * del mapa y el participante se comporta como `unavailable` —sin acción—,
 * que es el modo seguro. Inventar una acción sobre una palabra que este
 * cliente no entiende sería peor que no ofrecer ninguna.
 */
export function parseGroupFriendRow(row: unknown): GroupFriendStatus | null {
  if (typeof row !== 'object' || row === null) return null;
  const value = row as Record<string, unknown>;
  const participantId = value.participant_id;
  if (typeof participantId !== 'string' || !isState(value.state)) return null;
  const requestId = value.request_id;
  return {
    participantId,
    state: value.state,
    requestId: typeof requestId === 'string' ? requestId : null,
  };
}

/**
 * ¿HAY ALGO SOCIAL QUE OFRECER sobre este participante?
 *
 * `self` y `unavailable` no llevan acción, y **no llevan una acción
 * deshabilitada**: simplemente no aparece. Una fila que dice «Añadir amigo»
 * en gris sobre alguien sin cuenta cuenta algo de esa persona —que no la
 * tiene, o que no es apta— cada vez que alguien abre el menú; ausente, no
 * cuenta nada.
 *
 * Lo mismo vale para el invitado, para el fantasma y para uno mismo: el
 * servidor los contesta con esas dos palabras y la pantalla se limita a no
 * ofrecer nada.
 */
export function hasFriendAction(state: GroupFriendState): boolean {
  return state !== 'self' && state !== 'unavailable';
}
