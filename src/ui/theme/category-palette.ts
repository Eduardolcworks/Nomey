import type { SymbolViewProps } from 'expo-symbols';

/**
 * La identidad visual de una categoría: su color y su icono.
 *
 * **Dos regímenes, y la diferencia es de producto, no técnica:**
 *
 * - una categoría **de sistema** es parte del catálogo oficial de Nomey y tiene
 *   identidad propia — nombre, icono y color decididos, estables y iguales en
 *   todas partes;
 * - una categoría **personalizada** la crea alguien y nadie puede haber
 *   decidido su color de antemano, así que recibe uno determinista de una
 *   paleta de reserva.
 *
 * Un hash le da a «Supermercado» el color que su UUID dicte, no el que alguien
 * eligió. Para el catálogo oficial eso es lo contrario de tener identidad, y por
 * eso el mapa explícito manda y el hash queda debajo.
 *
 * **Nada de esto se persiste.** El color no es un atributo de la categoría en el
 * modelo: es presentación, y `core.category` no tiene columna de color. Meterlo
 * en el esquema convertiría cada retoque de un tono en una migración de datos.
 */

// ============================== ICONOS =====================================

/**
 * El vocabulario semántico de iconos, que es lo que guarda `core.category.icon`
 * desde ADR-027 — con un `CHECK` que lo hace cumplir.
 *
 * **La base guarda la IDENTIDAD, no la representación.** Antes guardaba el
 * nombre de un SF Symbol, y eso convertía una decisión de iOS en el contrato
 * universal: en Android `expo-symbols` no encontraba el nombre y **todas** las
 * categorías caían en el mismo recuadro genérico. Medido — el catálogo de
 * Material tiene 4055 símbolos y `SymbolView` los pinta, pero sólo si el nombre
 * llega como objeto `{ ios, android }`.
 *
 * Una identidad, dos representaciones. Las cuatro claves de las categorías
 * retiradas se conservan: su histórico tiene que seguir resolviendo su icono.
 */
export type CategoryIconKey =
  | 'groceries'
  | 'dining'
  | 'transport'
  | 'home'
  | 'health'
  | 'leisure'
  | 'shopping'
  | 'subscriptions'
  | 'travel'
  | 'other'
  | 'utilities'
  | 'education'
  | 'salary'
  | 'extra'
  | 'tag';

type PlatformSymbol = Extract<SymbolViewProps['name'], { ios?: unknown }>;

const CATEGORY_SYMBOLS: Readonly<Record<CategoryIconKey, PlatformSymbol>> = {
  groceries: { ios: 'cart', android: 'shopping_cart' },
  dining: { ios: 'fork.knife', android: 'restaurant' },
  transport: { ios: 'car', android: 'directions_car' },
  home: { ios: 'house', android: 'home' },
  health: { ios: 'cross.case', android: 'medical_services' },
  leisure: { ios: 'gamecontroller', android: 'sports_esports' },
  shopping: { ios: 'bag', android: 'shopping_bag' },
  subscriptions: { ios: 'arrow.triangle.2.circlepath', android: 'autorenew' },
  travel: { ios: 'airplane', android: 'flight' },
  other: { ios: 'ellipsis.circle', android: 'more_horiz' },
  // Retiradas del catálogo activo, conservadas para el histórico.
  utilities: { ios: 'bolt', android: 'bolt' },
  education: { ios: 'book', android: 'school' },
  salary: { ios: 'banknote', android: 'payments' },
  extra: { ios: 'plus.circle', android: 'add_circle' },
  // El genérico, y el defecto de una personalizada sin icono.
  tag: { ios: 'tag', android: 'label' },
};

export const CATEGORY_ICON_KEYS = Object.keys(CATEGORY_SYMBOLS) as CategoryIconKey[];

/**
 * Resuelve una clave semántica al símbolo de cada plataforma.
 *
 * Una clave que esta versión del cliente no conozca cae en el genérico, no en
 * un recuadro vacío: la base puede sembrar una clave nueva antes de que la app
 * se actualice, y una categoría sin icono se ve peor que una con el icono
 * neutro.
 */
export function categorySymbol(iconKey: string): PlatformSymbol {
  return CATEGORY_SYMBOLS[iconKey as CategoryIconKey] ?? CATEGORY_SYMBOLS.tag;
}

// ============================== COLORES ====================================

