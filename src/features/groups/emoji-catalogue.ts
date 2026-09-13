import es from 'emojibase-data/es/compact.json';
import en from 'emojibase-data/en/compact.json';
import type { CompactEmoji } from 'emojibase';

import type { MessageKey, MessageLocale } from '@/lib/i18n';

/**
 * EL CATÁLOGO DE EMOJIS, Y POR QUÉ ES UN DATO Y NO UNA LISTA ESCRITA A MANO.
 *
 * **El repositorio no tenía ninguno.** Lo único que había era `emoji-regex@8`,
 * transitivo de `yargs` dentro de React Native — un validador de la era Unicode
 * 11, ni catálogo ni dependencia nuestra.
 *
 * **`emojibase-data@17.0.0`, MIT, cero dependencias propias.** Es JSON: no
 * ejecuta nada, no toca la huella nativa, no abre red ni WebView, no pide
 * permisos y no tiene superficie de compatibilidad con React 19 ni con RN 0.86,
 * porque no hay código que compatibilizar. Se genera de CLDR y del propio
 * Unicode, se publica por versión de Unicode (17.0.0 el 2025-11-17) y trae las
 * etiquetas y las palabras clave YA TRADUCIDAS, que es la razón de elegirlo:
 * Nomey es bilingüe por norma, y un buscador que sólo entendiera inglés dentro
 * de una interfaz en español es exactamente la fuga que esa norma existe para
 * impedir.
 *
 * **La apariencia es entera nuestra**, porque esto no trae ninguna: la
 * cuadrícula, las categorías y el buscador se montan con los componentes de
 * Nomey. Se descartó `rn-emoji-keyboard@1.7.0` —MIT y también sin dependencias—
 * justamente por lo contrario: trae SU teclado, y además lleva sin publicar
 * desde mayo de 2024, sin ninguna versión posterior a React 19.
 *
 * **Los glifos son los del sistema.** Aquí sólo viajan los puntos de código; el
 * dibujo lo pone la fuente del aparato, así que un Android y un iPhone enseñan
 * cada uno los suyos sin que nada se descargue.
 */
type Emoji = CompactEmoji;

const CATALOGUE: Readonly<Record<MessageLocale, readonly Emoji[]>> = {
  'es-ES': es,
  en,
};

/**
 * LAS CATEGORÍAS QUE SE ENSEÑAN, en el orden de Unicode.
 *
 * Los índices son los grupos de `emoji-test.txt`, y el 2 —«Component»— se queda
 * fuera a propósito: son los modificadores de tono de piel y los selectores de
 * pelo, que no son emojis que nadie quiera elegir sino piezas para componer
 * otros. Elegir uno suelto daría un cuadrado vacío.
 *
 * **Los nombres los pone nuestro catálogo de mensajes**, no el del paquete.
 * `emojibase` los trae, pero en su propia voz y en minúscula —«emoticonos y
 * emoción»—, y son nueve cadenas: entran donde entran todas las demás.
 */
export const EMOJI_GROUPS: readonly { readonly group: number; readonly labelKey: MessageKey }[] = [
  { group: 0, labelKey: 'emoji.group.smileys' },
  { group: 1, labelKey: 'emoji.group.people' },
  { group: 3, labelKey: 'emoji.group.nature' },
  { group: 4, labelKey: 'emoji.group.food' },
  { group: 5, labelKey: 'emoji.group.places' },
  { group: 6, labelKey: 'emoji.group.activities' },
  { group: 7, labelKey: 'emoji.group.objects' },
  { group: 8, labelKey: 'emoji.group.symbols' },
  { group: 9, labelKey: 'emoji.group.flags' },
];

/**
 * LOS CINCO TONOS DE PIEL, por su modificador.
 *
 * Se guardan como sufijo hexadecimal porque así es como `emojibase` encadena la
 * variante: el `hexcode` de la piel es el de la base más `-1F3FB`. Buscar por
 * ese sufijo es exacto y no manipula cadenas Unicode a mano, que es donde se
 * parten los grafemas.
 */
export const SKIN_TONES = ['1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF'] as const;

export type SkinTone = (typeof SKIN_TONES)[number];

/** El tono elegido, o ninguno: `null` es el emoji tal y como lo define Unicode. */
export type SkinChoice = SkinTone | null;

/**
 * El emoji de una entrada con el tono pedido, o el de base.
 *
 * **Nunca construye la cadena.** Busca entre las variantes que el propio dato
 * declara y, si no está —un emoji de dos personas tiene combinaciones que no
 * son «la base más un modificador»—, devuelve la base sin tono. Componer el
 * grafema a mano es lo que produce los cuadrados vacíos.
 */
export function withTone(emoji: Emoji, tone: SkinChoice): string {
  if (tone === null) return emoji.unicode;
  const variant = emoji.skins?.find((skin) => skin.hexcode === `${emoji.hexcode}-${tone}`);
  return variant?.unicode ?? emoji.unicode;
}

