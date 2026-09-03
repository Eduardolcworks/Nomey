import type { BoxShadowValue } from 'react-native';

/**
 * Depth tokens: glass surfaces and tactile interaction.
 *
 * These are the two depth devices of design-direction.md, and they are NOT
 * interchangeable:
 *
 *   glass    -> surfaces that contain things: cards, panels, sheets, controls
 *   tactile  -> how those surfaces respond: raised, selected, pressed, sunken
 *
 * Applying either mechanically to everything is the failure mode the direction
 * warns about. A surface that does not contain, and a control that does not
 * respond, get neither.
 *
 * **Everything here is designed for a pure black ground, and that changes the
 * physics.** A drop shadow is black on black - it renders nothing. Depth on
 * this ground can only come from the surface being *lighter* than what is
 * behind it, from a highlight along the top edge where the light lands, and
 * from an inner shade along the bottom where it does not. The outer shadows
 * below are kept for surfaces that float over content rather than over the
 * ground, where they do show.
 */

/**
 * The measured floor for how opaque a glass tint must be.
 *
 * Glass is translucent, so its effective background is whatever shows through
 * it - and a floating control can sit over anything, including a full-bleed
 * accent surface. A thin tint measured 1.6:1 for white text against a yellow
 * backdrop: unreadable.
 *
 * The tints below all sit at or above this, and every one keeps white text
 * past 11:1 against the worst backdrop tested.
 */
export const MinGlassTintAlpha = 0.72;

export type GlassToken = {
  /** Fallback and tint colour. Opaque enough to keep text legible alone. */
  readonly tint: string;
  /** The rim. On a black ground this is most of what separates the object. */
  readonly border: string;
  /** Light along the top edge, applied as an inset by `GlassSurface`. */
  readonly highlight: string;
  /**
   * Broad inner shading, for a surface meant to read as a lens rather than a
   * fill. Only the levels that need volume carry one; a hairline highlight is
   * enough for a flat panel, and spreading light across a card would look like
   * a bevel rather than like glass.
   */
  readonly lens?: readonly BoxShadowValue[];
};

/**
 * **The tints are lifted charcoals, not near-blacks.**
 *
 * A near-black tint over a pure black ground composites to itself: `rgba(10,
 * 10, 10, 0.88)` measures 1.04:1 against the background, which is to say the
 * surface is the background and a hairline is all that separates a control
 * from the void. Lifted, these compose to `#1a1a1c` and up - 1.2-1.3:1 - which
 * is what makes an object look like it is in front of something.
 *
 * Nothing was traded for it: white text on them still measures 16-17:1 over
 * black and 11.5:1 over the worst backdrop tested.
 */
export type GlassLevel = 'regular' | 'bar' | 'heavy' | 'action';

