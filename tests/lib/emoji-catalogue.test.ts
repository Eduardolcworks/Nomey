import { describe, expect, it } from 'vitest';

import {
  EMOJI_GROUPS,
  emojisOfGroup,
  hasTones,
  isSingleEmoji,
  searchEmojis,
  searchKey,
  SKIN_TONES,
  withTone,
} from '../../src/features/groups/emoji-catalogue';
import {
  parseRecents,
  pushRecent,
  RECENTS_LIMIT,
  serialiseRecents,
} from '../../src/features/groups/emoji-recents';

/**
 * El catálogo de emojis, interrogado por comportamiento.
 *
 * Es dato puro —`emojibase-data`, JSON sin código— así que se puede montar aquí
 * entero, sin React Native y sin renderer.
 */

describe('las categorías', () => {
  it('son las nueve de Unicode y NINGUNA es la de componentes', () => {
    /*
     * El grupo 2 son los modificadores de tono y los selectores de pelo: piezas
     * para componer otros emojis, no emojis elegibles. Enseñarlo daría una
     * cuadrícula de cuadrados vacíos.
     */
    expect(EMOJI_GROUPS).toHaveLength(9);
    expect(EMOJI_GROUPS.map((entry) => entry.group)).not.toContain(2);
  });

  it('cada una tiene emojis en los dos idiomas', () => {
    for (const entry of EMOJI_GROUPS) {
      expect(emojisOfGroup('es-ES', entry.group).length).toBeGreaterThan(0);
      expect(emojisOfGroup('en', entry.group).length).toBeGreaterThan(0);
    }
  });

  it('y las dos traen los mismos emojis: sólo cambian las etiquetas', () => {
    // Si un idioma trajera menos, la cuadrícula cambiaría al cambiar de idioma.
    for (const entry of EMOJI_GROUPS) {
      expect(emojisOfGroup('en', entry.group).map((e) => e.unicode)).toEqual(
        emojisOfGroup('es-ES', entry.group).map((e) => e.unicode),
      );
    }
  });

  it('salen en el orden que Unicode fija para los teclados', () => {
    const orden = emojisOfGroup('es-ES', 0).map((emoji) => emoji.order ?? 0);
    expect(orden).toEqual([...orden].sort((a, b) => a - b));
  });

  it('las banderas están, y son secuencias de dos indicadores', () => {
    const banderas = emojisOfGroup('es-ES', 9);
    expect(banderas.some((emoji) => emoji.unicode === '🇪🇸')).toBe(true);
  });
});

describe('la búsqueda', () => {
  it('encuentra en español SIN escribir el acento', () => {
    // La razón de traer el catálogo traducido: en una interfaz en español, un
    // buscador que sólo entendiera inglés es la fuga que la norma i18n impide.
    const resultado = searchEmojis('es-ES', 'corazon');
    expect(resultado.length).toBeGreaterThan(0);
  });

  it('y en inglés con su propia palabra', () => {
    expect(searchEmojis('en', 'heart').length).toBeGreaterThan(0);
    // La misma palabra inglesa NO tiene por qué encontrar nada en el catálogo
    // español: son dos índices distintos, que es justo lo que se quiere.
    expect(searchEmojis('es-ES', 'corazón').length).toBeGreaterThan(0);
  });

  it('busca también en las palabras clave, no sólo en la etiqueta', () => {
    const perro = searchEmojis('es-ES', 'perro');
    expect(perro.some((emoji) => emoji.unicode === '🐕' || emoji.unicode === '🐶')).toBe(true);
  });

  it('con la caja escrita como sea', () => {
    expect(searchEmojis('es-ES', 'GATO').length).toBe(searchEmojis('es-ES', 'gato').length);
  });

  it('un texto en blanco no devuelve nada, en vez de devolverlo todo', () => {
    expect(searchEmojis('es-ES', '')).toEqual([]);
    expect(searchEmojis('es-ES', '   ')).toEqual([]);
  });

  it('y nunca devuelve componentes', () => {
    for (const emoji of searchEmojis('es-ES', 'a')) {
      expect(emoji.group).not.toBe(2);
    }
  });

  it('la clave de búsqueda quita acentos, y la de nombres no', () => {
    expect(searchKey('Corazón')).toBe('corazon');
    expect(searchKey('  ÁRBOL ')).toBe('arbol');
  });
});

