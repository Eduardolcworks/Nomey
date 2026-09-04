import { describe, expect, it } from 'vitest';

import {
  publishQueueChange,
  queueListenerCount,
  subscribeQueueChanges,
} from '../../src/features/personal/queue-events';

describe('los cambios de la cola se anuncian sin transportar contenido', () => {
  it('entrega a cada oyente y deja de hacerlo al cancelar', () => {
    const seen: string[] = [];
    const stop = subscribeQueueChanges((change) => {
      seen.push(`${change.kind}:${change.state}`);
    });

    publishQueueChange({ kind: 'enqueued', actorId: 'a', clientOperationId: 'k', state: 'queued' });
    stop();
    publishQueueChange({
      kind: 'progress',
      actorId: 'a',
      clientOperationId: 'k',
      state: 'confirmed',
    });

    expect(seen).toEqual(['enqueued:queued']);
    expect(queueListenerCount()).toBe(0);
  });

  it('UN OYENTE QUE LANZA NO ROMPE AL QUE ANUNCIA ni a los demás', () => {
    const seen: string[] = [];
    const stopBroken = subscribeQueueChanges(() => {
      throw new Error('oyente roto');
    });
    const stopFine = subscribeQueueChanges((change) => {
      seen.push(change.clientOperationId);
    });

    expect(() =>
      publishQueueChange({
        kind: 'pruned',
        actorId: 'a',
        clientOperationId: 'k',
        state: 'confirmed',
      }),
    ).not.toThrow();
    expect(seen).toEqual(['k']);

    stopBroken();
    stopFine();
    expect(queueListenerCount()).toBe(0);
  });

  it('el anuncio lleva sólo de quién, cuál y a qué estado', () => {
    let received: object | null = null;
    const stop = subscribeQueueChanges((change) => {
      received = change;
    });
    publishQueueChange({
      kind: 'progress',
      actorId: 'a',
      clientOperationId: 'k',
      state: 'retryable',
    });
    stop();
    expect(Object.keys(received ?? {}).sort()).toEqual([
      'actorId',
      'clientOperationId',
      'kind',
      'state',
    ]);
  });
});
