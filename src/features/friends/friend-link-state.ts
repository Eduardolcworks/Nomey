import type { MessageKey } from '@/lib/i18n';

/**
 * LO QUE UN ENLACE DE AMISTAD DICE A QUIEN LO ABRE.
 *
 * Los estados son EXACTAMENTE los de `api.preview_friend_link` (F12/ADR-006
 * §5-§6), sin uno más ni uno menos:
 *
 * | estado             | qué es                                   | acción      |
 * | ------------------ | ---------------------------------------- | ----------- |
 * | `ok`               | nadie ha pedido nada todavía             | Aceptar/Rechazar |
 * | `incoming_pending` | su dueño YA me había enviado solicitud   | Aceptar/Rechazar |
 * | `mutual_pending`   | YO ya le había enviado solicitud a él    | Aceptar/Rechazar |
 * | `friends`          | ya somos amigos                          | —           |
 * | `own`              | es mi propio enlace                      | —           |
 * | `invalid`          | el token no nombra a nadie (o rotó)      | —           |
 * | `throttled`        | 20 intentos fallidos en 10 minutos       | —           |
 *
 * **Las tres primeras se ofrecen igual**, y eso es deliberado: para quien
 * abre el enlace la pregunta es la misma —«¿quieres ser su amigo?»— y la
 * diferencia entre ellas es contabilidad interna del servidor. `respond` la
 * resuelve: acepta la solicitud que hubiera, o la marca `accepted_via_link`
 * si la pendiente era la mía, o crea la amistad de origen `link`. **Nunca
 * duplica una solicitud**, y por eso la pantalla no tiene que saber cuál de
 * los tres casos es.
 *
 * `invalid` **no revela identidad**: un enlace rotado o inventado no dice de
 * quién era. Es lo que impide usar el enlace para sondear cuentas.
 */
export type FriendLinkRelation = 'ok' | 'incoming_pending' | 'mutual_pending';

export type FriendLinkPreview =
  | {
      readonly state: FriendLinkRelation;
      readonly handle: string | null;
      readonly publicName: string | null;
      readonly requestId: string | null;
    }
  | {
      readonly state: 'friends';
      readonly handle: string | null;
      readonly publicName: string | null;
    }
  | { readonly state: 'own' }
  | { readonly state: 'invalid' }
  | { readonly state: 'throttled' };

export const FRIEND_LINK_RELATIONS: readonly FriendLinkRelation[] = [
  'ok',
  'incoming_pending',
  'mutual_pending',
];

/**
 * ¿Se puede contestar a esto? Sólo las tres relaciones con identidad — y es
 * una guarda de tipo a propósito: fuera de ellas no hay nombre ni handle que
 * pintar, y el compilador lo impide en vez de dejarlo a la disciplina.
 */
export type AnswerablePreview = Extract<FriendLinkPreview, { state: FriendLinkRelation }>;

export function isAnswerable(preview: FriendLinkPreview): preview is AnswerablePreview {
  return FRIEND_LINK_RELATIONS.includes(preview.state as FriendLinkRelation);
}

/**
 * Lo que dice la pantalla cuando no hay nada que contestar. `null` para los
 * estados que sí se contestan, que llevan su propia frase con el nombre.
 */
export const PREVIEW_NOTICE: Readonly<Record<string, MessageKey>> = {
  friends: 'friends.already',
  own: 'friendLink.own',
  invalid: 'friendLink.invalid',
  throttled: 'friends.throttled',
};

/**
 * LO QUE `respond_friend_link` CONTESTA, tal cual.
 *
 * `friends` es el éxito de aceptar (con `already_processed` si ya lo eran);
 * `declined` es que había una solicitud suya y quedó rechazada; `dismissed`
 * es que no había ninguna y no se persistió nada — **rechazar un enlace no
 * crea una solicitud para poder rechazarla**. `own`, `invalid` y `throttled`
 * son los mismos estados del preview.
 */
export type FriendLinkResponse =
  | {
      readonly state: 'friends';
      readonly friendshipId: string | null;
      /** La solicitud que se reutilizó, si la había: sale de lo pendiente. */
      readonly requestId: string | null;
      readonly alreadyProcessed: boolean;
    }
  | { readonly state: 'declined'; readonly requestId: string | null }
  | { readonly state: 'dismissed' }
  | { readonly state: 'own' }
  | { readonly state: 'invalid' }
  | { readonly state: 'throttled' };

/** El enlace propio, tal como `api.my_friend_link` y `api.rotate_friend_link` lo publican. */
export type MyFriendLink = {
  readonly token: string;
  readonly version: number;
  readonly rotatedAt: string | null;
};
