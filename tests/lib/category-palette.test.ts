import { describe, expect, it } from 'vitest';

import {
  CATEGORY_ICON_KEYS,
  CategoryPalette,
  categoryColour,
  categorySymbol,
  hasOfficialColour,
  OFFICIAL_CATEGORY_IDS,
} from '../../src/ui/theme/category-palette';
import { Colors } from '../../src/ui/theme/colors';

/**
 * La identidad visual de las categorías: color e icono.
 *
 * Los números no son decoración. Dos repartos de color se descartaron **porque
 * estas comprobaciones los tumbaron**: uno tenía un tono a cinco grados del
 * amarillo de Nomey, y otro amontonaba seis colores en cuarenta grados de azul
 * —`Transporte` y `Otros` quedaban a 6° de tono y 1 punto de luminancia—.
 */

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function hsl(hex: string): { hue: number; light: number } {
  const [red, green, blue] = channels(hex).map((value) => value / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let sector = 0;
  if (delta !== 0) {
    if (max === red) sector = ((green - blue) / delta) % 6;
    else if (max === green) sector = (blue - red) / delta + 2;
    else sector = (red - green) / delta + 4;
  }

  return { hue: (sector * 60 + 360) % 360, light: ((max + min) / 2) * 100 };
}

function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 360 - raw);
}

/**
 * Distancia perceptual entre dos colores, CIE76 sobre L*a*b*.
 *
 * **Sustituye al par de umbrales «15° de tono o 10 puntos de claridad».** Aquel
 * heurístico daba por separados colores que se parecen y por parecidos colores
 * que se distinguen: el tono y la claridad de HSL no son perceptuales, y un
 * salto de 15° pesa muy distinto en el azul que en el verde. `dE` responde a la
 * pregunta que de verdad importa —¿se ven distintos?— con una escala en la que
 * ~2.3 es el mínimo apreciable comparando de cerca.
 *
 * Es CIE76 y no CIEDE2000: bastante más simple, y para separar diez colores muy
 * distintos entre sí la diferencia entre las dos fórmulas no cambia ninguna
 * conclusión. No se usa para decidir colores, sólo para comprobarlos.
 */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });

  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

const dark = Colors.dark;

