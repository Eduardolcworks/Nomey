import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { peekInvitation, subscribeInvitation } from './invitation-arrival';

/*
 * ═══════ EL OYENTE DE ENLACES YA NO VIVE AQUÍ ═══════
 *
 * Lo montaba este módulo (`useInvitationLink`) mientras la invitación era el
 * único enlace de producto. Desde F12.E.C hay dos —la invitación y el enlace
 * de amistad—, en features que no pueden importarse entre sí, así que cada
 * una habría montado el suyo: dos `Linking.addEventListener`, dos
 * `getInitialURL()` y un orden entre ellos decidido por el montaje.
 *
 * El oyente es ahora UNO y vive en `lib/linking`; la raíz le entrega los
 * sumideros. Aquí queda lo de esta feature: `arriveInvitation` reconoce lo
 * suyo (`invitation-arrival`) y este hook abre la hoja cuando toca. Nada de
 * lo que la invitación hacía cambió de comportamiento.
 */

/**
 * ABRE «ÚNETE» CUANDO HAY UNA INVITACIÓN ESPERANDO Y YA HAY SESIÓN. Vive en el
 * layout de las pestañas, que sólo se monta con sesión: es lo que hace que un
 * enlace recibido sin sesión se retome después de entrar. Empuja la hoja del
 * `+` sin parámetros —el token no va en la ruta— y la hoja lo recoge.
 */
export function useOpenPendingInvitation(signedIn: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!signedIn) return;
    const open = () => {
      router.push('/group-action');
    };
    if (peekInvitation() !== null) {
      const settle = setTimeout(open, 0);
      const stop = subscribeInvitation(open);
      return () => {
        clearTimeout(settle);
        stop();
      };
    }
    return subscribeInvitation(open);
  }, [signedIn, router]);
}
