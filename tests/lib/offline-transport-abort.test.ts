import { describe, expect, it, vi } from 'vitest';

import { createQueueTransport } from '../../src/features/personal/queue-transport';
import type { RawWriteResponse } from '../../src/features/personal/personal-service';

/**
 * CANCELACIÓN REAL, no una espera abandonada.
 *
 * `@supabase/postgrest-js@2.112.4` expone `.abortSignal(signal)` en
 * `PostgrestTransformBuilder`, y `rpc()` devuelve un `PostgrestFilterBuilder`
 * que hereda de él; el builder base lo reenvía al `fetch` como `signal`. Leído
 * del paquete instalado.
 *
 * Lo que se comprueba aquí es la mitad que un test puede comprobar: que la
 * señal **llega** al transporte, que **pasa a `aborted`** cuando vence el
 * plazo, y que **no queda una petición viva** esperando. Que el socket se cierre
 * de verdad lo hace `abortSignal`, y esa parte se demostró leyendo su
 * implementación, no adivinándola.
 */

const PAYLOAD = {
  client_operation_id: '11111111-1111-4111-8111-111111111111',
  command_contract_version: 2,
  scope_id: '22222222-2222-4222-8222-222222222222',
  currency_definition_id: '33333333-3333-4333-8333-333333333333',
  amount: '1230',
  effective_date: '2026-09-03',
  effective_time: '21:40',
  concept: 'Cena',
  category_id: '44444444-4444-4444-8444-444444444444',
} as const;

describe('la señal llega a la petición', () => {
  it('el transporte le pasa la MISMA señal que recibió', async () => {
    let vista: AbortSignal | undefined;
    const send = vi.fn(
      async (_fn: string, _p: unknown, signal?: AbortSignal): Promise<RawWriteResponse> => {
        vista = signal;
        return {
          status: 200,
          code: null,
          envelope: { operation_id: 'op', already_processed: false },
        };
      },
    );
    const controller = new AbortController();

    await createQueueTransport(send).send('personal_expense.create', PAYLOAD, controller.signal);

    expect(send).toHaveBeenCalledTimes(1);
    expect(vista).toBe(controller.signal);
  });

  it('la función de `api` se elige por el discriminante, no se adivina', async () => {
    /*
     * Los parámetros se declaran aunque el cuerpo no los use: sin ellos,
     * `mock.calls` es una tupla vacía y no se puede afirmar qué función de `api`
     * recibió cada llamada, que es justo lo que este test comprueba.
     */
    const send = vi.fn(
      async (
        _fn: 'record_personal_expense' | 'record_personal_income',
      ): Promise<RawWriteResponse> => ({
        status: 200,
        code: null,
        envelope: null,
      }),
    );
    const controller = new AbortController();
    const transport = createQueueTransport(send);

    await transport.send('personal_expense.create', PAYLOAD, controller.signal);
    await transport.send('personal_income.create', PAYLOAD, controller.signal);

    expect(send.mock.calls.map((call) => call[0])).toEqual([
      'record_personal_expense',
      'record_personal_income',
    ]);
  });

  it('el payload viaja TAL CUAL, sin reconstruirse', async () => {
    // Reconstruirlo cambiaría la intención canónica del servidor y convertiría
    // un replay en `IDEMPOTENCY_KEY_REUSED`.
    let visto: unknown;
    const send = vi.fn(async (_fn: string, payload: unknown): Promise<RawWriteResponse> => {
      visto = payload;
      return { status: 200, code: null, envelope: null };
    });

    await createQueueTransport(send).send(
      'personal_expense.create',
      PAYLOAD,
      new AbortController().signal,
    );

    expect(visto).toBe(PAYLOAD);
  });
});

describe('al vencer el plazo', () => {
  it('LA SEÑAL PASA A `aborted` Y LA PETICIÓN SE ENTERA', async () => {
    let abortada = false;
    /*
     * El doble de `sendPersonalEntry` se comporta como el `fetch` real con una
     * señal: se queda esperando y **rechaza cuando la abortan**. Eso es lo que
     * hace `abortSignal`, y es lo que distingue cancelar de abandonar.
     */
    const send = (_fn: string, _p: unknown, signal?: AbortSignal): Promise<RawWriteResponse> =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          abortada = true;
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });

    const controller = new AbortController();
    const pending = createQueueTransport(send).send(
      'personal_expense.create',
      PAYLOAD,
      controller.signal,
    );

    controller.abort();
    const outcome = await pending;

    expect(abortada).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    // Y el transporte resuelve: NO queda una promesa colgada esperando a nadie.
    expect(outcome).toEqual({ kind: 'unreachable', reason: 'timeout' });
  });

  it('un `AbortError` es resultado DESCONOCIDO, no un rechazo', async () => {
    /*
     * Cancelar en el cliente **no demuestra** que PostgreSQL no lo haya
     * ejecutado. Si esto devolviera algo terminal, el worker daría por no
     * escrito un movimiento que quizá está escrito.
     */
    const controller = new AbortController();
    controller.abort();
    const send = () => Promise.reject(new DOMException('Aborted', 'AbortError'));

    const outcome = await createQueueTransport(send).send(
      'personal_expense.create',
      PAYLOAD,
      controller.signal,
    );

    expect(outcome).toEqual({ kind: 'unreachable', reason: 'timeout' });
  });

  it('un fallo de red sin abortar se distingue del plazo', async () => {
    const send = () => Promise.reject(new TypeError('Network request failed'));

    const outcome = await createQueueTransport(send).send(
      'personal_expense.create',
      PAYLOAD,
      new AbortController().signal,
    );

    expect(outcome).toEqual({ kind: 'unreachable', reason: 'transport' });
  });

  it('`status: 0` —lo que deja supabase-js sin red— también es desconocido', async () => {
    const send = async (): Promise<RawWriteResponse> => ({
      status: 0,
      code: null,
      envelope: null,
    });

    const outcome = await createQueueTransport(send).send(
      'personal_expense.create',
      PAYLOAD,
      new AbortController().signal,
    );

    expect(outcome).toEqual({ kind: 'unreachable', reason: 'transport' });
  });
});
