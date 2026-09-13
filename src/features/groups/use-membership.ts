/**
 * LOS TRES HOOKS DE F09/ADR-003: salir, dar por saldado, y los avisos.
 *
 * Los dos comandos siguen el patrón de `useUpdateGroup`: una clave por
 * intención, conservada mientras la intención no cambie, para que reintentar
 * sea el MISMO comando y el servidor responda `already_processed` en vez de
 * escribir dos veces. Ninguno pasa por la cola durable: sin red, fallan y se
 * dice.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { newClientOperationId } from '@/lib/id';

import {
  publishGroupRecorded,
  publishNoticesSeen,
  subscribeGroupRecorded,
  subscribeNoticesSeen,
} from './group-events';
import {
  type BlockingOperation,
  blockingOperations,
  fetchGroupNotices,
  fetchMyNetPosition,
  type GroupNotice,
  markGroupNoticeRead,
  markGroupNoticesSeen,
  type PendingPair,
  type RetirementPayload,
  sendLeaveGroup,
  sendRetireParticipant,
  sendSettleParticipant,
  sendAssociateParticipant,
  sendUnclaimParticipant,
} from './membership-service';

export type MembershipFailure =
  | 'offline'
  | 'notMember'
  /** Con neto por pagar o por cobrar no se sale (F09/ADR-007 C8): a Pagos sugeridos. */
  | 'blockedDebt'
  | 'rejected';

/** Lo que `leave` devuelve: salió, o por qué no. Se devuelve, no se lee de un estado. */
export type LeaveOutcome = 'left' | MembershipFailure;

/**
 * Lo que `check` devuelve antes de preguntar: libre, bloqueado —con el neto
 * que lo bloquea, en unidades menores, para decir el motivo exacto— o sin
 * lectura. Se sale a NETO cero (F09/ADR-007 C8): quien debe 1 a A y cobra 1 de B
 * tiene neto cero y sale, y la salida reasigna esos pares sin dinero.
 */
export type LeaveCheck =
  | { readonly state: 'clear' }
  | { readonly state: 'blocked'; readonly net: bigint }
  | { readonly state: 'unknown' };

/**
 * SALIR. Idempotente por clave; el grupo desaparece por RLS al confirmarse.
 *
 * **Dos pasos, y el resultado se DEVUELVE.** `check` lee mi neto antes de
 * pedir confirmación: con neto distinto de cero, la pantalla dice que no se
 * puede salir y no pregunta; a cero, pregunta y `leave` escribe. `leave` devuelve su
 * resultado en la promesa —no en `failure`, que es un estado de React y en
 * el `then` de la misma pulsación todavía tiene el valor anterior; medido:
 * la primera pulsación bloqueada salía como error genérico y la siguiente
 * como bloqueo—. El servidor sigue siendo la autoridad: una deuda aparecida
 * entre la comprobación y la confirmación vuelve como `blockedDebt`.
 */
export function useLeaveGroup(): {
  readonly check: (scopeId: string) => Promise<LeaveCheck>;
  readonly leave: (scopeId: string) => Promise<LeaveOutcome>;
  readonly leaving: boolean;
  readonly failure: MembershipFailure | null;
} {
  const [leaving, setLeaving] = useState(false);
  const [failure, setFailure] = useState<MembershipFailure | null>(null);
  const key = useRef<{ scopeId: string; id: string } | null>(null);

  const check = useCallback(async (scopeId: string): Promise<LeaveCheck> => {
    try {
      const net = await fetchMyNetPosition(scopeId);
      return net !== 0n ? { state: 'blocked', net } : { state: 'clear' };
    } catch {
      /* Sin lectura no se afirma nada: se pregunta, y el servidor decide. */
      return { state: 'unknown' };
    }
  }, []);

  const leave = useCallback(async (scopeId: string): Promise<LeaveOutcome> => {
    if (key.current === null || key.current.scopeId !== scopeId) {
      key.current = { scopeId, id: newClientOperationId() };
    }
    setLeaving(true);
    setFailure(null);
    try {
      const response = await sendLeaveGroup({
        client_command_id: key.current.id,
        command_contract_version: 1,
        scope_id: scopeId,
      });
      if (response.ok) {
        key.current = null;
        /*
         * El mismo canal que el alta y la anulación: quien mire la lista de
         * grupos, Deudas de Inicio o los avisos vuelve a preguntar. El grupo ya
         * no llega: la RLS lo decide, no el cliente.
         */
        publishGroupRecorded(scopeId);
        return 'left';
      }
      const why = interpret(response.status, response.code);
      setFailure(why);
      return why;
    } catch {
      setFailure('offline');
      return 'offline';
    } finally {
      setLeaving(false);
    }
  }, []);

  return { check, leave, leaving, failure };
}

