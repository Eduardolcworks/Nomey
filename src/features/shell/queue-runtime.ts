import { useEffect } from 'react';

import {
  type CommandHandlers,
  ensureWorker,
  queueStore,
  type SessionStatus,
  setQueueIdentity,
} from '@/lib/offline';

/**
 * QUIEN GOBIERNA EL WORKER, DESDE LA RAÍZ Y UNA SOLA VEZ.
 *
 * El runtime —la tienda, la cola, el coordinador, la secuencia por actor y la
 * barrera— vive en `lib/offline`, porque desde F9 lo comparten Personal y
 * Grupos y **las features no pueden importarse entre sí**: dejarlo en una de
 * ellas habría obligado a la otra a montar un segundo worker y una segunda
 * persistencia, que es lo que F07/ADR-001 §12 prohíbe.
 *
 * Lo que vive aquí es el **ciclo de vida**: es una preocupación de armazón, no
 * de infraestructura ni de un dominio. `features/shell` no importa a ninguna
 * feature y no sabe qué comandos existen; recibe el reparto ya hecho.
 *
 * Los disparadores, y de dónde sale cada uno:
 *
 *   encolar              quien encola, tras persistir
 *   primer plano         `wakeQueue`, desde el `onForeground` del
 *                        `SessionProvider` — el listener de `AppState` que F5 ya
 *                        tenía. NO hay un segundo listener.
 *   reconexión           NetInfo, suscrito por el runtime
 *   sesión y actor       este hook, al cambiar `actorId` o `status`
 *   vencer un plazo      el planificador del coordinador
 *
 * **La identidad no se captura**: los puertos la consultan en cada pasada, así
 * que un cambio de cuenta lo ve el worker sin recrearse y sin poder enviar nada
 * de la anterior.
 *
 * @param actorId el `sub` de la sesión, o cadena vacía si no hay.
 * @param status el estado de la sesión.
 * @param handlers quién manda cada tipo de comando. Lo ensambla la raíz, que es
 * la única capa que puede conocer a todas las features a la vez.
 */
export function useQueueRuntime(
  actorId: string,
  status: SessionStatus,
  handlers: CommandHandlers,
): void {
  /*
   * En un efecto y no en el render: un render puede descartarse, y la cola
   * habría quedado apuntando a una identidad que nunca se pintó.
   */
  useEffect(() => {
    setQueueIdentity(actorId, status);
  }, [actorId, status]);

  useEffect(() => {
    let alive = true;
    /*
     * La limpieza se guarda AQUÍ y no se devuelve desde dentro del `async`: lo
     * que devuelve un IIFE asíncrono se pierde, y la suscripción quedaría viva
     * para siempre.
     */
    let teardown: (() => void) | null = null;

    void (async () => {
      try {
        const { coordinator, connectivity } = await ensureWorker(handlers);
        if (!alive) return;

        const stopConnectivity = connectivity.subscribe((connected) => {
          if (connected) coordinator.wake();
        });
        teardown = () => {
          // Segundo plano, desmontaje, cierre de sesión o cambio de cuenta:
          // se desarma todo y las filas se quedan como están.
          coordinator.stop();
          stopConnectivity();
        };
        if (!alive) {
          teardown();
          return;
        }

        if (status !== 'signed-in' || actorId === '') {
          // Sin sesión no hay nada que enviar: parado, con la cola intacta.
          coordinator.stop();
          return;
        }

        /*
         * Reparar en disco lo que quedó `sending`, y arrancar. Es higiene: el
         * store ya relee toda `sending` como `queued` (F07/ADR-001 §6), así que un
         * fallo aquí no impide despertar — el worker contará esa base como
         * fallo local y la reintentará con backoff.
         */
        try {
          await (await queueStore()).recoverSending(actorId);
        } catch {
          // Se dirá en la pasada, con su etapa y sin contenido.
        }
        coordinator.wake();
      } catch {
        // Sin base no hay cola. No se rompe la pantalla; se dirá al encolar.
      }
    })();

    return () => {
      alive = false;
      teardown?.();
    };
    /*
     * `handlers` NO entra en las dependencias a propósito: el worker es uno solo
     * y se crea la primera vez, así que rehacer el efecto porque la raíz haya
     * construido otro objeto con las mismas funciones lo pararía y lo
     * arrancaría sin motivo, en mitad de un envío.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId, status]);
}
