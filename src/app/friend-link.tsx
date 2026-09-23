import { useRouter } from 'expo-router';

import { useAccountIdentity } from '@/features/auth';
import { FriendLinkWindow } from '@/features/friends';
import { useSession } from '@/features/session';

/**
 * «Tu enlace de amistad»: el QR propio y regenerar.
 *
 * Una ventana, no una pantalla de pestaña: se abre desde la cabecera de
 * Perfil y se cierra volviendo. La identidad la pone esta ruta —`features/`
 * no puede leer la sesión— y sale de `core`, que es la autoridad sobre lo
 * público (F12/ADR-001 §13): el nombre y el handle que se enseñan son los
 * mismos que verá quien escanee.
 *
 * La guarda es la del layout raíz: cuenta normal con username definitivo.
 * Un invitado no llega, y sin handle tampoco — `api.my_friend_link` los
 * rehúsa por su cuenta, y esto sólo evita ofrecer una puerta cerrada.
 */
export default function FriendLinkScreen() {
  const router = useRouter();
  const { state } = useSession();
  const { state: identity } = useAccountIdentity();

  const publicName =
    identity.status === 'ready'
      ? identity.identity.publicName
      : state.status === 'signed-in'
        ? state.identity.displayName
        : null;
  const handle = identity.status === 'ready' ? identity.identity.handle : null;

  return <FriendLinkWindow publicName={publicName} handle={handle} onClosed={router.back} />;
}
