/**
 * LA LISTA DE GRUPOS, proyectada. Snapshot del servidor + cola local.
 *
 * Tres fuentes y una sola salida:
 *
 *   `api.group_profile`   lo confirmado, filtrado por la RLS de la membresía
 *   la cola durable       lo creado en este aparato y todavía no reconciliado
 *   `confirmSequence`     la marca con la que se decide qué ya sobra (§9)
 *
 * **La marca se lee ANTES de la consulta.** Es lo que hace que `confirm_seq <=
 * snapshot.seq` signifique «el servidor ya la tenía cuando esto arrancó».
 * Leerla después incluiría confirmaciones ocurridas durante el viaje, y una
 * creación recién confirmada dejaría de pintarse un instante antes de aparecer
 * en el snapshot: el grupo parpadearía.
 *
 * **Sin snapshot NO se esconde nada.** Si la consulta falla —sin red, por
 * ejemplo— la lista es exactamente lo local, que es la verdad disponible: lo
 * que esta persona ha creado en este aparato. Nunca una lista vacía que
 * afirmara que no tiene grupos.
 *
 * **Aislada por cuenta, y sin un solo fotograma de fuga.** Las dos mitades se
 * guardan CON el actor del que son, y sólo se usan si coincide con el de ahora.
 * Guardarlas sueltas dejaría lo de la cuenta anterior en pantalla durante el
 * viaje de la consulta nueva, que es exactamente el instante en el que nadie
 * está mirando.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SessionStatus } from '@/lib/offline';
import { queueStore, subscribeQueueChanges } from '@/lib/offline';
import type { QueueEntry } from '@/lib/offline/queue-entry';

import { subscribeGroupRecorded } from './group-events';
import { type ProjectedGroup, projectGroups } from './group-projection';
import { fetchReopenedDebt, type ReopenedDebt } from './payment-service';
import {
  fetchGroupPositions,
  fetchGroups,
  type GroupPositionRow,
  type RemoteGroup,
} from './group-service';

export type GroupsState = {
  readonly groups: readonly ProjectedGroup[];
  /** El primer viaje todavía no ha terminado y no hay nada confirmado que dar. */
  readonly loading: boolean;
  /**
   * El servidor no contestó.
   *
   * **No vacía la lista**: lo local sigue pintándose. Está para que la pantalla
   * pueda decir que lo que enseña puede estar incompleto, no para esconderlo.
   */
  readonly stale: boolean;
  /**
   * La deuda reabierta acotada de los grupos de los que ya no soy miembro
   * (F09/ADR-007 C6), por divisa. `null` mientras no se ha podido leer: Deudas
   * de Inicio no afirma un cero sin ella.
   */
  readonly reopened: readonly ReopenedDebt[] | null;
  readonly refresh: () => void;
};

/** Lo que se leyó, y de quién. El actor viaja con el dato, nunca aparte. */
type Owned<T> = { readonly actorId: string; readonly value: T };

const NOTHING: Owned<null> = { actorId: '', value: null };

