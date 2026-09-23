/**
 * EL CATÁLOGO DE DIVISAS, ahora en `lib/currency`.
 *
 * Bajó cuando F11 lo necesitó también para elegir la moneda de un movimiento
 * personal, y una feature no puede leer de otra. Aquí sólo queda el nombre por
 * el que esta feature lo conocía: ni el estado ni el comportamiento cambian.
 */
export { type CurrenciesState, useCurrencies } from '@/lib/currency';
