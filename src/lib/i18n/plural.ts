import type { MessageLocale } from './locales';

/**
 * QUÉ FORMA PLURAL TOCA, para elegir entre dos entradas del catálogo.
 *
 * **Sólo dos categorías, y es una decisión sobre el catálogo, no sobre los
 * idiomas del mundo.** Nomey tiene hoy `es-ES` e `en`, y las dos entradas que
 * existen son «uno» y «lo demás». Un idioma con `few`, `many` o `zero` —el
 * polaco, el árabe— necesitaría entradas nuevas en el catálogo, no una
 * categoría más aquí: devolver `few` sin que exista el mensaje no arreglaría
 * nada, y el tipo lo dice.
 *
 * **`Intl.PluralRules` primero, y una comprobación de existencia de verdad.**
 * El Intl de Hermes en Android no implementa toda la familia, así que se
 * comprueba que la API esté antes de usarla en vez de suponerlo. El respaldo no
 * es una aproximación: `n === 1` **es** la regla de las dos locales que hay, así
 * que en este catálogo los dos caminos dan lo mismo. Cuando entre una locale con
 * otra regla, `Intl` la resolverá donde exista y el respaldo dejará de ser
 * exacto — momento en el que el catálogo necesitará sus entradas, que es la
 * misma conversación.
 *
 * Se le pasa la locale de MENSAJES y no la de formato: elige entrada de
 * catálogo, no separadores.
 */
export type PluralCategory = 'one' | 'other';

type MaybePluralRules = {
  PluralRules?: new (locale: string) => { select: (n: number) => string };
};

export function pluralCategory(locale: MessageLocale, count: number): PluralCategory {
  const intl = Intl as unknown as MaybePluralRules;

  if (typeof intl.PluralRules === 'function') {
    try {
      return new intl.PluralRules(locale).select(count) === 'one' ? 'one' : 'other';
    } catch {
      // Una locale que el motor no conoce no debe dejar la interfaz sin texto.
    }
  }

  return count === 1 ? 'one' : 'other';
}