export type SettleFailure = MembershipFailure | 'stale' | 'retired' | 'linked';

/** Lo que `settle` resuelve: hecho, o el fallo de ESTE intento (ver `PaymentOutcome`). */
export type SettleOutcome = 'settled' | SettleFailure;

export type Retirement = {
  readonly settle: (args: {
    readonly scopeId: string;
    readonly participantId: string;
    readonly pairs: readonly PendingPair[];
  }) => Promise<SettleOutcome>;
  readonly settling: boolean;
  readonly failure: SettleFailure | null;
};

/** «Saldado» sobre quien salió (F09/ADR-003 §6). */
export function useSettleParticipant(): Retirement {
  return useRetirement(sendSettleParticipant);
}

/**
 * Retirar a un participante sin cuenta: la MISMA retirada, otra puerta del
 * servidor con otra guardia (sin cuenta, en vez de inactivo). `linked` es su
 * fallo propio: alguien lo reclamó entre que se enseñó y se confirmó.
 */
export function useRetireParticipant(): Retirement {
  return useRetirement(sendRetireParticipant);
}

function useRetirement(
  send: (payload: RetirementPayload) => ReturnType<typeof sendSettleParticipant>,
): Retirement {
  const [settling, setSettling] = useState(false);
  const [failure, setFailure] = useState<SettleFailure | null>(null);
  const key = useRef<{ fingerprint: string; id: string } | null>(null);

  const settle = useCallback(
    async (args: {
      readonly scopeId: string;
      readonly participantId: string;
      readonly pairs: readonly PendingPair[];
    }): Promise<SettleOutcome> => {
      const expected = args.pairs.map((pair) => ({
        debtor_participant_id: pair.debtorParticipantId,
        creditor_participant_id: pair.creditorParticipantId,
        amount: pair.amountMinor,
      }));
      const fingerprint = JSON.stringify([args.scopeId, args.participantId, expected]);
      if (key.current === null || key.current.fingerprint !== fingerprint) {
        key.current = { fingerprint, id: newClientOperationId() };
      }
      setSettling(true);
      setFailure(null);
      try {
        const response = await send({
          client_operation_id: key.current.id,
          command_contract_version: 1,
          scope_id: args.scopeId,
          participant_id: args.participantId,
          expected_pairs: expected,
        });
        if (response.ok) {
          key.current = null;
          publishGroupRecorded(args.scopeId);
          return 'settled';
        }
        const outcome: SettleFailure =
          response.code === 'SETTLEMENT_STALE'
            ? 'stale'
            : response.code === 'PARTICIPANT_RETIRED'
              ? 'retired'
              : response.code === 'PARTICIPANT_LINKED'
                ? 'linked'
                : interpret(response.status, response.code);
        setFailure(outcome);
        return outcome;
      } catch {
        setFailure('offline');
        return 'offline';
      } finally {
        setSettling(false);
      }
    },
    [send],
  );

  return { settle, settling, failure };
}

