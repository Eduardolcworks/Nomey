import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { peekFriendLink, subscribeFriendLink } from './friend-link-arrival';

/**
 * ABRE LA RESPUESTA CUANDO HAY UN ENLACE ESPERANDO Y SE PUEDE RESPONDER.
 *
 * Hermana de `useOpenPendingInvitation`, y con la misma forma: vive en el
 * layout de las pestañas —que sólo se monta con sesión y con el gate de
 * username pasado—, así que un enlace recibido antes de tiempo se retoma
 * solo. Quien decide que se puede responder es quien la monta; aquí no se
 * lee ni la sesión ni la identidad.
 *
 * Empuja la pantalla **sin parámetros**: el token no viaja en la ruta, lo
 * recoge la pantalla de `friend-link-arrival`. Y cubre los dos casos —el
 * enlace que ya estaba esperando al montarse, y el que llega con la app
 * abierta— porque son el mismo enlace por dos caminos.
 */
export function useOpenPendingFriendLink(enabled: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const open = () => {
      router.push('/friend-request');
    };
    if (peekFriendLink() !== null) {
      const settle = setTimeout(open, 0);
      const stop = subscribeFriendLink(open);
      return () => {
        clearTimeout(settle);
        stop();
      };
    }
    return subscribeFriendLink(open);
  }, [enabled, router]);
}
