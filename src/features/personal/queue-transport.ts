/**
 * EL TRANSPORTE DE LA COLA: del discriminante a la función de `api`.
 *
 * ADR-028 §3: la entrada guarda un valor de vocabulario cerrado, y aquí se
 * traduce con un `switch` **exhaustivo**. El `never` del caso por defecto es lo
 * que hace que añadir una clase al vocabulario **no compile** hasta que alguien
 * decida qué función le corresponde — que es exactamente la decisión que no
 * debe tomarse por descuido.
 *
 * **No construye ni valida nada.** Manda el payload congelado tal cual, porque
 * cualquier reconstrucción cambiaría la intención canónica que el servidor
 * calcula y convertiría un replay en `IDEMPOTENCY_KEY_REUSED`.
 *
 * **Y no habla con Supabase.** Sale por `personal-service`, que sigue siendo la
 * única puerta del dominio hacia el cliente: aquí no hay ningún `supabase.*`.
 */

import type {
  FrozenPayload,
  QueueCommandType,
  QueueTransport,
  TransportOutcome,
} from '@/lib/offline';

import type { RawWriteResponse } from './personal-service';

function functionFor(commandType: QueueCommandType) {
  switch (commandType) {
    case 'personal_expense.create':
      return 'record_personal_expense' as const;
    case 'personal_income.create':
      return 'record_personal_income' as const;
    default: {
      const exhaustive: never = commandType;
      throw new Error(`comando no enrutable: ${String(exhaustive)}`);
    }
  }
}

/** Lo que hace `sendPersonalEntry`, como tipo, para no importarlo en ejecución. */
export type EntrySender = (
  fn: 'record_personal_expense' | 'record_personal_income',
  payload: FrozenPayload,
  signal?: AbortSignal,
) => Promise<RawWriteResponse>;

/**
 * @param send la puerta real. **Obligatorio, y no por gusto**: con un valor por
 * defecto este módulo importaría `personal-service` en ejecución, y con él el
 * cliente de Supabase y `react-native`; entonces el transporte dejaría de ser
 * comprobable en Vitest, que es donde se afirma que la señal llega. Quien lo
 * inyecta en producción es `use-entry-queue`, con `sendPersonalEntry`.
 */
export function createQueueTransport(send: EntrySender): QueueTransport {
  return {
    async send(commandType, payload: FrozenPayload, signal): Promise<TransportOutcome> {
      try {
        /*
         * La señal se pasa a la petición, que la reenvía al `fetch`. No hay
         * `Promise.race`: cuando el plazo vence, **el socket se cierra**, y lo
         * que llega aquí es el rechazo del propio `fetch`.
         */
        const raw = await send(functionFor(commandType), payload, signal);

        if (raw.envelope !== null && raw.code === null) {
          return {
            kind: 'ok',
            operationId: raw.envelope.operation_id,
            alreadyProcessed: raw.envelope.already_processed,
          };
        }
        /*
         * Sin estado no se puede clasificar: `status: 0` es lo que deja un fallo
         * de red en `supabase-js`. Resultado desconocido, que es la fila
         * conservadora — el servidor pudo haberlo ejecutado.
         */
        if (raw.status === 0) return { kind: 'unreachable', reason: 'transport' };
        return { kind: 'http', status: raw.status, code: raw.code };
      } catch {
        /*
         * Un `AbortError` es indistinguible de no haber llegado, **y hay que
         * tratarlo igual**: cancelar en el cliente no demuestra que PostgreSQL
         * no haya ejecutado el comando. De ahí que la entrada y su clave se
         * conserven, y que quien lo resuelva sea el servidor en el reintento.
         */
        return { kind: 'unreachable', reason: signal.aborted ? 'timeout' : 'transport' };
      }
    },
  };
}
