import { useCallback, useRef, useState } from 'react';

import { newClientOperationId } from '@/lib/id';

import type { CreateAnswer } from './friend-candidate';
import { publishFriendsChanged } from './friend-events';
import { failureFrom, type FriendFailure } from './friend-errors';
import { sendCreateFriendRequestToParticipant } from './friend-service';

/**
 * Lo que el servidor contestó, literal. `unavailable` es el participante
 * vinculado a una cuenta que todavía no puede ser amiga de nadie —sin
 * username definitivo, o invitada—: no es un error de quien pide, así que no
 * se pinta como tal; la fila simplemente deja de ofrecer la acción.
 */
export type ParticipantFriendAnswer = CreateAnswer | { readonly state: 'unavailable' };

export type AddParticipantFriendOutcome =
  | { readonly kind: 'answered'; readonly answer: ParticipantFriendAnswer }
  | { readonly kind: 'failed'; readonly failure: FriendFailure };

export type AddParticipantFriend = {
  readonly add: (participantId: string) => Promise<AddParticipantFriendOutcome>;
  /** El participante sobre el que hay una petición en vuelo, o `null`. */
  readonly busy: string | null;
  readonly failure: FriendFailure | null;
};

/**
 * PEDIR AMISTAD DESDE LA FILA DEL GRUPO.
 *
 * **Una clave por participante, guardada hasta que el servidor conteste**
 * (F03/ADR-007), igual que al pedir por `@username`: reintentar tras un fallo
 * de transporte reusa la misma `client_command_id`, así que una petición que
 * SÍ llegó y perdió la respuesta se replica —el servidor devuelve lo que
 * persistió con esa clave— en vez de mandar una segunda. Otro participante
 * recibe una clave nueva, y la clave se suelta en cuanto el servidor habla,
 * conteste lo que conteste.
 *
 * **Nada se interpreta aquí.** La respuesta se devuelve literal para que la
 * pantalla la aplique: `pending`, `incoming_pending` (la cruzada: la otra
 * persona ya había pedido y no se insertó una segunda fila), `friends`,
 * `cooldown` o `unavailable`. `not_found` no puede darse por esta puerta: no
 * se resuelve ningún username.
 *
 * **Y no se pinta nada como hecho que el servidor no haya confirmado.** Un
 * fallo de transporte (`offline`) no publica `friendsChanged` ni cambia el
 * mapa: la solicitud podría estar creada en el servidor, y enseñar «Añadir
 * amigo» o «Solicitud enviada» sin saberlo sería inventarse un estado.
 */
export function useAddParticipantFriend(): AddParticipantFriend {
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<FriendFailure | null>(null);
  const inFlight = useRef(false);
  const keys = useRef(new Map<string, string>());

  const add = useCallback<AddParticipantFriend['add']>(async (participantId) => {
    if (inFlight.current) return { kind: 'failed', failure: 'rejected' };
    inFlight.current = true;

    let key = keys.current.get(participantId);
    if (key === undefined) {
      key = newClientOperationId();
      keys.current.set(participantId, key);
    }

    setBusy(participantId);
    setFailure(null);
    try {
      const result = await sendCreateFriendRequestToParticipant({
        client_command_id: key,
        command_contract_version: 1,
        participant_id: participantId,
      });
      if (result.ok) {
        keys.current.delete(participantId);
        publishFriendsChanged();
        return { kind: 'answered', answer: result.data };
      }
      const reason = failureFrom(result.status, result.code);
      // Sólo un fallo de transporte conserva la clave: el servidor puede tenerla.
      if (reason !== 'offline') keys.current.delete(participantId);
      setFailure(reason);
      return { kind: 'failed', failure: reason };
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  }, []);

  return { add, busy, failure };
}
