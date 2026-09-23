import { useCallback, useRef, useState } from 'react';

import {
  handleToResolve,
  RECIPIENT_IDLE,
  recipientFromAnswer,
  recipientFromChoice,
  type RecipientState,
  recipientStale,
} from './recipient';
import { resolveUsername } from './transfer-service';

export type RecipientLookup = {
  readonly text: string;
  readonly setText: (next: string) => void;
  readonly state: RecipientState;
  /** Whether the current text can be sent to the resolver right now. */
  readonly canSearch: boolean;
  readonly search: () => void;
  readonly reset: () => void;
  /**
   * Alguien elegido en el selector de Amigos (F12.E.E). Deja el MISMO
   * `found` que deja una búsqueda, sin llamar a nada: el handle ya lo
   * publicó `api.my_friends`, y volver a resolverlo gastaría una de las
   * veinte consultas del resolver para confirmar lo que se acaba de leer.
   */
  readonly choose: (handle: string, publicName: string) => void;
};

/**
 * ONE LOOKUP PER EXPLICIT SEARCH, never per keystroke.
 *
 * The resolver is throttled at 20 lookups per 10 minutes per actor
 * (F12/ADR-001 §10). Asking on every character would burn that budget on
 * the way to typing `@eduardo` and would also be a global-autocomplete the
 * backend deliberately does not offer. The person types the full handle and
 * asks; the text is validated locally first so an impossible handle never
 * costs a lookup.
 */
export function useResolveRecipient(): RecipientLookup {
  const [text, setTextRaw] = useState('');
  const [state, setState] = useState<RecipientState>(RECIPIENT_IDLE);
  const request = useRef(0);

  const setText = useCallback((next: string) => {
    setTextRaw(next);
    setState((current) => {
      if (!recipientStale(current, next)) return current;
      request.current += 1;
      return RECIPIENT_IDLE;
    });
  }, []);

  const target = handleToResolve(text);
  const canSearch =
    target !== null &&
    'handle' in target &&
    state.kind !== 'searching' &&
    !(state.kind === 'found' && state.handle === target.handle);

  const search = useCallback(() => {
    const next = handleToResolve(text);
    if (next === null) return;
    if (!('handle' in next)) {
      setState({ kind: 'invalid', problem: next.problem });
      return;
    }
    const handle = next.handle;
    const id = ++request.current;
    setState({ kind: 'searching', handle });
    void resolveUsername(handle).then((result) => {
      if (id !== request.current) return;
      if (result.ok) {
        setState(recipientFromAnswer(handle, result.data));
        return;
      }
      setState({ kind: result.status === 0 ? 'offline' : 'failed', handle });
    });
  }, [text]);

  const reset = useCallback(() => {
    request.current += 1;
    setTextRaw('');
    setState(RECIPIENT_IDLE);
  }, []);

  /*
   * El contador sube también aquí: una búsqueda que siguiera en vuelo no
   * puede pisar a quien se acaba de elegir. Y el texto pasa a ser el handle
   * elegido, para que el estado interno no se contradiga consigo mismo — la
   * X sigue siendo `reset`, que lo limpia todo.
   */
  const choose = useCallback((handle: string, publicName: string) => {
    request.current += 1;
    setTextRaw(handle);
    setState(recipientFromChoice(handle, publicName));
  }, []);

  return { text, setText, state, canSearch, search, reset, choose };
}
