import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { EntryScope } from './entry-enqueue';
import type { DateRange } from './interval';
import { type ProjectedHome, projectHome, type ProjectionSnapshot } from './projection';
import { publishQueueChange, subscribeQueueChanges } from './queue-events';
import { forgetProjecting, noteProjecting, queueStore } from './queue-runtime';
import type { PersonalHome } from './use-personal-home';
import type { QueueEntry } from '@/lib/offline/queue-entry';

/**
 * LO QUE INICIO PINTA: el snapshot del servidor más la cola del actor.
 *
 * Este hook es el único consumidor de `projectHome`, y todas las superficies
 * leen lo que devuelve (ADR-028 §8, límite 4). Hace tres cosas, y ninguna es
 * aritmética:
 *
 * 1. **Relee la cola** cuando cambia: al encolar, cuando el worker anota una
 *    respuesta, y al podar. Lo que lee es la entrada durable —lo único local
 *    que existe— y lo tiene en memoria sólo para este render.
 * 2. **Pide el refresco autoritativo** cuando el worker confirma algo (§9):
 *    la proyección sigue pintando la entrada hasta que ese refresco demuestre
 *    que el snapshot ya la contiene.
 * 3. **Poda** las entradas que las tres superficies han retirado, en un efecto
 *    posterior al render: la fila del servidor ya está pintada con la clave
 *    heredada, así que quitar la entrada no cambia ni un píxel.
 *
 * **Los alias se recuerdan mientras viva la pantalla**, no en disco: sirven
 * para que la fila del servidor conserve la clave local después de podar, y una
 * app que se reabre pinta esa fila con su `operation_id` desde el principio,
 * sin transición que estabilizar.
 */

const NO_ENTRIES: readonly QueueEntry[] = [];

const EMPTY_HOME: ProjectedHome = {
  operations: [],
  total: 0,
  balance: null,
  statistics: null,
  reconciled: [],
  aliases: new Map(),
  unreconciled: 0,
};

/** La cola leída, y los alias que ya se conocían al leerla. */
type Local = {
  readonly entries: readonly QueueEntry[];
  /** `operation_id` del servidor → clave local. Sólo crece. */
  readonly aliases: ReadonlyMap<string, string>;
};

const NOTHING: Local = { entries: NO_ENTRIES, aliases: new Map() };

/**
 * Incorpora a los alias conocidos los de las entradas confirmadas que hay ahora
 * en la cola. Se hace AL LEER, que es cuando la entrada todavía existe: después
 * de podarla, el alias es lo único que recuerda que aquella fila fue local.
 */
function withAliases(known: ReadonlyMap<string, string>, entries: readonly QueueEntry[]) {
  let next: Map<string, string> | null = null;
  for (const entry of entries) {
    if (entry.resultOperationId === null) continue;
    if (known.get(entry.resultOperationId) === entry.clientOperationId) continue;
    next ??= new Map(known);
    next.set(entry.resultOperationId, entry.clientOperationId);
  }
  return next ?? known;
}