/** Si esta entrada tiene alguna variante de tono que ofrecer. */
export function hasTones(emoji: Emoji): boolean {
  return (emoji.skins?.length ?? 0) > 0;
}

/** Los emojis de una categoría, en el orden que Unicode fija para los teclados. */
export function emojisOfGroup(locale: MessageLocale, group: number): readonly Emoji[] {
  return CATALOGUE[locale]
    .filter((emoji) => emoji.group === group)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * LA FORMA EN QUE SE COMPARA UN TEXTO DE BÚSQUEDA.
 *
 * Minúsculas y sin diacríticos, en las dos puntas —lo escrito y lo indexado—,
 * para que «corazon» encuentre «corazón» y «espana» encuentre «España».
 *
 * **Se recorre por punto de código, sin expresión regular.** El bloque
 * U+0300–U+036F es el de los signos combinantes que `NFD` separa de su letra;
 * filtrarlo a mano evita una regex con un rango de marcas combinantes escrito
 * en el propio fichero, que es frágil de leer y de mantener, y no cuesta nada:
 * el índice se construye una sola vez por idioma.
 *
 * Esto es distinto de `nameKey` de `group-draft.ts`, que sí conserva los
 * acentos: allí se decide si dos nombres son la misma persona, y «María» y
 * «Maria» no lo son. Aquí se decide qué enseñar mientras alguien teclea.
 */
export function searchKey(text: string): string {
  const descompuesto = text.normalize('NFD');
  let plano = '';
  for (const caracter of descompuesto) {
    const punto = caracter.codePointAt(0) ?? 0;
    if (punto >= 0x0300 && punto <= 0x036f) continue;
    plano += caracter;
  }
  return plano.toLowerCase().trim();
}
/**
 * Los emojis que casan con lo escrito.
 *
 * Busca en la etiqueta y en las palabras clave, las dos ya traducidas por
 * `emojibase`. Se conserva el orden de Unicode en vez de puntuar la relevancia:
 * una cuadrícula reordenada en cada pulsación baila debajo del dedo.
 */
/**
 * EL ÍNDICE DE BÚSQUEDA, construido UNA vez por idioma.
 *
 * **No es una optimización de estilo: sin él la búsqueda bloquea el hilo.**
 * Normalizar la etiqueta y las palabras clave de mil novecientos emojis son más
 * de diez mil `normalize()` por pulsación, y medido en el emulador eso deja la
 * interfaz sin responder mientras se escribe. Precalculado, cada pulsación es
 * un `includes` sobre cadenas ya preparadas.
 *
 * Perezoso y por idioma: quien nunca abre el selector no paga nada, y cambiar
 * de idioma no invalida el índice del otro.
 */
type Entrada = { readonly emoji: Emoji; readonly haystack: string };

const INDEX = new Map<MessageLocale, readonly Entrada[]>();

function index(locale: MessageLocale): readonly Entrada[] {
  const cached = INDEX.get(locale);
  if (cached !== undefined) return cached;

  const built = CATALOGUE[locale]
    .filter((emoji) => emoji.group !== undefined && emoji.group !== 2)
    .map((emoji) => ({
      emoji,
      haystack: searchKey([emoji.label, ...(emoji.tags ?? [])].join(' ')),
    }))
    .sort((a, b) => (a.emoji.order ?? 0) - (b.emoji.order ?? 0));

  INDEX.set(locale, built);
  return built;
}

export function searchEmojis(locale: MessageLocale, query: string): readonly Emoji[] {
  const needle = searchKey(query);
  if (needle === '') return [];

  return index(locale)
    .filter((entry) => entry.haystack.includes(needle))
    .map((entry) => entry.emoji);
}

/**
 * SI ESTO ES UN ÚNICO GRAFEMA EMOJI COMPLETO.
 *
 * **Se pregunta al catálogo, no a una expresión regular.** Un emoji moderno es
 * una secuencia —bandera, familia unida por juntadores de anchura cero, piel,
 * género— y cualquier regex escrita a mano acaba partiéndola o dejando pasar
 * dos emojis pegados. Comparar contra el conjunto de cadenas que el dato
 * declara acierta por construcción: rechaza el texto normal, la cadena vacía y
 * dos emojis seguidos, y acepta cualquier secuencia que Unicode reconozca.
 *
 * El conjunto se construye una vez, perezosamente, y cubre las bases y todas
 * sus variantes de tono.
 */
const KNOWN = new Map<MessageLocale, Set<string>>();

function known(locale: MessageLocale): Set<string> {
  const cached = KNOWN.get(locale);
  if (cached !== undefined) return cached;

  const set = new Set<string>();
  for (const emoji of CATALOGUE[locale]) {
    set.add(emoji.unicode);
    for (const skin of emoji.skins ?? []) set.add(skin.unicode);
  }
  KNOWN.set(locale, set);
  return set;
}

export function isSingleEmoji(value: string, locale: MessageLocale): boolean {
  return known(locale).has(value);
}

export type { Emoji };
