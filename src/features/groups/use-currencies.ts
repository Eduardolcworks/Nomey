import { useEffect, useState } from 'react';

import { type CurrencyOption, fetchCurrencies } from './group-service';

/**
 * El catálogo de divisas, con sus tres estados.
 *
 * **Tres y no un array vacío.** Una lista vacía no distingue «todavía no ha
 * llegado» de «ha llegado y no hay ninguna», y esas dos pintan cosas distintas:
 * la primera espera, la segunda es un fallo. Es la misma forma que
 * `PersonalScopeState` eligió, por el mismo motivo.
 */
export type CurrenciesState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly options: readonly CurrencyOption[] }
  | { readonly status: 'unavailable' };

export function useCurrencies(enabled: boolean): CurrenciesState {
  const [state, setState] = useState<CurrenciesState>({ status: 'loading' });

  useEffect(() => {
    if (!enabled) return;

    let alive = true;
    void fetchCurrencies()
      .then((options) => {
        if (alive) setState({ status: 'ready', options });
      })
      .catch(() => {
        if (alive) setState({ status: 'unavailable' });
      });

    return () => {
      alive = false;
    };
  }, [enabled]);

  return state;
}