/**
 * El color oficial de cada categoría de sistema, por su UUID.
 *
 * **Paleta cerrada por producto.** Los diez valores están decididos; lo que
 * queda aquí escrito es lo que se midió sobre `surface` (#0C0C0C) después de
 * fijarlos, no una justificación de por qué son éstos.
 *
 * ```
 * categoria       hex       contraste  tono  sat  lum
 * Supermercado    #FF8A3D      8.34     24°  100%  62%
 * Restaurantes    #FF6464      6.76      0°  100%  70%
 * Transporte      #38BDF8      9.13    198°   93%  60%
 * Hogar           #3867F4      4.11    225°   90%  59%
 * Salud           #E84A6A      5.23    348°   77%  60%
 * Ocio            #A855F7      4.94    271°   91%  65%
 * Compras         #FF4FC3      6.67    320°  100%  65%
 * Suscripciones   #35D07F      9.76    149°   62%  51%
 * Viajes          #00CDB4      9.68    173°  100%  40%
 * Otros           #B8C0CC     10.67    216°   16%  76%
 *
 * contraste minimo ................. 4.11  (Hogar)
 * distancia al amarillo de marca ... 23°   (Supermercado)
 * par mas cercano .................. dE 16.5  (Restaurantes / Salud)
 * ```
 *
 * **Dos colores coinciden con la semántica financiera, y es deliberado.**
 * Medido en CIE76: `Restaurantes` está a **dE 3.7** del rojo `negative` y
 * `Suscripciones` a **dE 1.1** del verde `positive` — por debajo del umbral en
 * que dos colores se distinguen comparándolos de cerca. Un sector de gastos en
 * restaurantes y el rojo que significa «gasto» son, en la práctica, el mismo
 * color; lo mismo entre suscripciones y el verde de «ingreso».
 *
 * La regla anterior los mantenía a más de 15° y 20° de tono, y se retira aquí
 * a propósito. **Lo que sostiene que no haya ambigüedad es que las dos cosas
 * nunca comparten sitio**: el rojo y el verde semánticos aparecen en importes y
 * en indicadores de flujo, y estos diez sólo en el anillo y en su leyenda, que
 * lleva nombre y porcentaje por fila. Si alguna vez una cifra con signo
 * conviviera con un sector de categoría, esto habría que revisarlo.
 *
 * **El amarillo de marca sigue fuera**, sin excepción: el más cercano es
 * `Supermercado` a 23°.
 *
 * **`Hogar` es el mínimo de contraste, 4.11:1.** Está por encima del 3:1 que
 * WCAG 1.4.11 exige a un objeto gráfico no textual, y por debajo del 4.5 que
 * este archivo se imponía antes — un umbral de texto aplicado a un sector de
 * color. La guarda pasó a medir contra el umbral del estándar, que es el que
 * corresponde a lo que esto es.
 *
 * La leyenda, obligatoria, sigue siendo la representación autoritativa: el
 * color acompaña y nunca identifica por sí solo.
 */
const OFFICIAL_COLOURS: Readonly<Record<string, string>> = {
  '80088454-77aa-51ae-864e-523ca74d66eb': '#FF8A3D', // Supermercado
  '92fcc25f-ad95-57a3-aba8-4756ce5b8cca': '#FF6464', // Restaurantes
  'aeb60340-1e68-5e50-a653-905b9ebe287c': '#38BDF8', // Transporte
  '0bcc36c9-4307-5ad1-9e55-e71f8b6d0d31': '#3867F4', // Hogar
  'aa873ad8-607d-5499-845b-b04f0d2882d4': '#E84A6A', // Salud
  '21c05d21-bbd2-5aa3-bd9c-17422a5eccf8': '#A855F7', // Ocio
  '0335241b-872a-54b7-af83-028b116bdee7': '#FF4FC3', // Compras
  'aa08a0c3-0b75-5f6e-9eb6-5d2d78693a8a': '#35D07F', // Suscripciones
  '2dc197f7-d2bb-5a12-a218-dc8563575426': '#00CDB4', // Viajes
  '4ed30a44-9f82-578f-828c-b491a25ebdd9': '#B8C0CC', // Otros
};

export const OFFICIAL_CATEGORY_IDS = Object.keys(OFFICIAL_COLOURS);

/**
 * La paleta de reserva de las **personalizadas**.
 *
 * Ya no es contrato de las oficiales: aquellas tienen su color decidido arriba.
 * Aquí sólo hace falta que dos categorías que nadie ha diseñado no salgan
 * siempre del mismo tono.
 */
export const CategoryPalette: readonly string[] = [
  '#FF8A3D',
  '#38BDF8',
  '#3867F4',
  '#A855F7',
  '#FF4FC3',
  '#00CDB4',
  '#E84A6A',
] as const;

/**
 * Hash determinista de una cadena. FNV-1a de 32 bits, con semilla propia.
 *
 * `Math.imul` y no `*`: la multiplicación normal desborda el rango exacto de un
 * `double` y el resultado dejaría de ser reproducible.
 */
function hash(value: string): number {
  let result = 1448085085;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/**
 * El color de una categoría.
 *
 * **Oficial primero, hash después.** Una categoría de sistema tiene el color que
 * el catálogo le da; una personalizada, uno derivado de su identificador.
 *
 * En los dos casos es **estable por categoría y ciego al ranking**: depende del
 * identificador y de nada más, así que «Transporte» no cambia de color al
 * gastar más en otra cosa. Y es estable entre entornos, porque los UUID de
 * sistema son v5 reproducibles y ADR-019 prohíbe regenerarlos.
 */
export function categoryColour(categoryId: string): string {
  return OFFICIAL_COLOURS[categoryId] ?? CategoryPalette[hash(categoryId) % CategoryPalette.length];
}

/** `true` si el color viene del catálogo oficial y no del hash de reserva. */
export function hasOfficialColour(categoryId: string): boolean {
  return categoryId in OFFICIAL_COLOURS;
}
