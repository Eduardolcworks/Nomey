import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { arriveInvitation, peekInvitation, subscribeInvitation } from './invitation-arrival';

/**
 * ESCUCHA LOS ENLACES DE INVITACIÓN. Va en la raíz —como el de recuperación—
 * para no perder llegadas mientras la rama de sesión cambia: el enlace puede
 * llegar con la app fría (`getInitialURL`), en la pantalla de entrar, o con la
 * app abierta (`url`). Sólo deja el token en `invitation-arrival`; no navega.
 */
export function useInvitationLink(): void {
  useEffect(() => {
    let active = true;
    void Linking.getInitialURL()
      .then((url) => {
        if (active) arriveInvitation(url);
      })
      .catch(() => {
        // Sin URL de arranque, o el sistema no la dio: no hay invitación.
      });
    const subscription = Linking.addEventListener('url', (event) => {
      if (active) arriveInvitation(event.url);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
}

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
