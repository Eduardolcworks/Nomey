import type { MessageKey } from '@/lib/i18n';
import type { Symbols } from '@/ui/theme';

import type { GroupFriendState } from './group-friend';

/**
 * LO QUE SE PUEDE HACER SOBRE UN PARTICIPANTE, según el estado social.
 *
 * Descriptores puros —id, clave de la frase, símbolo— y no entradas de menú
 * ya construidas: la traducción es de quien pinta, y así esto se puede probar
 * sin un renderer y sin i18n. La pantalla los convierte en
 * `LongPressMenuAction` con `t()`.
 */
export const FRIEND_MENU_ACTION = {
  /** Informativa: dice el estado y no hace nada al pulsarla. */
  state: 'friend-state',
  add: 'friend-add',
  cancel: 'friend-cancel',
  accept: 'friend-accept',
  decline: 'friend-decline',
} as const;

export type FriendMenuActionId = (typeof FRIEND_MENU_ACTION)[keyof typeof FRIEND_MENU_ACTION];

export type FriendMenuEntry = {
  readonly id: FriendMenuActionId;
  readonly labelKey: MessageKey;
  /**
   * La CLAVE del vocabulario de símbolos, no el par `{ ios, android }` ya
   * resuelto: así este módulo no depende de `ui/` en tiempo de ejecución y
   * se puede probar sin montar nada. Quien pinta hace `Symbols[iconKey]`.
   */
  readonly iconKey: keyof typeof Symbols;
  readonly destructive?: boolean;
};

/**
 * Las entradas sociales del menú de un participante, en orden.
 *
 * **`self` y `unavailable` no dan ninguna**, y no dan una deshabilitada: una
 * fila en gris que dice «Añadir amigo» cuenta algo de esa persona —que no
 * tiene cuenta, o que no es apta— cada vez que alguien abre el menú.
 * Ausente, no cuenta nada.
 *
 * **«Solicitud enviada» y «Amigos» son informativas**, y eso es una concesión
 * consciente: `ActionMenu` no tiene ni títulos ni entradas deshabilitadas, y
 * lo que hay que poder hacer al tocar a alguien del grupo es SABER en qué
 * punto estáis. Pulsarlas no hace nada. La alternativa —no abrir menú y
 * dejar la fila muda— deja a la persona sin forma de comprobar si llegó a
 * mandar la solicitud.
 *
 * **«Eliminar amigo» NO está aquí a propósito.** Deshacer una amistad se
 * hace en Perfil → Amigos, donde están todas y donde la confirmación tiene
 * sitio; meterla en el menú del grupo la pondría a un toque de distancia de
 * «Aceptar», que es su opuesto.
 */
export function friendMenuEntries(state: GroupFriendState): readonly FriendMenuEntry[] {
  switch (state) {
    case 'none':
      return [{ id: FRIEND_MENU_ACTION.add, labelKey: 'friends.add', iconKey: 'addFriend' }];
    case 'outgoing_pending':
      return [
        { id: FRIEND_MENU_ACTION.state, labelKey: 'friends.requestSent', iconKey: 'pending' },
        {
          id: FRIEND_MENU_ACTION.cancel,
          labelKey: 'friends.cancelRequest',
          iconKey: 'close',
          destructive: true,
        },
      ];
    case 'incoming_pending':
      return [
        {
          id: FRIEND_MENU_ACTION.accept,
          labelKey: 'friends.acceptRequest',
          iconKey: 'addFriend',
        },
        {
          id: FRIEND_MENU_ACTION.decline,
          labelKey: 'friends.decline',
          iconKey: 'close',
          destructive: true,
        },
      ];
    case 'friends':
      return [{ id: FRIEND_MENU_ACTION.state, labelKey: 'friends.title', iconKey: 'friends' }];
    case 'self':
    case 'unavailable':
      return [];
  }
}
