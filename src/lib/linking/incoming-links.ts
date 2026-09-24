import * as Linking from 'expo-linking';
import { useEffect } from 'react';

/**
 * UN SOLO OYENTE DE ENLACES ENTRANTES, EN LA RAÍZ.
 *
 * Nomey recibe varias clases de enlace —una invitación a un grupo
 * (F09/ADR-004), un enlace de amistad (F12/ADR-006)— y cada una vive en su
 * propia feature. Una feature no puede importar a otra, así que si cada una
 * montara su `Linking.addEventListener`, la raíz acabaría con dos o tres
 * oyentes compitiendo por la misma URL: cada uno consultaría
 * `getInitialURL()` por su cuenta y el orden entre ellos sería el de montaje,
 * que nadie controla.
 *
 * Aquí el oyente es **uno**, vive en infraestructura y no sabe qué es un
 * grupo ni qué es una amistad: reparte la URL entre los sumideros que la raíz
 * le entrega, en orden, y cada uno reconoce la suya o la ignora. Añadir una
 * clase de enlace es añadir un sumidero, no un oyente.
 *
 * Cubre las tres formas de llegada: arranque en frío (`getInitialURL`), app
 * abierta (`url`) y app en segundo plano que vuelve por el enlace — las tres
 * son el mismo evento del sistema.
 *
 * **No navega y no decide nada.** Deja la URL donde cada feature la espera; a
 * quién le toca abrirla y cuándo lo decide la pantalla que corresponda, con
 * la sesión y la identidad delante.
 */
export type LinkSink = (url: string | null | undefined) => unknown;

export function useIncomingLinks(sinks: readonly LinkSink[]): void {
  useEffect(() => {
    let active = true;
    const deliver = (url: string | null | undefined) => {
      if (!active) return;
      for (const sink of sinks) {
        try {
          sink(url);
        } catch {
          // Un sumidero que falla no puede dejar sin URL a los demás.
        }
      }
    };

    void Linking.getInitialURL()
      .then(deliver)
      .catch(() => {
        // Sin URL de arranque, o el sistema no la dio: no hay nada que repartir.
      });
    const subscription = Linking.addEventListener('url', (event) => {
      deliver(event.url);
    });
    return () => {
      active = false;
      subscription.remove();
    };
    // `sinks` es una constante del módulo raíz: no se recrea y no re-suscribe.
  }, [sinks]);
}