export const Glass: Record<GlassLevel, GlassToken> = {
  /** Cards, panels, controls at rest. */
  regular: {
    tint: 'rgba(30, 30, 32, 0.88)',
    border: 'rgba(255, 255, 255, 0.14)',
    highlight: 'rgba(255, 255, 255, 0.16)',
  },
  /** Floating elements that pass over scrolling content. */
  bar: {
    tint: 'rgba(24, 24, 27, 0.90)',
    border: 'rgba(255, 255, 255, 0.10)',
    highlight: 'rgba(255, 255, 255, 0.10)',
  },
  /** Sheets, modals, menus: they must dominate whatever they cover. */
  heavy: {
    tint: 'rgba(25, 25, 25, 0.96)',
    border: 'rgba(255, 255, 255, 0.16)',
    highlight: 'rgba(255, 255, 255, 0.18)',
  },
  /**
   * The primary action: warm glass, not a yellow disc.
   *
   * **The brand colour is no longer the fill.** Filling the shape with it
   * produced a paint swatch that no amount of shading rescued - every effect
   * read as something applied on top of a solid object rather than as the
   * object's own material. So the body is dark amber-tinted glass, and the
   * yellow moves to where a real tinted lens actually shows its colour: the
   * rim that catches the light, the glow held inside the upper half, the halo
   * it casts, and the glyph itself.
   *
   * That inversion is what makes it a piece of glass with light in it instead
   * of a coloured circle. It also buys genuine translucency: at 0.78 the
   * ground and any content scrolling behind really do come through, which was
   * impossible while the surface had to stay opaque enough to keep a
   * near-black glyph legible.
   *
   * Measured, because the body is now barely brighter than the navigation
   * pills beside it - 1.4 points of luminance - and could have stopped reading
   * as the primary action. It does not, because none of what distinguishes it
   * is luminance: hue (warm against neutral), a rim at 10.2:1 on the ground, a
   * yellow glyph at 8.9:1 on the body, its own halo, and its shape and size.
   */
  action: {
    tint: 'rgba(90, 74, 32, 0.80)',
    /**
     * The lit edge. Deliberately dimmer than the glyph: a rim as bright as
     * the mark on it reads as a ring or a toggle, and an outlined circle is
     * the vocabulary of a secondary control in almost every system.
     */
    border: 'rgba(253, 197, 6, 0.58)',
    /** Light catching the top rim, warmed by the glass it passes through. */
    highlight: 'rgba(255, 236, 170, 0.60)',
    /**
     * What turns the disc into a lens.
     *
     * Measured first, because the obvious move is wrong: over a pure black
     * ground, lowering the yellow's alpha does not make it look like glass, it
     * makes it olive - 0.72 composites to #b68e04 and 0.55 to #8b6c03, which
     * is a loss of the brand rather than a gain in material. Translucency is
     * kept real but modest at 0.86, and what actually reads as glass is done
     * here: a wide wash of light down from the top and a contained shade up
     * from the bottom, so the surface varies across its own diameter instead
     * of being one flat value.
     *
     * The colour lives in here, and three asymmetries keep it from becoming a
     * 2008 gel button:
     *
     * - **The glow is small and high, the shade is large and low.** A
     *   highlight and a shade of equal size meeting at the equator is the
     *   signature of a 2010 bevel. Here the light covers roughly an eighth of
     *   the disc and the shade about a third.
     * - **The diffuse layers are a pale warm, not the brand yellow.** Brand
     *   yellow at low alpha over a dark body composes to olive - measured,
     *   #755f1f - which muddies the glass and drags the glyph towards its own
     *   colour field. Saturation belongs where the alpha is high, in the rim
     *   and the glyph; the washes get a pale amber that stays warm when thin.
     * - **The shade deepens towards amber, not towards black.** Darkening with
     *   black desaturates; darkening with hue reads as the material absorbing
     *   light.
     *
     * The blurs are wide on purpose - half the diameter and more. A short blur
     * produces a second hard edge just inside the border, which reads as a
     * double stroke rather than as depth. With no gradients available, a
     * large-radius inset shadow **is** the gradient, and it only becomes a
     * field instead of an edge past roughly 40% of the diameter.
     *
     * Two numbers are held by measurement rather than taste. The body composes
     * to #483b1a: 1.92:1 against the ground, which is what stops the disc from
     * dissolving into a floating ring and a glyph, and 3.5 luminance points
     * above the pills beside it, so it reads as raised rather than as a hole.
     * And the inner glow stops at 0.12, because the glyph measures 4.8:1 over
     * it at 0.14 and 4.3:1 at 0.18 - past the line.
     *
     * The outer halo is warm for a reason that is not decorative: a black
     * shadow on a pure black ground renders nothing, because the pixel is
     * already off. Carrying a trace of its own colour is the only way the
     * object can separate itself from the void outside its own edge. Bounded
     * and low-alpha - the direction rules out filling the interface with
     * glows, and this has to read as light held by glass, not as neon.
     */
    lens: [
      { offsetX: 0, offsetY: 12, blurRadius: 28, color: 'rgba(255, 224, 138, 0.12)', inset: true },
      { offsetX: 0, offsetY: -18, blurRadius: 26, color: 'rgba(20, 15, 0, 0.45)', inset: true },
      // Pushed down rather than centred: a halo hugging the whole rim raises
      // the ground right where the top edge needs to cut against it.
      { offsetX: 0, offsetY: 10, blurRadius: 24, color: 'rgba(255, 224, 138, 0.16)' },
    ],
  },
};