export function useGroups(actorId: string, status: SessionStatus): GroupsState {
  const [snapshot, setSnapshot] = useState<Owned<readonly RemoteGroup[] | null>>(NOTHING);
  /*
   * Las posiciones viajan aparte del perfil porque son OTRA vista y pueden
   * fallar por su cuenta. Si llega la lista y no llegan éstas, se pintan los
   * grupos con la posición no disponible, que es la verdad de lo que se sabe.
   */
  const [positions, setPositions] = useState<Owned<readonly GroupPositionRow[] | null>>(NOTHING);
  const [reopened, setReopened] = useState<Owned<readonly ReopenedDebt[] | null>>(NOTHING);
  const [snapshotSeq, setSnapshotSeq] = useState(0);
  const [entries, setEntries] = useState<Owned<readonly QueueEntry[]>>({
    actorId: '',
    value: [],
  });
  const [loading, setLoading] = useState<Owned<boolean>>({ actorId: '', value: true });
  const [stale, setStale] = useState<Owned<boolean>>({ actorId: '', value: false });
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  /*
   * Alguien acaba de escribir en un grupo —un gasto, una edición del perfil—:
   * la lista, sus posiciones y el nombre de la cabecera pueden haber cambiado.
   * El bus que ya existía para los movimientos; no una segunda mecánica.
   */
  useEffect(() => {
    return subscribeGroupRecorded(() => {
      setTick((value) => value + 1);
    });
  }, []);

  const signedIn = actorId !== '' && status === 'signed-in';

  /* Lo local, releído en cada cambio de la cola. Nunca depende de la red. */
  useEffect(() => {
    if (actorId === '') return;
    let alive = true;

    const reread = () => {
      void (async () => {
        try {
          const rows = await (await queueStore()).all(actorId);
          if (alive) setEntries({ actorId, value: rows });
        } catch {
          // Sin base local no hay nada local que pintar. El snapshot sigue.
          if (alive) setEntries({ actorId, value: [] });
        }
      })();
    };

    reread();
    const unsubscribe = subscribeQueueChanges((change) => {
      if (change.actorId === actorId) reread();
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [actorId, tick]);

  /* Y lo confirmado, con su marca leída ANTES de preguntar. */
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;

    void (async () => {
      /*
       * La marca primero, y si la base no responde, cero. Cero no retira nada
       * —`confirm_seq` empieza en uno— así que lo local se sigue pintando, que
       * es el lado seguro: como mucho se ve un grupo que ya está confirmado, y
       * la identidad impide que salga dos veces.
       */
      let seq = 0;
      try {
        seq = await (await queueStore()).confirmSequence(actorId);
      } catch {
        seq = 0;
      }

      /*
       * Las dos lecturas salen a la vez y se resuelven por separado, con
       * `Promise.allSettled` y no `all`: un fallo de las posiciones tiraría
       * también la lista de grupos, y quedarse sin ver los grupos porque no se
       * pudo saber cuánto se debe es perder lo que sí se sabía.
       */
      const [profiles, nets, debts] = await Promise.allSettled([
        fetchGroups(),
        fetchGroupPositions(),
        fetchReopenedDebt(),
      ]);
      if (!alive) return;

      if (profiles.status === 'fulfilled') {
        setSnapshotSeq(seq);
        setSnapshot({ actorId, value: profiles.value });
      } else {
        // El snapshot anterior se conserva: es más verdad que ninguno.
        setStale({ actorId, value: true });
      }

      if (nets.status === 'fulfilled') {
        setPositions({ actorId, value: nets.value });
      } else {
        setStale({ actorId, value: true });
      }

      /* La deuda reabierta va con las posiciones: es la otra mitad de Deudas. */
      if (debts.status === 'fulfilled') {
        setReopened({ actorId, value: debts.value });
      } else {
        setStale({ actorId, value: true });
      }

      /* Fresco sólo si las TRES llegaron: media lectura no es una lectura. */
      if (
        profiles.status === 'fulfilled' &&
        nets.status === 'fulfilled' &&
        debts.status === 'fulfilled'
      ) {
        setStale({ actorId, value: false });
      }

      setLoading({ actorId, value: false });
    })();

    return () => {
      alive = false;
    };
  }, [actorId, signedIn, tick]);

  /* Sólo cuenta lo que es de ESTA cuenta. Lo de otra no es «todavía no llegó». */
  const mine = <T>(owned: Owned<T>, fallback: T): T =>
    owned.actorId === actorId && actorId !== '' ? owned.value : fallback;

  const rows = mine(snapshot, null);
  const local = mine(entries, [] as readonly QueueEntry[]);
  const nets = mine(positions, null);

  const groups = useMemo(
    () => projectGroups({ snapshot: rows, snapshotSeq, entries: local, positions: nets }),
    [rows, snapshotSeq, local, nets],
  );

  return useMemo(
    () => ({
      groups,
      loading: signedIn && rows === null && mine(loading, true),
      stale: signedIn && mine(stale, false),
      reopened: mine(reopened, null),
      refresh,
    }),
    // `mine` se recrea en cada render y no aporta nada a la identidad del valor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, signedIn, rows, loading, stale, refresh, actorId],
  );
}
