import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { needsUsernameGate, useAccountIdentity } from '@/features/auth';
import {
  FriendLinkRequestWindow,
  peekFriendLink,
  takeFriendLink,
  useFriendLinkResponse,
} from '@/features/friends';
import { isGuest, useSession } from '@/features/session';
import { PlaceholderScreen } from '@/features/shell';

/**
 * RESPONDER A UN ENLACE DE AMISTAD RECIBIDO.
 *
 * **El token no viaja en la ruta.** Llega por `friend-link-arrival`, igual
 * que una invitación de grupo llega a la hoja de «Únete»: la URL la recogió
 * el único oyente de la raíz y dejó el token esperando. Así un enlace
 * pulsado, uno pegado y un QR escaneado recorren exactamente el mismo
 * camino, y el token no acaba en el estado de navegación.
 *
 * **Y no se consulta al servidor hasta que el actor puede responder**: sin
 * sesión, como invitado o sin username definitivo,
 * `api.preview_friend_link` contestaría antes de mirar el token. Esta ruta
 * es la única que ve la sesión y la identidad a la vez, así que la puerta la
 * pone aquí — la misma composición que usa Inicio.
 */
export default function FriendRequestScreen() {
  const router = useRouter();
  const { state: session } = useSession();
  const { state: identity } = useAccountIdentity();

  const token = peekFriendLink();
  const eligible =
    session.status === 'signed-in' && !isGuest(session) && !needsUsernameGate(identity);

  const responder = useFriendLinkResponse(token, eligible);

  /*
   * Sin nada que responder no hay pantalla: pudo llegarse aquí con el enlace
   * ya resuelto en otro sitio, o tras un reinicio que se llevó el token.
   */
  useEffect(() => {
    if (token === null) router.back();
  }, [token, router]);

  const done = () => {
    // Cerrar sin responder tampoco deja el enlace dando vueltas.
    takeFriendLink();
    router.back();
  };

  return (
    <PlaceholderScreen title="friendLink.requestTitle">
      {token === null ? null : <FriendLinkRequestWindow responder={responder} onDone={done} />}
    </PlaceholderScreen>
  );
}