export function useProjectedHome(
  home: PersonalHome,
  scope: EntryScope | null,
  range: DateRange,
  actorId: string,
): ProjectedHome {
  const [local, setLocal] = useState<Local>(NOTHING);
  /** Podas en vuelo, para no borrar dos veces mientras la primera no vuelve. */
  const pruning = useRef(new Set<string>());
  const refresh = home.refresh;

  const reload = useCallback(
    (alive: () => boolean) => {
      if (actorId === '') return;
      void (async () => {
        try {
          const entries = await (await queueStore()).pending(actorId);
          if (!alive()) return;
          setLocal((previous) => ({ entries, aliases: withAliases(previous.aliases, entries) }));
        } catch {
          // Sin base no hay cola que leer: se proyecta el snapshot solo, y el
          // worker ya cuenta esa avería como fallo local con su backoff.
        }
      })();
    },
    [actorId],
  );

  useEffect(() => {
    let alive = true;
    const isAlive = () => alive;
    reload(isAlive);

    const unsubscribe = subscribeQueueChanges((change) => {
      if (change.actorId !== actorId) return;
      reload(isAlive);
      /*
       * §9: al confirmar, refresco autoritativo. La entrada sigue proyectada
       * hasta que el snapshot que traiga —con el `seq` capturado al arrancar—
       * demuestre que ya la contiene. Un terminal también relee: `pending` ya no
       * lo devuelve, y así la proyección se revierte entera (§8, límite 7).
       */
      if (change.kind === 'progress' && change.state === 'confirmed') refresh();
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [actorId, reload, refresh]);

  // Sin actor no hay cola: lo que hubiera en memoria era de otra cuenta.
  const visible = actorId === '' ? NOTHING : local;

  /*
   * WHAT IS ON SCREEN, PUBLISHED FOR THE BARRIER.
   *
   * The only consumer is the unreadable-barrier path of `snapshot-window.ts`:
   * with SQLite broken nothing can be proven, but "the projection is painting
   * no local rows" is a fact about this component, not about the database, and
   * it is enough to let a valid remote read through without any risk of
   * counting anything twice. Nothing accounting comes out of it.
   */
  useEffect(() => {
    if (actorId === '') return;
    noteProjecting(actorId, visible.entries.length);
    return () => {
      forgetProjecting(actorId);
    };
  }, [actorId, visible.entries.length]);

  const snapshot: ProjectionSnapshot = useMemo(
    () => ({
      balance:
        home.balance !== null && home.snapshot.balanceSeq !== null
          ? { amount: home.balance.amount, seq: home.snapshot.balanceSeq }
          : null,
      /*
       * A FAILED REFRESH DOES NOT DESTROY A GOOD BASE.
       *
       * What qualifies a block as a base is that it came from a quiet window,
       * and that is exactly what `intervalSeq` records; `status` says something
       * else — whether the LAST attempt worked. Reading `status` here made a
       * lost network drop a snapshot that was still perfectly usable: Ingresos,
       * Gastos and the breakdown fell back to "not available" while the balance,
       * which lives in its own state, kept working. Measured on the device.
       *
       * It is the same discipline as a superseded response: the previous base is
       * older than everything now in doubt, so the projection keeps summing on
       * top of it and no figure disappears. `status` still drives the retry
       * notice, which is what it is for.
       */
      interval:
        home.snapshot.intervalSeq !== null
          ? {
              statistics: home.statistics,
              operations: home.operations,
              total: home.total,
              seq: home.snapshot.intervalSeq,
            }
          : null,
    }),
    [
      home.balance,
      home.snapshot.balanceSeq,
      home.snapshot.intervalSeq,
      home.statistics,
      home.operations,
      home.total,
    ],
  );

  const projected = useMemo(
    () =>
      scope === null
        ? EMPTY_HOME
        : projectHome({
            scope,
            range,
            entries: visible.entries,
            snapshot,
            aliases: visible.aliases,
          }),
    [scope, range, visible, snapshot],
  );

  // La poda, después de pintar: lo retirado ya no cambia nada en pantalla.
  useEffect(() => {
    if (actorId === '') return;
    const ids = projected.reconciled.filter((id) => !pruning.current.has(id));
    if (ids.length === 0) return;
    for (const id of ids) pruning.current.add(id);

    void (async () => {
      try {
        const store = await queueStore();
        for (const id of ids) {
          await store.remove(actorId, id);
          publishQueueChange({
            kind: 'pruned',
            actorId,
            clientOperationId: id,
            state: 'confirmed',
          });
        }
      } catch {
        // Se volverá a intentar en la siguiente proyección: la entrada sigue
        // retirada de todas las superficies, así que no se ve.
      } finally {
        for (const id of ids) pruning.current.delete(id);
      }
    })();
  }, [projected.reconciled, actorId]);

  return projected;
}
