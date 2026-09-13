/**
 * UNIRSE A UN GRUPO: previsualizar lo pegado, y canjear. F09/ADR-004.
 *
 * **La previsualización va con freno y con número de serie.** Cada cambio del
 * texto espera 450 ms antes de preguntar —no una petición por carácter— y cada
 * petición lleva su número: la respuesta sólo cuenta si su número sigue siendo
 * el último, así que una respuesta antigua no valida un enlace que ya cambió.
 * Lo que no parece una invitación no se pregunta: se dice sin ir al servidor.
 *
 * **El canje conserva su clave** mientras la intención —token y elección— no
 * cambie: reintentar es el mismo comando y el servidor responde
 * `already_processed`. Un conflicto de reclamación (`PARTICIPANT_ALREADY_CLAIMED`)
 * es recuperable: se vuelve a previsualizar y se enseñan las opciones nuevas.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { newClientOperationId } from '@/lib/id';

import { publishGroupRecorded } from './group-events';
import { readInvitation } from './invitation-link';
import {
  type InvitationPreview,
  previewInvitation,
  type RedeemChoice,
  redeemInvitation,
} from './invitation-service';

export const PREVIEW_DEBOUNCE_MS = 450;

export type PreviewStatus =
  /** Campo vacío, o todavía sin nada que preguntar. */
  | { readonly kind: 'idle' }
  /** El texto no es una invitación de Nomey: no se pregunta. */
  | { readonly kind: 'notInvitation' }
  | { readonly kind: 'checking'; readonly token: string }
  | {
      readonly kind: 'ready';
      readonly token: string;
      readonly preview: InvitationPreview & { state: 'ok' };
    }
  | {
      readonly kind: 'unusable';
      readonly token: string;
      readonly state: 'invalid' | 'revoked' | 'expired' | 'throttled';
    }
  | { readonly kind: 'offline'; readonly token: string };

export function useInvitationPreview(): {
  readonly text: string;
  readonly setText: (next: string) => void;
  readonly status: PreviewStatus;
  /** Vuelve a preguntar por el mismo token (tras un conflicto, por ejemplo). */
  readonly refresh: () => void;
} {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<PreviewStatus>({ kind: 'idle' });
  const [tick, setTick] = useState(0);
  const serial = useRef(0);

  useEffect(() => {
    const token = readInvitation(text);
    const mine = ++serial.current;
    if (token === null) {
      // Sin petición: el estado se decide aquí, en el siguiente fotograma, para
      // no escribir estado de forma síncrona dentro del efecto.
      const settle = setTimeout(() => {
        if (serial.current === mine)
          setStatus(text.trim() === '' ? { kind: 'idle' } : { kind: 'notInvitation' });
      }, 0);
      return () => clearTimeout(settle);
    }
    const wait = setTimeout(() => {
      if (serial.current !== mine) return;
      setStatus({ kind: 'checking', token });
      void previewInvitation(token)
        .then((preview) => {
          if (serial.current !== mine) return;
          setStatus(
            preview.state === 'ok'
              ? { kind: 'ready', token, preview }
              : { kind: 'unusable', token, state: preview.state },
          );
        })
        .catch(() => {
          if (serial.current === mine) setStatus({ kind: 'offline', token });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(wait);
  }, [text, tick]);

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  return { text, setText, status, refresh };
}

export type JoinFailure = 'offline' | 'claimed' | 'rejoinPending' | 'unusable' | 'rejected';

export function useRedeemInvitation(): {
  readonly redeem: (args: {
    readonly token: string;
    readonly choice: RedeemChoice;
  }) => Promise<string | null>;
  readonly joining: boolean;
  readonly failure: JoinFailure | null;
} {
  const [joining, setJoining] = useState(false);
  const [failure, setFailure] = useState<JoinFailure | null>(null);
  const key = useRef<{ fingerprint: string; id: string } | null>(null);

  const redeem = useCallback(
    async (args: { readonly token: string; readonly choice: RedeemChoice }) => {
      const fingerprint = JSON.stringify([args.token, args.choice]);
      if (key.current === null || key.current.fingerprint !== fingerprint) {
        key.current = { fingerprint, id: newClientOperationId() };
      }
      setJoining(true);
      setFailure(null);
      try {
        const result = await redeemInvitation({
          client_command_id: key.current.id,
          token: args.token,
          choice: args.choice,
        });
        if (result.state === 'ok') {
          key.current = null;
          // La lista de grupos y Deudas de Inicio vuelven a preguntar: ahora hay uno más.
          publishGroupRecorded(result.scopeId);
          return result.scopeId;
        }
        if (result.state === 'failed') {
          setFailure(
            result.status === 0
              ? 'offline'
              : result.code === 'PARTICIPANT_ALREADY_CLAIMED' ||
                  result.code === 'PARTICIPANT_NOT_IN_SCOPE'
                ? 'claimed'
                : result.code === 'REJOIN_NOT_AVAILABLE' || result.code === 'REJOIN_REQUIRED'
                  ? 'rejoinPending'
                  : 'rejected',
          );
          return null;
        }
        setFailure('unusable');
        return null;
      } catch {
        setFailure('offline');
        return null;
      } finally {
        setJoining(false);
      }
    },
    [],
  );

  return { redeem, joining, failure };
}