/**
 * LOS MISMOS MATERIALES, RECALIBRADOS PARA EL RENDERIZADOR DE ANDROID.
 *
 * **Es una calibración, no un diseño distinto.** El material sigue siendo el
 * mismo —tinte ámbar, borde amarillo, halo cálido— y lo que cambia son las
 * cifras con las que Android produce esa misma lectura. Ninguna entrada de aquí
 * toca `Glass`, que es lo que iOS resuelve.
 *
 * **Por qué hace falta, medido sobre el emulador.** Android dibuja el borde
 * `hairline` sin la refracción que en iOS lo mete debajo del material, así que
 * un amarillo al 58% sale como un anillo saturado de un píxel; y su desenfoque
 * de sombra es más corto para el mismo número, así que el halo del `+` quedaba
 * pegado al canto y desplazado hacia abajo, leyéndose como una segunda
 * circunferencia en vez de como luz.
 *
 * **Sólo lo que hace falta.** Es un sobreescrito parcial: un nivel que no
 * aparezca aquí usa el token compartido tal cual, y de un nivel que aparezca se
 * cambia sólo el campo listado. Nada se duplica «por simetría».
 */
export const GlassAndroid = {
  regular: {
    /*
     * El canto de un control corriente. Al 14% sobre casi negro y a un píxel,
     * el borde desaparecía y el oblongo se leía como una mancha; subirlo
     * devuelve el filo sin convertirlo en una línea dibujada.
     */
    border: 'rgba(255, 255, 255, 0.22)',
    highlight: 'rgba(255, 255, 255, 0.26)',
  },
  action: {
    /*
     * El `+`. El borde baja de 0.58 a 0.34 porque aquí no pasa por el material
     * que en iOS lo funde, y el resalte del rim baja de 0.60 a 0.24 por lo
     * mismo: sin ese desenfoque era un arco brillante sobre el borde, dos
     * anillos concéntricos donde tiene que haber un canto.
     */
    border: 'rgba(253, 197, 6, 0.50)',
    highlight: 'rgba(255, 236, 170, 0.30)',
    lens: [
      // Los dos interiores no cambian: dentro del disco Android compone bien.
      { offsetX: 0, offsetY: 12, blurRadius: 28, color: 'rgba(255, 224, 138, 0.12)', inset: true },
      { offsetX: 0, offsetY: -18, blurRadius: 26, color: 'rgba(20, 15, 0, 0.45)', inset: true },
      /*
       * El halo, ancho y casi sin desplazar. Es la única entrada de este nivel
       * que proyecta hacia fuera, y por eso es la única que viaja al host.
       * Repartido sobre 40 en vez de 24 deja de tener canto; centrado en vez de
       * caído 10 deja de leerse como una sombra amarilla debajo del botón.
       */
      { offsetX: 0, offsetY: 3, blurRadius: 40, color: 'rgba(255, 214, 92, 0.20)' },
    ],
  },
} as const as Partial<Record<GlassLevel, Partial<GlassToken>>>;

/**
 * Tactile depth, as inner shading.
 *
 * **Rest is raised and a press pushes it down**, not the other way round. The
 * previous set only became visible on press, because its resting shadow was
 * black on a black ground and its inner highlight was painted on a parent that
 * the surface then covered. So the control looked like a flat rectangle that
 * grew depth when touched, which is backwards.
 *
 * Every state is expressed as inner shading against the surface's own colour,
 * which is the only thing that works when there is nothing behind to cast onto.
 * The light is always from above: a raised object is shaded along its lower
 * inside edge, a pressed one along its upper inside edge, and the inversion is
 * what the eye reads as a push.
 *
 * The hard rule that survives every visual revision: **depth may reinforce an
 * affordance, never carry it alone.** Colour, weight and label still do their
 * share; this only makes the object feel like an object.
 *
 * These arrays go on the view that paints the surface - `GlassSurface` applies
 * them - and never on a transparent parent, where an inset shadow is drawn and
 * then covered by the child.
 */
/**
 * LOS VALORES APROBADOS, QUE SON LOS DE iOS. No se tocan.
 *
 * Se miden y se deciden sobre el iPhone, y son la referencia de la que Android
 * tiene que parecerse — no al reves.
 */