describe('los colores oficiales del catálogo', () => {
  const official = OFFICIAL_CATEGORY_IDS.map(categoryColour);

  it('son exactamente diez, uno por categoría activa', () => {
    expect(OFFICIAL_CATEGORY_IDS).toHaveLength(10);
    expect(new Set(official).size).toBe(10);
  });

  /**
   * **La paleta está cerrada por producto**, así que se fija entera y no por
   * propiedades. Las comprobaciones de debajo siguen midiéndola —son las que
   * dicen qué se está aceptando— pero ninguna la elige: cambiar un color es
   * una decisión, y tiene que verse como tal en el diff.
   */
  it('son exactamente los diez decididos, en su orden', () => {
    expect(official).toEqual([
      '#FF8A3D', // Supermercado
      '#FF6464', // Restaurantes
      '#38BDF8', // Transporte
      '#3867F4', // Hogar
      '#E84A6A', // Salud
      '#A855F7', // Ocio
      '#FF4FC3', // Compras
      '#35D07F', // Suscripciones
      '#00CDB4', // Viajes
      '#B8C0CC', // Otros
    ]);
  });

  /**
   * **3:1, que es lo que WCAG 1.4.11 exige a un objeto gráfico no textual.**
   * Antes se pedía 4.5 — el umbral de TEXTO— a un sector de color, que es más
   * estricto de lo que corresponde a lo que esto es. El nombre y el porcentaje
   * de cada categoría viven en la leyenda, con su propio contraste de texto.
   *
   * El mínimo de la paleta es `Hogar`, 4.11:1, todavía por encima del 3.
   */
  it.each(OFFICIAL_CATEGORY_IDS)('%s se lee sobre el fondo de la tarjeta', (id) => {
    expect(contrast(categoryColour(id), dark.surface)).toBeGreaterThanOrEqual(3);
  });

  /**
   * **El amarillo sigue siendo de la marca, sin excepción.** Es la única de las
   * tres reservas que se mantiene, y la que el producto reafirmó al cerrar la
   * paleta.
   */
  it('ninguno invade el amarillo de marca', () => {
    for (const colour of official) {
      expect(hueDistance(hsl(colour).hue, hsl(dark.accent).hue), colour).toBeGreaterThan(15);
    }
    expect(official).not.toContain(dark.accent);
  });

  /**
   * **DOS COLORES COINCIDEN CON LA SEMÁNTICA FINANCIERA, Y ESTÁ DECIDIDO.**
   *
   * `Restaurantes` es prácticamente el rojo `negative` y `Suscripciones`
   * prácticamente el verde `positive` — por debajo del umbral en que dos colores
   * se distinguen comparándolos de cerca. La regla que lo impedía se retiró al
   * cerrar la paleta.
   *
   * Esta guarda no lo prohíbe: lo **registra**, con su medida. Sirve para dos
   * cosas. Que nadie lo lea como un descuido y lo «arregle» en silencio. Y que
   * si alguna vez se mueve `positive` o `negative`, esto falle y obligue a mirar
   * si la coincidencia sigue siendo la que se aceptó.
   *
   * Lo que sostiene que no haya ambigüedad es que no comparten sitio: los
   * colores semánticos están en importes e indicadores de flujo, y éstos en el
   * anillo y su leyenda. Si eso deja de ser cierto, hay que revisarlo.
   */
  it('la coincidencia con el rojo y el verde financieros es la aceptada', () => {
    const RESTAURANTES = '92fcc25f-ad95-57a3-aba8-4756ce5b8cca';
    const SUSCRIPCIONES = 'aa08a0c3-0b75-5f6e-9eb6-5d2d78693a8a';

    expect(deltaE(categoryColour(RESTAURANTES), dark.negative)).toBeLessThan(5);
    expect(deltaE(categoryColour(SUSCRIPCIONES), dark.positive)).toBeLessThan(5);

    // Y son las dos únicas: ninguna otra categoría se acerca a la semántica.
    const otras = OFFICIAL_CATEGORY_IDS.filter(
      (id) => id !== RESTAURANTES && id !== SUSCRIPCIONES,
    ).map(categoryColour);
    for (const colour of otras) {
      expect(deltaE(colour, dark.negative), colour).toBeGreaterThan(15);
      expect(deltaE(colour, dark.positive), colour).toBeGreaterThan(15);
    }
  });

  /**
   * **Distinguibles entre sí, medido perceptualmente.** El par más cercano es
   * `Restaurantes` / `Salud`, a dE 16.5 — un rojo coral y una frambuesa, que se
   * distinguen sin esfuerzo. El suelo está en 12: bastante por debajo del par
   * más justo para no quedar clavado a la paleta de hoy, y bastante por encima
   * del umbral de lo apreciable para seguir mordiendo.
   */
  it('cada par se distingue perceptualmente', () => {
    for (let i = 0; i < official.length; i += 1) {
      for (let j = i + 1; j < official.length; j += 1) {
        const distancia = deltaE(official[i], official[j]);
        expect(
          distancia,
          `${official[i]} vs ${official[j]}: dE ${distancia.toFixed(1)}`,
        ).toBeGreaterThan(12);
      }
    }
  });
});

