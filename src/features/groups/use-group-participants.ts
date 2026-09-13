import { useCallback, useEffect, useState } from 'react';

import type { SessionStatus } from '@/lib/offline';
import { groupPayloadOf, queueStore, subscribeQueueChanges } from '@/lib/offline';
import type { QueueEntry } from '@/lib/offline/queue-entry';

import { subscribeGroupRecorded } from './group-events';
import type { GroupParticipant } from './participant-service';
import { fetchGroupParticipants } from './participant-service';

/**
 * LOS PARTICIPANTES DE UN GRUPO. **Y también los de un grupo aún sin confirmar.**
 *
 * Dos fuentes, la misma salida, exactamente el mismo criterio que `useGroups`:
 *
 *   `api.group_participant`   lo confirmado, filtrado por la RLS de la membresía
 *   la cola durable           lo creado en este aparato y todavía sin viajar
 *
 * **La cola manda cuando la hay.** Un grupo recién creado sin red no está en
 * ninguna vista del servidor, así que sin esto la ventana de añadir gasto se
 * abriría con la lista vacía sobre un grupo que la tarjeta pinta con cuatro
 * personas — dos verdades distintas del mismo grupo, y la peor visible justo
 * donde hay que elegir entre quiénes se reparte.
 *
 * **Las identidades son las mismas.** `client_participant_id` es la que el
 * cliente generó y la que el servidor conserva, igual que `client_group_id` es
 * el `scope_id`: confirmarse no cambia ninguna, así que la lista no salta y una
 * elección hecha antes de confirmar sigue apuntando a la misma persona.
 *
 * **El creador va primero y con su nombre.** En el payload viaja aparte
 * —`creator_participant_id`—, porque es el único con vínculo de cuenta; en la
 * lista es un participante más, que es lo que es para el reparto.
 */
export type GroupParticipantsState = {
  readonly participants: readonly GroupParticipant[];
  readonly loading: boolean;
  /** El servidor no contestó. No vacía la lista: lo local sigue valiendo. */
  readonly stale: boolean;
  readonly refresh: () => void;
};

export function useGroupParticipants(
  scopeId: string,
  actorId: string,
  status: SessionStatus,
): GroupParticipantsState {
  const [remote, setRemote] = useState<readonly GroupParticipant[] | null>(null);
  const [local, setLocal] = useState<readonly GroupParticipant[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  /*
   * Alguien acaba de escribir en ESTE grupo —un gasto, o una edición que dio
   * de alta participantes—: hay algo nuevo que leer. El mismo bus que ya usan
   * los movimientos, así que el contador de la cabecera y el reparto del gasto
   * se enteran sin una segunda mecánica.
   */
  useEffect(() => {
    return subscribeGroupRecorded((changed) => {
      if (changed === scopeId) setTick((value) => value + 1);
    });
  }, [scopeId]);

  /* Lo local, releído en cada cambio de la cola. Nunca depende de la red. */
  useEffect(() => {
    if (actorId === '') return;
    let alive = true;

    const reread = () => {
      void (async () => {
        try {
          const entries = await (await queueStore()).all(actorId);
          if (alive) setLocal(localParticipants(entries, scopeId));
        } catch {
          // Sin cola no hay nada local que añadir; lo remoto sigue valiendo.
          if (alive) setLocal(null);
        }
      })();
    };

    reread();
    const stop = subscribeQueueChanges((change) => {
      if (change.actorId === actorId) reread();
    });
    return () => {
      alive = false;
      stop();
    };
  }, [actorId, scopeId]);

  useEffect(() => {
    if (scopeId === '' || actorId === '' || status !== 'signed-in') return;
    let alive = true;

    void (async () => {
      try {
        const rows = await fetchGroupParticipants(scopeId);
        if (!alive) return;
        setRemote(rows);
        setStale(false);
      } catch {
        // El grupo puede no existir todavía en el servidor: no es un error que
        // deba vaciar nada, sólo que lo que hay es lo local.
        if (alive) setStale(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [scopeId, actorId, status, tick]);

  /*
   * LO LOCAL GANA, y no es una preferencia: si la creación sigue en la cola es
   * que el servidor todavía no la ha confirmado, así que su lista es la única
   * completa. En cuanto se confirma, la entrada se retira y manda la remota.
   */
  /*
   * ═══════ EL SERVIDOR MANDA EN CUANTO CONOCE EL GRUPO ═══════
   *
   * Lo local es la creación encolada: sirve mientras el grupo no está en el
   * servidor, y sólo entonces. Antes prevalecía siempre, y como la entrada
   * confirmada sigue en la cola, la lista se quedaba congelada en los
   * participantes declarados al crear: los añadidos después por «Modificar
   * grupo» —ya activos en `api.group_participant`— no salían en «Repartir
   * entre». Un grupo siempre tiene al menos a quien lo creó, así que una
   * respuesta vacía significa «todavía no visible», y ahí sí vale lo local.
   */
  const confirmed = remote !== null && remote.length > 0;

  return {
    participants: confirmed ? remote : (local ?? remote ?? []),
    loading: loading && local === null,
    stale,
    refresh,
  };
}

/** Los participantes que una creación local declara para ESTE grupo. */
function localParticipants(
  entries: readonly QueueEntry[],
  scopeId: string,
): readonly GroupParticipant[] | null {
  for (const entry of entries) {
    const payload = groupPayloadOf(entry.commandType, entry.payload);
    if (payload === null || payload.client_group_id !== scopeId) continue;

    return [
      {
        participantId: payload.creator_participant_id,
        displayName: payload.creator_display_name,
        createdAt: entry.createdAt,
        presence: null,
        /*
         * SE SABE, Y SÓLO AQUÍ: esta creación la hizo ESTE aparato con ESTA
         * cuenta, así que `creator_participant_id` es el participante de quien
         * mira — no una coincidencia de nombre, sino la identidad que el propio
         * cliente acuñó y que el servidor enlaza.
         *
         * **Dura lo que dure la entrada en la cola.** Al confirmarse se retira y
         * manda la lista remota, que no publica el vínculo: por eso esto no
         * sustituye a la superficie de lectura que falta, sólo la adelanta
         * mientras la creación sigue sin reconciliar.
         */
        isSelf: true,
        // Y su cuenta es la del vínculo que el servidor abre al crear (F09/ADR-002).
        isLinked: true,
        hasHistory: false,
        claimCommandId: null,
        mergedInto: null,
      },
      ...payload.participants.map((one) => ({
        participantId: one.client_participant_id,
        displayName: one.display_name,
        createdAt: entry.createdAt,
        presence: null,
        // Los demás se declararon por su nombre y nada más: no tienen cuenta
        // enlazada todavía, así que aquí sí se sabe que no son quien mira.
        isSelf: false,
        isLinked: false,
        hasHistory: false,
        claimCommandId: null,
        mergedInto: null,
      })),
    ];
  }

  return null;
}