export type AssociateOutcome =
  | { readonly kind: 'done' }
  /** Otra cuenta o esta misma ya lo asoció, o ya tiene cuenta, o está retirado. */
  | { readonly kind: 'taken' }
  | { readonly kind: 'failed'; readonly failure: MembershipFailure };

/**
 * ASOCIAR UN FANTASMA A MI CUENTA (F09/ADR-009). Una clave por intención —ámbito
 * y participante—, conservada mientras no cambie: reintentar es el mismo
 * comando y responde el resultado original. Al confirmarse, saldos, pares,
 * Personal y Deudas cambian: quien mire vuelve a preguntar por el mismo canal
 * que cualquier escritura del grupo.
 */
export function useAssociateParticipant(): {
  readonly associate: (args: {
    readonly scopeId: string;
    readonly participantId: string;
  }) => Promise<AssociateOutcome>;
  readonly busy: boolean;
} {
  const [busy, setBusy] = useState(false);
  const key = useRef<{ fingerprint: string; id: string } | null>(null);

  const associate = useCallback(
    async (args: {
      readonly scopeId: string;
      readonly participantId: string;
    }): Promise<AssociateOutcome> => {
      const fingerprint = JSON.stringify([args.scopeId, args.participantId]);
      if (key.current === null || key.current.fingerprint !== fingerprint) {
        key.current = { fingerprint, id: newClientOperationId() };
      }
      setBusy(true);
      try {
        const response = await sendAssociateParticipant({
          client_command_id: key.current.id,
          command_contract_version: 1,
          scope_id: args.scopeId,
          participant_id: args.participantId,
        });
        if (response.ok) {
          key.current = null;
          publishGroupRecorded(args.scopeId);
          return { kind: 'done' };
        }
        if (
          response.code === 'PARTICIPANT_LINKED' ||
          response.code === 'PARTICIPANT_MERGED' ||
          response.code === 'PARTICIPANT_RETIRED'
        ) {
          return { kind: 'taken' };
        }
        return { kind: 'failed', failure: interpret(response.status, response.code) };
      } catch {
        return { kind: 'failed', failure: 'offline' };
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { associate, busy };
}

export type UnclaimOutcome =
  | { readonly kind: 'done' }
  /** El servidor lo rehusó por caja vigente: las operaciones que lo impiden. */
  | { readonly kind: 'blocked'; readonly operations: readonly BlockingOperation[] }
  /** El vínculo actual no lo creó esa reclamación, o no procede de una. */
  | { readonly kind: 'superseded' }
  | { readonly kind: 'failed'; readonly failure: MembershipFailure };

/**
 * RECTIFICAR UNA RECLAMACIÓN (F09/ADR-006). Una clave por intención —ámbito,
 * participante y reclamación—, conservada mientras no cambie: reintentar es
 * el mismo comando y responde el resultado original. Al confirmarse, el grupo
 * deja de llegar por RLS y quien mire la lista, Deudas o los avisos vuelve a
 * preguntar; la pantalla decide adónde ir.
 */
export function useUnclaimParticipant(): {
  readonly unclaim: (args: {
    readonly scopeId: string;
    readonly participantId: string;
    readonly claimCommandId: string;
  }) => Promise<UnclaimOutcome>;
  readonly busy: boolean;
} {
  const [busy, setBusy] = useState(false);
  const key = useRef<{ fingerprint: string; id: string } | null>(null);

  const unclaim = useCallback(
    async (args: {
      readonly scopeId: string;
      readonly participantId: string;
      readonly claimCommandId: string;
    }): Promise<UnclaimOutcome> => {
      const fingerprint = JSON.stringify([args.scopeId, args.participantId, args.claimCommandId]);
      if (key.current === null || key.current.fingerprint !== fingerprint) {
        key.current = { fingerprint, id: newClientOperationId() };
      }
      setBusy(true);
      try {
        const response = await sendUnclaimParticipant({
          client_command_id: key.current.id,
          command_contract_version: 1,
          scope_id: args.scopeId,
          participant_id: args.participantId,
          claim_command_id: args.claimCommandId,
        });
        if (response.ok) {
          key.current = null;
          publishGroupRecorded(args.scopeId);
          return { kind: 'done' };
        }
        if (response.code === 'UNCLAIM_BLOCKED_CASH') {
          return { kind: 'blocked', operations: blockingOperations(response.details) };
        }
        if (response.code === 'CLAIM_SUPERSEDED' || response.code === 'UNCLAIM_NOT_AVAILABLE') {
          return { kind: 'superseded' };
        }
        return { kind: 'failed', failure: interpret(response.status, response.code) };
      } catch {
        return { kind: 'failed', failure: 'offline' };
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { unclaim, busy };
}

/**
 * LOS AVISOS DE LA CAMPANA. Se releen al montar, cada vez que alguien escribe
 * en un grupo desde este aparato y cuando la campana da por vistos los suyos;
 * los de otros aparatos llegan al volver a abrir la campana. Marcar leído es
 * optimista: la fila se actualiza en local y se manda; si falla, se recarga y
 * manda el servidor.
 *
 * **`markSeen` es lo que hace la campana al abrirse**, y no es optimista: la
 * frontera es el aviso más reciente cargado, el servidor marca hasta ella y
 * sólo entonces se avisa a todas las listas para que relean. Si falla, nada
 * cambia y el punto sigue encendido: no se simula una lectura.
 */
export function useGroupNotices(actorId: string): {
  readonly notices: readonly GroupNotice[];
  readonly unread: number;
  readonly loading: boolean;
  /** La última lectura no llegó. La lista es lo último que se vio, o nada. */
  readonly failed: boolean;
  readonly reload: () => void;
  readonly markRead: (id: string) => Promise<void>;
  readonly markSeen: () => Promise<boolean>;
} {
  const [notices, setNotices] = useState<readonly GroupNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (actorId === '') return;
    let live = true;
    void (async () => {
      try {
        const rows = await fetchGroupNotices();
        if (live) {
          setNotices(rows);
          setFailed(false);
        }
      } catch {
        // Sin red no hay lista: se conserva lo último que se vio, y se dice.
        if (live) setFailed(true);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [actorId, tick]);

  useEffect(
    () =>
      subscribeGroupRecorded(() => {
        setTick((n) => n + 1);
      }),
    [],
  );

  useEffect(
    () =>
      subscribeNoticesSeen(() => {
        setTick((n) => n + 1);
      }),
    [],
  );

  const markSeen = useCallback(async (): Promise<boolean> => {
    // La frontera es el más reciente cargado; la lista llega ordenada así.
    const newest = notices[0];
    if (newest === undefined || !notices.some((one) => one.readAt === null)) return true;
    const response = await markGroupNoticesSeen(newest.id).catch(() => null);
    if (response === null || !response.ok) return false;
    publishNoticesSeen();
    return true;
  }, [notices]);

  const reload = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  const markRead = useCallback(async (id: string) => {
    const now = new Date().toISOString();
    setNotices((previous) =>
      previous.map((one) => (one.id === id && one.readAt === null ? { ...one, readAt: now } : one)),
    );
    const response = await markGroupNoticeRead(id).catch(() => null);
    if (response === null || !response.ok) setTick((n) => n + 1);
  }, []);

  // Sin sesión no hay avisos de nadie, se haya leído lo que se haya leído.
  const shown = actorId === '' ? [] : notices;
  return {
    notices: shown,
    unread: shown.filter((one) => one.readAt === null).length,
    loading: actorId !== '' && loading,
    failed,
    reload,
    markRead,
    markSeen,
  };
}

function interpret(status: number, code: string | null): MembershipFailure {
  if (status === 0) return 'offline';
  if (code === 'NOT_AUTHORIZED') return 'notMember';
  if (code === 'LEAVE_BLOCKED_DEBT') return 'blockedDebt';
  return 'rejected';
}