describe('categoryColour', () => {
  const GROCERIES = '80088454-77aa-51ae-864e-523ca74d66eb';
  const TRANSPORT = 'aeb60340-1e68-5e50-a653-905b9ebe287c';
  const CUSTOM = 'f0f0f0f0-1111-4111-8111-222222222222';

  /**
   * **Oficial primero, hash después.** Una categoría de sistema tiene el color
   * que el catálogo le da; el hash sólo alcanza a las personalizadas, cuyo
   * color nadie ha podido decidir de antemano.
   */
  it('una categoría oficial toma su color del catálogo, no del hash', () => {
    expect(hasOfficialColour(GROCERIES)).toBe(true);
    expect(categoryColour(GROCERIES)).toBe('#FF8A3D');
  });

  it('una personalizada cae en la paleta de reserva', () => {
    expect(hasOfficialColour(CUSTOM)).toBe(false);
    expect(CategoryPalette).toContain(categoryColour(CUSTOM));
  });

  it('la misma categoría da siempre el mismo color', () => {
    expect(categoryColour(GROCERIES)).toBe(categoryColour(GROCERIES));
    expect(categoryColour(CUSTOM)).toBe(categoryColour(CUSTOM));
  });

  /**
   * **Ciego al ranking**, que es la regla más fácil de incumplir sin darse
   * cuenta: indexar por posición haría que «Transporte» cambiara de color al
   * gastar más en otra cosa. El color sale del identificador y de nada más.
   */
  it('el color no depende de la posición en el reparto', () => {
    const ranked = [GROCERIES, TRANSPORT, CUSTOM];
    const before = ranked.map(categoryColour);
    const after = [...ranked].reverse().map(categoryColour).reverse();
    expect(after).toEqual(before);
  });

  it('el reparto de reserva es determinista y acotado', () => {
    const ids = Array.from({ length: 200 }, (_, index) => `custom-${index}`);
    expect(ids.map(categoryColour)).toEqual(ids.map(categoryColour));
    for (const colour of ids.map(categoryColour)) expect(CategoryPalette).toContain(colour);
  });
});

describe('los iconos semánticos', () => {
  /**
   * **La base guarda la identidad, no la representación.** Antes guardaba un
   * nombre de SF Symbol, y en Android eso hacía que TODAS las categorías
   * cayeran en el mismo recuadro genérico.
   */
  it('cada clave resuelve a un símbolo de iOS y a uno de Android', () => {
    for (const key of CATEGORY_ICON_KEYS) {
      const symbol = categorySymbol(key);
      expect(symbol.ios, key).toBeTruthy();
      expect(symbol.android, key).toBeTruthy();
    }
  });

  /**
   * **Android no cae en el mismo icono para todas**, que era exactamente el
   * defecto. Las diez del catálogo activo tienen diez símbolos distintos.
   */
  it('las diez activas tienen símbolos distintos en las dos plataformas', () => {
    const active = [
      'groceries',
      'dining',
      'transport',
      'home',
      'health',
      'leisure',
      'shopping',
      'subscriptions',
      'travel',
      'other',
    ];

    expect(new Set(active.map((key) => categorySymbol(key).ios)).size).toBe(10);
    expect(new Set(active.map((key) => categorySymbol(key).android)).size).toBe(10);
  });

  /** Las retiradas conservan el suyo: su histórico tiene que seguir resolviendo. */
  it('las retiradas conservan su icono para el histórico', () => {
    for (const key of ['utilities', 'education', 'salary', 'extra']) {
      expect(CATEGORY_ICON_KEYS).toContain(key);
      expect(categorySymbol(key).ios).toBeTruthy();
    }
  });

  /**
   * Una clave que esta versión no conozca cae en el genérico, no en un hueco:
   * la base puede sembrar una nueva antes de que la app se actualice.
   */
  it('una clave desconocida cae en el genérico', () => {
    expect(categorySymbol('inventada')).toEqual(categorySymbol('tag'));
  });

  /** Y ningún nombre de plataforma se ha colado como clave semántica. */
  it('el vocabulario no contiene nombres de plataforma', () => {
    for (const key of CATEGORY_ICON_KEYS) {
      expect(key, key).not.toContain('.');
      expect(key, key).not.toContain('_');
    }
  });
});