export const TactileIOS = {
  /** At rest, in front of the ground. */
  raised: [
    { offsetX: 0, offsetY: -10, blurRadius: 14, color: 'rgba(0, 0, 0, 0.45)', inset: true },
    { offsetX: 0, offsetY: 8, blurRadius: 20, color: 'rgba(0, 0, 0, 0.65)' },
  ],
  /** Chosen: further forward, and lit a little harder. */
  selected: [
    { offsetX: 0, offsetY: -12, blurRadius: 16, color: 'rgba(0, 0, 0, 0.38)', inset: true },
    { offsetX: 0, offsetY: 10, blurRadius: 26, color: 'rgba(0, 0, 0, 0.75)' },
  ],
  /** Held down: the shading flips to the top and the outer shadow goes. */
  pressed: [
    { offsetX: 0, offsetY: 8, blurRadius: 12, color: 'rgba(0, 0, 0, 0.62)', inset: true },
    { offsetX: 0, offsetY: -2, blurRadius: 2, color: 'rgba(255, 255, 255, 0.06)', inset: true },
  ],
  /** Recessed at rest: still an object, just set back. */
  well: [
    { offsetX: 0, offsetY: 5, blurRadius: 8, color: 'rgba(0, 0, 0, 0.50)', inset: true },
    { offsetX: 0, offsetY: 2, blurRadius: 6, color: 'rgba(0, 0, 0, 0.35)' },
  ],
} as const satisfies Record<string, readonly BoxShadowValue[]>;

/**
 * LA MISMA PROFUNDIDAD EN ANDROID, Y HACEN FALTA OTRAS CIFRAS.
 *
 * **Los mismos numeros no dan el mismo resultado.** Android compone `boxShadow`
 * por su cuenta, y sobre todo las `inset`: lo que en iOS es un sombreado que se
 * desvanece hacia dentro sale alli como un contorno duro. Con los valores de
 * arriba, cada control quedaba rodeado de un anillo negro, la sombra exterior
 * pesaba el doble y los controles con dos capas —el dock, el CTA— mostraban
 * halos dobles. Medido sobre el emulador, no supuesto.
 *
 * **Y la correccion es ESTRUCTURAL, no de opacidades.** En iOS cada estado son
 * dos capas —una interior y una exterior— que se funden con la `inset` del rim
 * en un relieve continuo. Android no las funde: las apila, y tres sombras
 * interiores sobre la misma vista son el anillo negro de la captura.
 *
 * Asi que aqui cada estado tiene UNA sola sombra. El relieve superior lo pone el
 * rim, que ya es interior; el estado pone la exterior. Cada oblongo queda con lo
 * que debe tener y nada mas: un rim, una sombra exterior y su borde fino.
 *
 * Se conserva la jerarquia —elegido pesa mas que reposo, hundido menos— y el
 * sentido de cada estado: pulsado deja de proyectar y mete su unica sombra
 * hacia dentro, que es lo que se lee como un empuje.
 *
 * **Y vive aqui, en un solo sitio.** Nada de sombras por componente ni de
 * `elevation` como parche: quien consume `Tactile` recibe ya la calibracion de
 * su plataforma, incluidos los cinco sitios que la aplican directamente.
 */