describe('los tonos de piel', () => {
  it('son los cinco modificadores de Unicode', () => {
    expect(SKIN_TONES).toEqual(['1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF']);
  });

  it('la variante sale del dato, nunca de componer la cadena a mano', () => {
    const mano = emojisOfGroup('es-ES', 1).find((emoji) => emoji.unicode === '👋');
    expect(mano).toBeDefined();
    if (mano === undefined) return;

    const claro = withTone(mano, '1F3FB');
    expect(claro).not.toBe(mano.unicode);
    // Y es un emoji COMPLETO del catálogo, no una cadena inventada.
    expect(isSingleEmoji(claro, 'es-ES')).toBe(true);
  });

  it('sin tono, o sin variante para ese tono, se devuelve la base', () => {
    const mano = emojisOfGroup('es-ES', 1).find((emoji) => emoji.unicode === '👋');
    if (mano === undefined) return;
    expect(withTone(mano, null)).toBe(mano.unicode);

    const bandera = emojisOfGroup('es-ES', 9)[0];
    expect(hasTones(bandera)).toBe(false);
    expect(withTone(bandera, '1F3FF')).toBe(bandera.unicode);
  });
});

describe('qué es un único emoji completo', () => {
  it('acepta un emoji simple', () => {
    expect(isSingleEmoji('👥', 'es-ES')).toBe(true);
  });

  it('acepta una bandera, que son DOS puntos de código', () => {
    expect(isSingleEmoji('🇪🇸', 'es-ES')).toBe(true);
  });

  it('acepta una secuencia unida por juntadores de anchura cero', () => {
    // Una familia es varias personas más juntadores: cortarla por la mitad da
    // dos emojis sueltos, que es exactamente lo que no puede pasar.
    expect(isSingleEmoji('👨‍👩‍👧', 'es-ES')).toBe(true);
  });

  it('acepta una variante con tono de piel', () => {
    expect(isSingleEmoji('👋🏽', 'es-ES')).toBe(true);
  });

  it('RECHAZA la cadena vacía', () => {
    expect(isSingleEmoji('', 'es-ES')).toBe(false);
  });

  it('RECHAZA texto ordinario', () => {
    expect(isSingleEmoji('a', 'es-ES')).toBe(false);
    expect(isSingleEmoji('grupo', 'es-ES')).toBe(false);
    expect(isSingleEmoji(' ', 'es-ES')).toBe(false);
  });

  it('RECHAZA dos emojis pegados', () => {
    expect(isSingleEmoji('👥👥', 'es-ES')).toBe(false);
    expect(isSingleEmoji('🇪🇸🇫🇷', 'es-ES')).toBe(false);
  });

  it('y RECHAZA un emoji con texto detrás', () => {
    expect(isSingleEmoji('👥 casa', 'es-ES')).toBe(false);
  });

  it('todo lo que la cuadrícula ofrece pasa la validación', () => {
    // La garantía que importa: no hay ninguna celda que, al pulsarla, produzca
    // un valor que el propio formulario rechazaría.
    for (const entry of EMOJI_GROUPS) {
      for (const emoji of emojisOfGroup('es-ES', entry.group)) {
        expect(isSingleEmoji(withTone(emoji, null), 'es-ES')).toBe(true);
      }
    }
  });
});

describe('los emojis recientes', () => {
  it('el último elegido va delante', () => {
    expect(pushRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('repetir uno lo SUBE, no lo duplica', () => {
    expect(pushRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('y la lista no crece sin fin', () => {
    let lista: readonly string[] = [];
    for (let i = 0; i < RECENTS_LIMIT + 10; i += 1) lista = pushRecent(lista, `e${String(i)}`);
    expect(lista).toHaveLength(RECENTS_LIMIT);
  });

  it('lo guardado se vuelve a leer igual', () => {
    const lista = ['👥', '🇪🇸', '👋🏽'];
    expect(parseRecents(serialiseRecents(lista))).toEqual(lista);
  });

  it('y un documento que no sea una lista de cadenas se descarta ENTERO', () => {
    // Una lista medio válida metería `undefined` en la cuadrícula.
    expect(parseRecents(null)).toEqual([]);
    expect(parseRecents('no es json')).toEqual([]);
    expect(parseRecents('{"a":1}')).toEqual([]);
    expect(parseRecents('["👥", 7]')).toEqual([]);
    expect(parseRecents('["👥", ""]')).toEqual([]);
  });
});
