import { supabase } from '@/lib/supabase';

import { compareCurrencies } from './order';

/** Una definición monetaria del catálogo, tal y como la publica `api`. */
export type CurrencyOption = {
  readonly id: string;
  readonly code: string;
  /** Los decimales de ESTA definición. Nunca se presupone 2 (F02/ADR-001). */
  readonly scale: number;
};

/**
 * El catálogo de divisas soportadas.
 *
 * **Es `api.currency_definition`**, la vista `security_invoker` que publicó el
 * provisioning del Modo Personal y que `authenticated` puede leer. Son las que
 * la migración siembra, así que se traen enteras: paginarlas costaría más de lo
 * que ahorra.
 *
 * **Publica el catálogo entero, tenga o no cobertura de cambio.** Una divisa sin
 * tipo publicado sigue siendo una definición monetaria válida —se puede elegir,
 * y lo que decide es la frontera, con `FX_CURRENCY_NOT_COVERED` si no hay
 * cobertura para esa fecha—. Filtrarlas aquí sería fabricar en el cliente una
 * regla que pertenece al servidor y que además cambia cada día hábil.
 *
 * Las tres columnas salen anulables del generador de tipos porque una vista no
 * declara `not null`; las filas incompletas se descartan aquí, que es donde se
 * sabe que una divisa sin código no es elegible.
 */
export async function fetchCurrencies(): Promise<readonly CurrencyOption[]> {
  const { data, error } = await supabase.from('currency_definition').select('id,code,scale');
  if (error !== null) throw error;

  const rows = (data ?? []).flatMap((row) =>
    row.id === null || row.code === null || row.scale === null
      ? []
      : [{ id: row.id, code: row.code, scale: row.scale }],
  );

  return rows.slice().sort(compareCurrencies);
}

/** El catálogo indexado por identidad, para resolver una moneda declarada. */
export function indexCurrencies(
  options: readonly CurrencyOption[],
): ReadonlyMap<string, CurrencyOption> {
  return new Map(options.map((option) => [option.id, option]));
}
