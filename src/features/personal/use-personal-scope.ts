import { getLocales } from 'expo-localization';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ensurePersonalScope } from './personal-service';
import { createScopeFlight } from './scope-flight';
import {
  type EnsureScopeResult,
  IDLE,
  type PersonalScopeState,
  recallScope,
  recommendedCurrencyCode,
  rememberScope,
  scopeFromResult,
} from './personal-scope';
import { offlineCatalogueCache } from '@/lib/offline';

/**
 * Asegura el Modo Personal del actor, una vez, al entrar.
 *
 * Es el cableado que F6.A dejó pendiente y que el handoff marca como
 * **obligatorio y antes de que Inicio consuma el ámbito**.
 *
 * **Por qué no hay bucle**, que era el riesgo señalado:
 *
 * - el efecto depende **sólo** de un contador que se mueve cuando alguien pulsa
 *   reintentar, y del actor. Nada que cambie por render entra en sus
 *   dependencias;
 * - un `ref` de vuelo en curso impide que dos renders lancen dos llamadas —y
 *   aunque fallara, la frontera es idempotente **por estado** y devolvería el
 *   mismo ámbito, sin crear un segundo ni deshacer la moneda elegida;
 * - un fallo **no reintenta solo**. Se queda en `unavailable`, con salida, y
 *   espera a que la persona lo pida. Reintentar en bucle contra un backend
 *   caído gasta batería sin arreglar nada.
 *
 * **Y sin red, el ámbito sale del respaldo local** (F7.D). La frontera es
 * idempotente por estado y devuelve siempre el mismo ámbito para la misma
 * cuenta, así que el último resultado correcto se guarda por actor y se usa
 * cuando la llamada falla. Sin él, la hoja de alta no sabría dónde cae el
 * movimiento y un arranque en frío sin red no podría pintar las intenciones
 * locales — que es justo lo que ADR-028 §8 exige que se vea. El respaldo es
 * SOLO respaldo: mientras hay red, manda el servidor, y lo que él devuelve es
 * lo que se guarda.
 *
 * **Ningún `setState` síncrono dentro del efecto**: un estado escrito en el
 * cuerpo del efecto provoca un render en cascada antes de que nadie haya
 * pintado el primero. El estado inicial ya es `idle`, que `isResolving` trata
 * igual que `provisioning`. Quien sí puede anunciar el vuelo es `retry`, que es
 * un manejador de evento.
 *
 * **No se desmonta al cambiar de cuenta**, porque no hace falta: salir tira la
 * rama protegida entera —`Stack.Protected` la deja de registrar en el mismo
 * commit—, así que entrar con otra cuenta monta este hook de cero.
 *
 * @param actorId el `sub` de la sesión, o cadena vacía si no hay. El respaldo
 * está aislado por cuenta (ADR-028 §13): sin actor no se lee ni se escribe.
 */
export function usePersonalScope(actorId: string): {
  state: PersonalScopeState;
  retry: () => void;
} {
  const [state, setState] = useState<PersonalScopeState>(IDLE);
  const [attempt, setAttempt] = useState(0);
  /*
   * EL VUELO, no un booleano. La diferencia está en `scope-flight.ts`: una
   * invocación cancelada por React descarta el resultado —un componente
   * desmontado nunca escribe— pero ya no impide que la siguiente, que sigue
   * viva, se suscriba al mismo vuelo y lo aplique.
   */
  const flight = useRef(createScopeFlight<EnsureScopeResult>());

  useEffect(() => {
    let alive = true;
    let answered = false;

    /*
     * EL RESPALDO SE LEE A LA VEZ, NO DESPUÉS. Sin red, `fetch` puede tardar
     * mucho en rendirse —el sistema no siempre falla al instante—, y esperarlo
     * dejaría la hoja de alta bloqueada en «Preparando» con un ámbito que ya
     * se conoce. Como la frontera es idempotente por estado, el ámbito guardado
     * ES el que va a devolver: se pinta ya, y cuando el servidor contesta manda
     * él —si contesta, sobrescribe; si falla, se queda lo guardado—.
     */
    void (async () => {
      const cached = await recall(actorId);
      if (alive && !answered && cached !== null) setState(cached);
    })();

    const subscription = flight.current.join(
      /*
       * La moneda de la REGION, no la del idioma. `expo-localization` expone
       * las dos y son distintas; el handoff señala expresamente que usar la
       * segunda es el error. Si el dispositivo no la da, se manda `null` y la
       * frontera aplica su propio fallback en vez de que lo invente el cliente.
       */
      () => ensurePersonalScope(recommendedCurrencyCode(getLocales())),
      {
        value: (result) => {
          answered = true;
          const ready = scopeFromResult(result);
          setState(ready);
          // El respaldo se escribe DESPUÉS de pintar, no se espera y no lanza.
          if (ready.status === 'ready') void remember(actorId, ready);
        },
        error: () => {
          /*
           * Sin red, el respaldo. Recuperable y con salida si tampoco lo hay,
           * igual que `unavailable` de F5.B. No se registra el objeto de error:
           * `AGENTS.md` §8 prohíbe volcar cuerpos que pueden llevar importes o
           * descripciones a los logs de plataforma.
           */
          answered = true;
          void (async () => {
            const cached = await recall(actorId);
            if (!alive) return;
            setState(cached ?? { status: 'unavailable' });
          })();
        },
      },
    );

    return () => {
      alive = false;
      subscription.cancel();
    };
  }, [attempt, actorId]);

  const retry = useCallback(() => {
    // En un manejador, no en un efecto: aquí sí corresponde anunciar el vuelo,
    // para que el error deje de verse en cuanto se pulsa.
    setState({ status: 'provisioning' });
    setAttempt((value) => value + 1);
  }, []);

  return { state, retry };
}

/*
 * Abrir la base es lo único que queda aquí: la forma del documento, el aislamiento
 * por actor y el veredicto viven en `personal-scope.ts`, donde se prueban contra
 * un SQLite de verdad. Abrirla también puede fallar, y tampoco es asunto de quien
 * acaba de entrar.
 */
async function remember(
  actorId: string,
  scope: Extract<PersonalScopeState, { status: 'ready' }>,
): Promise<void> {
  try {
    await rememberScope(await offlineCatalogueCache(), actorId, scope, new Date().toISOString());
  } catch {
    // Sin base no hay respaldo.
  }
}

async function recall(
  actorId: string,
): Promise<Extract<PersonalScopeState, { status: 'ready' }> | null> {
  try {
    return await recallScope(await offlineCatalogueCache(), actorId);
  } catch {
    return null;
  }
}