export const TactileAndroid = {
  /**
   * En reposo: UNA sola sombra, y va fuera.
   *
   * El relieve superior lo da el rim, que ya es una `inset`. Sumarle la `inset`
   * del estado es lo que producia el anillo: dos sombras interiores sobre la
   * misma vista, que Android no funde sino que apila.
   */
  raised: [
    { offsetX: 0, offsetY: -8, blurRadius: 12, color: 'rgba(0, 0, 0, 0.34)', inset: true },
    { offsetX: 0, offsetY: 1, blurRadius: 24, color: 'rgba(0, 0, 0, 0.16)' },
  ],
  /** Elegido: la misma sombra, un poco mas presente. La jerarquia se conserva. */
  selected: [
    { offsetX: 0, offsetY: -6, blurRadius: 11, color: 'rgba(0, 0, 0, 0.20)', inset: true },
    { offsetX: 0, offsetY: 1, blurRadius: 26, color: 'rgba(0, 0, 0, 0.16)' },
  ],
  /**
   * Pulsado: se deja de proyectar y entra UNA interior corta. Es la inversion
   * que se lee como un empuje, con una sola capa en vez de dos.
   */
  pressed: [
    { offsetX: 0, offsetY: 4, blurRadius: 8, color: 'rgba(0, 0, 0, 0.30)', inset: true },
    { offsetX: 0, offsetY: -2, blurRadius: 3, color: 'rgba(255, 255, 255, 0.05)', inset: true },
  ],
  /** Hundido: sombra exterior minima, que es lo que lo mete hacia dentro. */
  well: [{ offsetX: 0, offsetY: 3, blurRadius: 7, color: 'rgba(0, 0, 0, 0.24)', inset: true }],
  /**
   * DESHABILITADO — y esta variante NO existe en iOS.
   *
   * Añadirla a `TactileState` habría obligado a darle una entrada a
   * `TactileIOS`, que está congelado, así que vive sólo aquí y sólo la pide la
   * implementación Android de `GlassSurface`.
   *
   * **Conserva la estructura y baja la profundidad.** Un control apagado sigue
   * siendo una píldora con su borde: lo que pierde es el relieve, no la forma.
   * De ahí un resalte interior mínimo y una proyección corta y muy tenue en vez
   * de ninguna — sin proyección se leería recortado contra el fondo.
   */
  disabled: [
    { offsetX: 0, offsetY: -2, blurRadius: 6, color: 'rgba(0, 0, 0, 0.12)', inset: true },
    { offsetX: 0, offsetY: 1, blurRadius: 10, color: 'rgba(0, 0, 0, 0.05)' },
  ],
  /*
   * Comprueba que Android cubre TODOS los estados de iOS. Al revés no: aquí hay
   * uno más —`disabled`— y darle una entrada a iOS habría descongelado su token
   * para una variante que iOS no usa.
   */
} as const satisfies Record<keyof typeof TactileIOS | 'disabled', readonly BoxShadowValue[]>;

export type TactileState = keyof typeof TactileIOS;

/**
 * EL MATERIAL DE LAS SUPERFICIES DE ANDROID, POR ROL.
 *
 * **Igualar el hexadecimal no iguala lo que se ve, y ese fue el error.** Se
 * midio el pixel de una captura de iOS —#0C0C0C— y se le dio a Android el mismo
 * valor. Pero en iOS una tarjeta son DOS cosas: ese color y, encima, el material
 * de `GlassView` con su desenfoque y su refraccion. Android no tiene la segunda
 * —`isLiquidGlassAvailable()` es false— asi que con el mismo numero queda doce
 * puntos por encima del negro y se confunde con el fondo.
 *
 * Aqui va lo que Android necesita para APARENTAR esa separacion, no para
 * repetir su cifra. Es una calibracion: se valida mirando, no midiendo.
 */
export const AndroidSurface = {
  /**
   * Las tarjetas estructurales de Inicio: Disponible, Ingresos, Gastos y el
   * reparto por categorias. Gris oscuro sobre negro — y el hueco del donut,
   * que es la misma superficie vista por un agujero.
   */
  homeCard: '#1C1C1E',
} as const;

/**
 * EL MATERIAL DE UN CONTROL NEUTRO EN ANDROID.
 *
 * **Aprobado sobre el aparato, no deducido.** Es el resultado del laboratorio
 * de F6.G: un relleno plano y un hilo de un pixel que recorre todo el
 * perimetro, algo mas marcado arriba. Nada mas — ni degradado, ni ruido, ni
 * desenfoque, ni sombreado interior, ni sombra exterior, ni `elevation`. Cada
 * una de esas tecnicas se probo y se descarto fisicamente.
 *
 * **El rim SI es un `borderColor` uniforme, y eso es deliberado.** Se intento
 * con un color por lado y Android lo resolvia mal: las uniones entre lados
 * salian con cortes, el oblongo se partia a la derecha y el circulo cargaba a
 * la izquierda —en una circunferencia no hay cuatro lados que repartir—. Un
 * solo color no tiene uniones que resolver. La direccionalidad la aporta una
 * SEGUNDA capa que solo pinta el canto de arriba, y las dos se suman en esa
 * misma fila sin anadir un segundo pixel.
 *
 * **El grosor no vive aqui**: es `StyleSheet.hairlineWidth` —un pixel fisico—, y
 * lo aplica `control-material.android.tsx`, porque este fichero es datos puros y
 * no importa nada de React Native en ejecucion.
 *
 * **iOS no conoce este token.** Solo lo lee la implementacion Android.
 */
