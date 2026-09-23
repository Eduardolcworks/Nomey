import { useCallback, useEffect, useState } from 'react';

import { onFriendsWake, subscribeFriendsChanged } from './friend-events';
import { fetchGroupFriendStatus } from './friend-service';
import type { GroupFriendState, GroupFriendStatus } from './group-friend';

export type GroupFriendMap = {
  /** El estado del actor con ese participante. `unavailable` mientras no se sepa. */
  readonly stateOf: (participantId: string) => GroupFriendState;
  /** El id de la solicitud pendiente, si la hay. */
  readonly requestOf: (participantId: string) => string | null;
  readonly loading: boolean;
  /** La última lectura falló; lo anterior sigue en pantalla. */
  readonly failed: boolean;
  readonly refresh: () => void;
};

/**
 * EL MAPA SOCIAL DEL GRUPO, con las MISMAS tres señales que el resto de
 * Amigos: el ámbito, `friendsChanged` y el `wake` del primer plano.
 *
 * **Se lee al abrir el grupo, no al tocar una fila.** El menú de un
 * participante necesita saber qué ofrecer ANTES de abrirse; pedirlo en el
 * toque habría dejado el menú esperando a un viaje de red o, peor, habría
 * obligado a abrirlo vacío y rellenarlo después. Una llamada por pantalla
 * es lo que cuesta, y el servidor la contesta con una consulta.
 *
 * **`unavailable` es el valor por defecto**, y eso es deliberado: mientras
 * no haya respuesta —cargando, sin red, un participante que el servidor no
 * listó— la fila no ofrece ninguna acción social. El modo seguro es no
 * ofrecer nada, nunca ofrecer algo que el servidor va a rehusar.
 *
 * **Sin polling y sin realtime**, como todo F12.E: tras crear, aceptar,
 * rechazar o cancelar, quien lo hizo publica `friendsChanged` y esto se
 * relee; lo que haga la otra persona llega en el siguiente primer plano.
 */
export function useGroupFriendStatus(scopeId: string, enabled: boolean): GroupFriendMap {
  const [held, setHeld] = useState<{
    readonly scopeId: string;
    readonly rows: ReadonlyMap<string, GroupFriendStatus>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  const active = scopeId !== '' && enabled;

  useEffect(() => {
    if (!active) return;
    let live = true;
    void (async () => {
      try {
        const loaded = await fetchGroupFriendStatus(scopeId);
        if (live) {
          setHeld({ scopeId, rows: new Map(loaded.map((row) => [row.participantId, row])) });
          setFailed(false);
        }
      } catch {
        if (live) setFailed(true);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [scopeId, active, tick]);

  useEffect(
    () =>
      subscribeFriendsChanged(() => {
        setTick((n) => n + 1);
      }),
    [],
  );

  useEffect(
    () =>
      onFriendsWake(() => {
        setTick((n) => n + 1);
      }),
    [],
  );

  const rows = active && held !== null && held.scopeId === scopeId ? held.rows : null;

  const stateOf = useCallback(
    (participantId: string): GroupFriendState => rows?.get(participantId)?.state ?? 'unavailable',
    [rows],
  );

  const requestOf = useCallback(
    (participantId: string): string | null => rows?.get(participantId)?.requestId ?? null,
    [rows],
  );

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  return { stateOf, requestOf, loading: active && loading, failed: active && failed, refresh };
}
