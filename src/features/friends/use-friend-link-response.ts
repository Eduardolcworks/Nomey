import { useCallback, useEffect, useRef, useState } from 'react';

import { takeFriendLink } from './friend-link-arrival';
import type { FriendLinkPreview, FriendLinkResponse } from './friend-link-state';
import { publishFriendRequestSettled, publishFriendsChanged } from './friend-events';
import { previewFriendLink, sendRespondFriendLink } from './friend-service';

export type FriendLinkView =
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready'; readonly preview: FriendLinkPreview }
  | { readonly kind: 'answered'; readonly response: FriendLinkResponse }
  | { readonly kind: 'failed'; readonly offline: boolean };

export type FriendLinkResponder = {
  readonly view: FriendLinkView;
  readonly busy: boolean;
  readonly retry: () => void;
  readonly accept: () => Promise<void>;
  readonly decline: () => Promise<void>;
};

const CHECKING: FriendLinkView = { kind: 'checking' };

/**
 * ABRIR UN ENLACE DE AMISTAD, Y CONTESTARLO. Servidor autoritativo de punta a
 * punta.
 *
 * **Sólo se pregunta cuando el actor es elegible.** El token espera en
 * `friend-link-arrival` mientras no hay sesión, mientras la sesión es de
 * invitado y mientras la cuenta no tiene username definitivo: en esos tres
 * casos `api.preview_friend_link` contestaría `NOT_AUTHORIZED` o
 * `USERNAME_REQUIRED` **antes de mirar el token**, así que preguntar no
 * aportaría nada y gastaría un intento. `enabled` es esa puerta, y la pone la
 * ruta, que es la única que ve la sesión y la identidad.
 *
 * **El token no se consume al abrir, sino al resolver.** Si el proceso muere
 * con la pantalla abierta, el enlace sigue esperando y se retoma; una vez
 * contestado —o declarado inválido— se recoge y ya no vuelve.
 *
 * **Nada es optimista.** La amistad no existe hasta que el servidor lo dice,
 * y sólo entonces se avisa a las listas (`friendsChanged`) y se retira de lo
 * pendiente la solicitud que se haya reutilizado (`friendRequestSettled`).
 *
 * Lo cargado se guarda con el token y el intento a los que pertenece, y se
 * lee comparándolos: volver a intentar o cambiar de enlace vuelve a
 * «comprobando» **sin un efecto que reinicie el estado**, que es la misma
 * regla que siguen las lecturas de Amigos.
 */
export function useFriendLinkResponse(token: string | null, enabled: boolean): FriendLinkResponder {
  const [held, setHeld] = useState<{
    readonly token: string;
    readonly attempt: number;
    readonly view: FriendLinkView;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled || token === null) return;
    let live = true;
    void previewFriendLink(token).then((result) => {
      if (!live) return;
      const view: FriendLinkView = result.ok
        ? { kind: 'ready', preview: result.data }
        : { kind: 'failed', offline: result.status === 0 };
      setHeld({ token, attempt, view });
      // Un enlace que ya no nombra a nadie no tiene nada que esperar.
      if (result.ok && result.data.state === 'invalid') takeFriendLink();
    });
    return () => {
      live = false;
    };
  }, [token, enabled, attempt]);

  const respond = useCallback(
    async (action: 'accept' | 'decline') => {
      if (token === null || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      try {
        const result = await sendRespondFriendLink(token, action);
        if (!result.ok) {
          setHeld({
            token,
            attempt,
            view: { kind: 'failed', offline: result.status === 0 },
          });
          return;
        }
        const answer = result.data;
        setHeld({ token, attempt, view: { kind: 'answered', response: answer } });
        /*
         * Sólo lo que el servidor confirmó. `dismissed` no persistió nada, así
         * que no hay lista que refrescar; `declined` resolvió una solicitud
         * suya, y `friends` creó (o encontró) la amistad.
         */
        if (answer.state === 'friends' || answer.state === 'declined') {
          // La solicitud reutilizada —en cualquiera de las dos direcciones—
          // deja de estar pendiente: sale de Recibidas o de Enviadas al
          // instante, sin esperar a la relectura.
          if (answer.requestId !== null) publishFriendRequestSettled(answer.requestId);
          publishFriendsChanged();
        }
        if (answer.state !== 'throttled') takeFriendLink();
      } finally {
        setBusy(false);
        inFlight.current = false;
      }
    },
    [token, attempt],
  );

  const accept = useCallback(() => respond('accept'), [respond]);
  const decline = useCallback(() => respond('decline'), [respond]);
  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const view =
    held !== null && held.token === token && held.attempt === attempt ? held.view : CHECKING;

  return { view, busy, retry, accept, decline };
}