export const ControlAndroid = {
  /** Relleno plano, gris neutro, cinco niveles por encima del panel. */
  fill: '#1D1D1D',
  /**
   * El rim CONTINUO, en un unico color para toda la vuelta.
   *
   * Un borde con un color por lado se ve bien en un rectangulo y mal en una
   * curva: Android resuelve las uniones entre lados con cortes visibles, y en un
   * circulo el reparto ni siquiera es simetrico —el oblongo se cortaba a la
   * derecha y el circulo cargaba a la izquierda—. Un solo color no tiene
   * uniones que resolver, asi que recorre los 360 grados sin un salto.
   */
  rimBase: 'rgba(255, 255, 255, 0.20)',
  /**
   * Y la luz de arriba, en su propia capa y solo en el canto superior.
   *
   * Se suma al rim base en esa misma fila —0,20 debajo y 0,08 encima dan la
   * intensidad aprobada— sin anadir un segundo pixel y sin volver a mezclar
   * colores por lado dentro de una capa.
   */
  rimTopAccent: 'rgba(255, 255, 255, 0.08)',
} as const;

/**
 * EL RIM DE UN CONTROL TRANSLUCIDO EN ANDROID.
 *
 * Hay controles cuyo relleno NO puede volverse el gris solido de
 * `ControlAndroid`: la pildora seleccionada del dock vive sobre el cristal del
 * dock, y el CTA apagado es transparente a proposito —«apagado no se pinta
 * amarillo apagado, se queda sin relleno»—. Sustituirles el material les quitaba
 * la translucidez que les da sentido.
 *
 * Lo unico que necesitan de Android es lo mismo que los demas: **que desaparezca
 * la sombra interior y que el perimetro quede declarado**. De ahi que este token
 * tenga UNA sola cifra: el rim. El relleno lo sigue poniendo el consumidor.
 *
 * Mismo valor que el rim base de los controles solidos, y a proposito: un
 * perimetro no cambia de intensidad porque debajo haya otro relleno.
 *
 * **iOS no conoce este token.**
 */
export const TranslucentControlAndroid = {
  rim: 'rgba(255, 255, 255, 0.20)',
} as const;

/**
 * EL MATERIAL DE UNA VENTANA EN ANDROID.
 *
 * **Separado del de los controles a proposito.** Una ventana no es un control:
 * no se pulsa, no tiene estados y no necesita direccionalidad. Compartir token
 * habria hecho que cualquier calibracion de los botones moviera los paneles.
 *
 * **El relleno no es un color elegido, es el que ya tenia.** Se midio una zona
 * limpia del centro de la ventana actual —RGB 25,2 / 25,2 / 25,3— y ese es el
 * valor. Lo que desaparece es la VARIACION, no el tono: el interior iba de 29
 * arriba a 22 abajo, y ahora es 25 en toda la superficie.
 *
 * **El rim es UNIFORME y completo**, sin acento superior: una ventana no tiene
 * una direccion de luz que contar, tiene un limite que declarar.
 *
 * El grosor es `StyleSheet.hairlineWidth` y lo aplica la implementacion Android,
 * porque este fichero es datos puros y no importa React Native en ejecucion.
 *
 * **iOS no conoce este token.**
 */
export const WindowAndroid = {
  /** Medido en el centro de la ventana aprobada. */
  fill: '#191919',
  /** Un unico color para los 360 grados. */
  rim: 'rgba(255, 255, 255, 0.20)',
} as const;

/**
 * CUANTO SE EXTIENDE LA LUZ DEL BORDE SUPERIOR, y por que Android necesita algo.
 *
 * El rim `catch` es una linea sin difuminar: en iOS describe el canto, y en
 * Android sale como una banda dura que se lee como un segundo borde. Un punto y
 * medio de difuminado basta para que vuelva a ser luz y no contorno; `soft` ya
 * lo tenia y no cambia en ninguna de las dos.
 */
export const RimBlurIOS = { catch: 0, soft: 4 } as const;
export const RimBlurAndroid = { catch: 0.5, soft: 4 } as const;
