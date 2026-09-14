import { useCallback, useEffect, useState } from 'react';

import { offlineCatalogueCache } from '@/lib/offline';

import { EMOJI_RECENTS_KEY, parseRecents, pushRecent, serialiseRecents } from './emoji-recents';

/**
 * Los emojis usados recientemente, por cuenta.
 *
 * **La identidad la pone quien llama**, como en el resto de la app: `features/`
 * no lee la sesión. Sin actor no se guarda nada — que es lo correcto: unos
 * recientes escritos sin cuenta acabarían en la casilla de la siguiente.
 *
 * La escritura no se espera. Si falla, se pierde una preferencia; bloquear la
 * elección de un emoji por eso sería peor que perderla.
 */
export function useEmojiRecents(actorId: string): {
  recents: readonly string[];
  remember: (emoji: string) => void;
} {
  const [recents, setRecents] = useState<readonly string[]>([]);

  useEffect(() => {
    if (actorId === '') return;

    let alive = true;
    void (async () => {
      try {
        const cache = await offlineCatalogueCache();
        const stored = await cache.read(actorId, EMOJI_RECENTS_KEY);
        if (alive) setRecents(parseRecents(stored?.document ?? null));
      } catch {
        // Sin recientes se sigue eligiendo igual: la cuadrícula está entera.
      }
    })();

    return () => {
      alive = false;
    };
  }, [actorId]);

  const remember = useCallback(
    (emoji: string) => {
      setRecents((current) => {
        const next = pushRecent(current, emoji);
        if (actorId !== '') {
          void (async () => {
            try {
              const cache = await offlineCatalogueCache();
              await cache.write(
                actorId,
                EMOJI_RECENTS_KEY,
                serialiseRecents(next),
                new Date().toISOString(),
              );
            } catch {
              // Ver arriba: es una preferencia, no un hecho.
            }
          })();
        }
        return next;
      });
    },
    [actorId],
  );

  return { recents, remember };
}
