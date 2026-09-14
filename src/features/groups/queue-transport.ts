import type { CommandHandler, TransportOutcome } from '@/lib/offline';

import type { GroupCreatePayload, RawGroupResponse } from './group-service';

/**
 * EL MANEJADOR DE GRUPOS: del discriminante a la función de `api`.
 *
 * Mitad de Grupos del mapa que ensambla la raíz. La traducción y la
 * **interpretación de la respuesta** viven aquí, que es donde se sabe qué
 * significa cada sobre; el runtime sólo despacha por tipo de comando.
 *
 * **No construye ni valida nada.** Manda el payload congelado tal cual, porque
 * cualquier reconstrucción cambiaría la intención canónica que el servidor
 * calcula y convertiría un replay en `IDEMPOTENCY_KEY_REUSED`.
 *
 * **Y no habla con Supabase.** Sale por `group-service`, que sigue siendo la
 * única puerta del dominio hacia el cliente: aquí no hay ningún `supabase.*`.
 */

/** Lo que hace `sendGroupCreate`, como tipo, para no importarlo en ejecución. */
export type GroupSender = (
  payload: GroupCreatePayload,
  signal?: AbortSignal,
) => Promise<RawGroupResponse>;

/**
 * @param send la puerta real. **Obligatorio, y no por gusto**: con un valor por
 * defecto este módulo importaría `group-service` en ejecución, y con él el
 * cliente de Supabase y `react-native`; entonces dejaría de ser comprobable en
 * Vitest, que es donde se afirma que la señal llega y que el replay confirma.
 */
export function groupCommandHandlers(send: GroupSender): {
  readonly 'group.create': CommandHandler<'group.create'>;
} {
  return {
    'group.create': async (payload, signal): Promise<TransportOutcome> => {
      try {
        /*
         * La señal se pasa a la petición, que la reenvía al `fetch`. No hay
         * `Promise.race`: cuando el plazo vence, **el socket se cierra**, y lo
         * que llega aquí es el rechazo del propio `fetch`.
         */
        const raw = await send(payload, signal);

        if (raw.envelope !== null && raw.code === null) {
          /*
           * ÉXITO Y REPLAY SON LA MISMA CONFIRMACIÓN.
           *
           * `replay: true` significa que el servidor ya lo había escrito y que
           * este intento llegó después —una respuesta perdida, un reintento tras
           * cerrar la app—. El grupo existe, es el mismo y tiene la misma gente:
           * no hay nada distinto que hacer, y por eso viaja como
           * `alreadyProcessed`, exactamente igual que en Personal.
           *
           * El identificador que se devuelve es el del ÁMBITO, que es lo que
           * este comando produce. Es el mismo `client_group_id` que se generó
           * antes de encolar, así que la identidad de la tarjeta no cambia al
           * confirmarse.
           */
          return {
            kind: 'ok',
            operationId: raw.envelope.scope_id,
            alreadyProcessed: raw.envelope.replay,
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
