import * as Linking from 'expo-linking';
import { useCallback, useRef, useState } from 'react';

import { FRIEND_PATH } from './friend-link';
import type { MyFriendLink } from './friend-link-state';
import { fetchMyFriendLink, sendRotateFriendLink } from './friend-service';

/** El enlace que ESTE entorno puede abrir, con el token propio. */
export function friendLinkHere(token: string): string {
  return Linking.createURL(FRIEND_PATH, { queryParams: { t: token } });
}

export type MyFriendLinkState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly link: MyFriendLink; readonly url: string }
  | { readonly kind: 'failed'; readonly reason: 'offline' | 'limited' | 'rejected' };

export type MyFriendLinkControl = {
  readonly state: MyFriendLinkState;
  /**
   * Pide el enlace al servidor y devuelve la URL, o `null` si no pudo. Se
   * llama ANTES de cada compartir, a propósito: ver abajo.
   */
  readonly revalidate: () => Promise<string | null>;
  readonly rotate: () => Promise<boolean>;
  readonly rotating: boolean;
  /** Por qué no se pudo regenerar la última vez. El enlace de antes sigue valiendo. */
  readonly rotateFailure: 'offline' | 'limited' | 'rejected' | null;
};

/**
 * EL ENLACE PROPIO, SIEMPRE RECIÉN PEDIDO.
 *
 * **No se cachea entre aperturas, y eso es deliberado.** El token es estable
 * pero **rotable desde otro aparato**: compartir uno guardado en memoria
 * podría repartir un enlace que ya no vale, y el fallo sería silencioso —la
 * otra persona vería «este enlace ya no es válido» sin que aquí pasara
 * nada—. Compartir es una acción poco frecuente; una ida y vuelta al
 * servidor es barata comparada con repartir un enlace muerto.
 *
 * **Y no hay estado optimista al rotar.** Mientras `rotate_friend_link` no
 * confirme, el QR y el token que se ven siguen siendo los de antes: fingir el
 * cambio dejaría a la vista un QR que nadie puede escanear.
 */
export function useMyFriendLink(): MyFriendLinkControl {
  const [state, setState] = useState<MyFriendLinkState>({ kind: 'idle' });
  const [rotating, setRotating] = useState(false);
  const [rotateFailure, setRotateFailure] = useState<'offline' | 'limited' | 'rejected' | null>(
    null,
  );
  const inFlight = useRef(false);

  const revalidate = useCallback(async () => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setState((current) => (current.kind === 'ready' ? current : { kind: 'loading' }));
    try {
      const result = await fetchMyFriendLink();
      if (!result.ok) {
        setState({ kind: 'failed', reason: result.status === 0 ? 'offline' : 'rejected' });
        return null;
      }
      const url = friendLinkHere(result.data.token);
      setState({ kind: 'ready', link: result.data, url });
      return url;
    } finally {
      inFlight.current = false;
    }
  }, []);

  const rotate = useCallback(async () => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setRotating(true);
    setRotateFailure(null);
    try {
      const result = await sendRotateFriendLink();
      if (!result.ok) {
        /*
         * El enlace anterior NO se toca: sigue siendo el válido mientras el
         * servidor no diga lo contrario. Sólo se dice por qué no se pudo.
         */
        setRotateFailure(
          result.status === 0
            ? 'offline'
            : result.code === 'FRIEND_LINK_ROTATION_LIMITED'
              ? 'limited'
              : 'rejected',
        );
        return false;
      }
      setState({ kind: 'ready', link: result.data, url: friendLinkHere(result.data.token) });
      return true;
    } finally {
      setRotating(false);
      inFlight.current = false;
    }
  }, []);

  return { state, revalidate, rotate, rotating, rotateFailure };
}
