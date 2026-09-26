/**
 * EL CATÁLOGO DE DIVISAS, y por qué vive en `lib/`.
 *
 * `api.currency_definition` es un catálogo **global**: no pertenece a los
 * Grupos, sólo lo estrenó allí el selector de la divisa base. Desde F11 lo
 * necesitan también el alta de un movimiento personal y el alta de un gasto
 * compartido —la moneda de la OPERACIÓN, que puede no ser la base del ámbito—
 * y una feature no puede leer de otra, así que el catálogo baja aquí.
 *
 * Es la misma mudanza que hizo `lib/categories` y por el mismo motivo. Lo que
 * NO baja es la presentación: el desplegable vive en `ui/`.
 */
export { type CurrencyOption, fetchCurrencies, indexCurrencies } from './catalogue';
export { compareCurrencies, CURRENCY_ORDER } from './order';
export { currencyLabel, type LabelledCurrency, labelCurrencies } from './label';
export { type CurrenciesState, useCurrencies } from './use-currencies';
