import { getLocales } from 'expo-localization';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ensurePersonalScope } from './personal-service';
import {
  IDLE,
  type PersonalScopeState,
  recommendedCurrencyCode,
  scopeFromResult,
} from './personal-scope';

/**
 * Asegura el Modo Personal del actor, una vez, al entrar.
 *
 * Es el cableado que F6.A dejó pendiente y que el handoff marca como
 * **obligatorio y antes de que Inicio consuma el ámbito**.
 *
 * **Por qué no hay bucle**, que era el riesgo señalado:
 *
 * - el efecto depende **sólo** de un contador que se mueve cuando alguien pulsa
 *   reintentar. Nada que cambie por render entra en sus dependencias;
 * - un `ref` de vuelo en curso impide que dos renders lancen dos llamadas —y
 *   aunque fallara, la frontera es idempotente **por estado** y devolvería el
 *   mismo ámbito, sin crear un segundo ni deshacer la moneda elegida;
 * - un fallo **no reintenta solo**. Se queda en `unavailable`, con salida, y
 *   espera a que la persona lo pida. Reintentar en bucle contra un backend
 *   caído gasta batería sin arreglar nada.
 *
 * **Ningún `setState` síncrono dentro del efecto**, y no es sólo por callar al
 * linter: un estado escrito en el cuerpo del efecto provoca un render en
 * cascada antes de que nadie haya pintado el primero. El estado inicial ya es
 * `idle`, que `isResolving` trata igual que `provisioning`, así que no hace
 * falta anunciar el vuelo desde dentro. Quien sí puede hacerlo es `retry`, que
 * es un manejador de evento.
 *
 * **No se desmonta al cambiar de cuenta**, porque no hace falta: salir tira la
 * rama protegida entera —`Stack.Protected` la deja de registrar en el mismo
 * commit—, así que entrar con otra cuenta monta este hook de cero.
 */
export function usePersonalScope(): {
  state: PersonalScopeState;
  retry: () => void;
} {
  const [state, setState] = useState<PersonalScopeState>(IDLE);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    let cancelled = false;

    void (async () => {
      try {
        /*
         * La moneda de la REGION, no la del idioma. `expo-localization` expone
         * las dos y son distintas; el handoff señala expresamente que usar la
         * segunda es el error. Si el dispositivo no la da, se manda `null` y la
         * frontera aplica su propio fallback en vez de que lo invente el
         * cliente.
         */
        const result = await ensurePersonalScope(recommendedCurrencyCode(getLocales()));
        if (!cancelled) setState(scopeFromResult(result));
      } catch {
        // Recuperable y con salida, igual que `unavailable` de F5.B. No se
        // registra el objeto de error: `AGENTS.md` §8 prohíbe volcar cuerpos que
        // pueden llevar importes o descripciones a los logs de plataforma.
        if (!cancelled) setState({ status: 'unavailable' });
      } finally {
        inFlight.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    // En un manejador, no en un efecto: aquí sí corresponde anunciar el vuelo,
    // para que el error deje de verse en cuanto se pulsa.
    setState({ status: 'provisioning' });
    setAttempt((value) => value + 1);
  }, []);

  return { state, retry };
}
