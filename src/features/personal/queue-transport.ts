/**
 * LOS MANEJADORES DE PERSONAL: del discriminante a la función de `api`.
 *
 * F07/ADR-001 §3: la entrada guarda un valor de vocabulario cerrado, y aquí se
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
 *
 * **Desde F9 esto es la mitad de Personal de un mapa compartido.** El runtime
 * vive en `lib/offline` y despacha por tipo de comando; la traducción y la
 * INTERPRETACIÓN DE LA RESPUESTA siguen aquí, que es donde se sabe qué
 * significa cada sobre. La raíz sólo junta los mapas.
 */

import type { CommandHandler, PersonalEntryPayload, TransportOutcome } from '@/lib/offline';

import type { RawWriteResponse } from './personal-service';

type PersonalCommandType = 'personal_expense.create' | 'personal_income.create';

function functionFor(commandType: PersonalCommandType) {
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
  payload: PersonalEntryPayload,
  signal?: AbortSignal,
) => Promise<RawWriteResponse>;

/**
 * @param send la puerta real. **Obligatorio, y no por gusto**: con un valor por
 * defecto este módulo importaría `personal-service` en ejecución, y con él el
 * cliente de Supabase y `react-native`; entonces el transporte dejaría de ser
 * comprobable en Vitest, que es donde se afirma que la señal llega. Quien lo
 * inyecta en producción es `use-entry-queue`, con `sendPersonalEntry`.
 */
/**
 * Los dos comandos de Personal, listos para el mapa que ensambla la raíz.
 *
 * @param send la puerta real. Sigue siendo obligatorio y por lo mismo: con un
 * valor por defecto este módulo importaría `personal-service` en ejecución, y
 * con él el cliente de Supabase y `react-native`.
 */
export function personalCommandHandlers(send: EntrySender): {
  readonly 'personal_expense.create': CommandHandler<'personal_expense.create'>;
  readonly 'personal_income.create': CommandHandler<'personal_income.create'>;
} {
  const handler =
    <K extends PersonalCommandType>(commandType: K): CommandHandler<K> =>
    async (payload, signal): Promise<TransportOutcome> => {
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
    };

  return {
    'personal_expense.create': handler('personal_expense.create'),
    'personal_income.create': handler('personal_income.create'),
  };
}
