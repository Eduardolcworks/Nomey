import { useCallback, useRef, useState } from 'react';

import { currentClockTime, toMinorUnits } from './movement-entry';
import { todayInDeviceCalendar } from './interval';
import { recordAdjustment } from './personal-service';
import { newClientOperationId } from '@/lib/id';

export type AdjustStatus = 'idle' | 'saving' | 'failed';

/**
 * Fijar el Disponible, una vez, aunque se pulse dos veces.
 *
 * **Declara el saldo, no la diferencia.** Se manda `target_balance` y el
 * servidor deriva el delta **bajo lock y después del CAS** (ADR-022): es la
 * única forma de que la diferencia no salga de una lectura que pudo quedarse
 * vieja entre que se abrió la ventana y se pulsó guardar. El cliente no resta
 * nada, y no debe.
 *
 * **La fecha y la hora son las de AHORA.** «Mi saldo debe ser X» es una frase
 * sobre el presente; esta pantalla no reconstruye un saldo histórico y por eso
 * no tiene selector de fecha. Se toman del reloj local y no de UTC, por lo
 * mismo que en el alta: el par fecha+hora es un reloj de pared (ADR-020 §3).
 *
 * **Misma disciplina de idempotencia que el alta y la anulación**: la clave se
 * genera antes del primer intento y se conserva mientras la intención no
 * cambie, así que un reintento tras un fallo de red lleva la misma clave y la
 * frontera responde `already_processed` en vez de escribir un segundo ajuste.
 *
 * **Y el doble envío se corta con una referencia, no con el estado.**
 * `useState` es asíncrono: dos pulsaciones en el mismo fotograma leerían las
 * dos el valor viejo. La comprobación va antes de cualquier `await`.
 */
export function useAdjustBalance(
  scope: { scopeId: string; currencyDefinitionId: string; currencyScale: number } | null,
) {
  const [status, setStatus] = useState<AdjustStatus>('idle');
  const keys = useRef(new Map<string, string>());
  const inFlight = useRef(false);

  const adjust = useCallback(
    async (amount: string): Promise<boolean> => {
      if (scope === null) return false;
      if (inFlight.current) return false;

      const target = toMinorUnits(amount, scope.currencyScale);
      if (target === null) return false;

      inFlight.current = true;

      /*
       * La huella de la INTENCIÓN: el ámbito y el saldo declarado. La fecha y
       * la hora quedan fuera a propósito — se recalculan en cada intento, y
       * meterlas haría que un reintento un minuto después fuera un comando
       * nuevo y escribiera un segundo ajuste.
       */
      const intent = `${scope.scopeId} ${target.toString()}`;
      let key = keys.current.get(intent);
      if (key === undefined) {
        key = newClientOperationId();
        keys.current.set(intent, key);
      }

      setStatus('saving');
      try {
        await recordAdjustment({
          client_operation_id: key,
          command_contract_version: 2,
          scope_id: scope.scopeId,
          currency_definition_id: scope.currencyDefinitionId,
          target_balance: target.toString(),
          effective_date: todayInDeviceCalendar(),
          effective_time: currentClockTime(),
        });
        setStatus('idle');
        return true;
      } catch {
        // El motivo no se pinta: los códigos de la frontera son contrato, no
        // interfaz. Quien compone la pantalla da el mensaje.
        setStatus('failed');
        return false;
      } finally {
        inFlight.current = false;
      }
    },
    [scope],
  );

  return { status, adjust };
}
