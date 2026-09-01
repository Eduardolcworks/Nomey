import { describe, expect, it } from 'vitest';

/**
 * El tamaño y la posición de la ventana de «Añadir movimiento».
 *
 * Se comprueba la ARITMÉTICA, que es lo que puede razonarse sin un aparato: que
 * la ventana conserve la proporción de la pantalla, que quepa dentro del área
 * segura y que quede centrada. Cómo se ve es cosa del dispositivo, y ningún
 * test lo sustituye.
 *
 * La fórmula es la de `app/add.tsx` y se reproduce aquí a propósito: si alguien
 * la cambia allí, esto deja de describir la pantalla y hay que venir a mirarlo.
 */

type Screen = { name: string; width: number; height: number; top: number; bottom: number };

/** Medidas reales, no inventadas: los tres formatos que hay hoy en iOS. */
const SCREENS: Screen[] = [
  { name: 'iPhone SE (sin notch)', width: 375, height: 667, top: 20, bottom: 0 },
  { name: 'iPhone 14 Pro', width: 393, height: 852, top: 59, bottom: 34 },
  { name: 'iPhone 15 Pro Max', width: 430, height: 932, top: 59, bottom: 34 },
];

function panel(screen: Screen) {
  const { width, height, top, bottom } = screen;
  const panelHeight = height - top - bottom - height * 0.1;
  const panelWidth = Math.min(panelHeight * (width / height), width - width * 0.06);
  return { panelWidth, panelHeight };
}

describe('la ventana del + ', () => {
  it('tiene la proporción de la pantalla, escalada', () => {
    for (const screen of SCREENS) {
      const { panelWidth, panelHeight } = panel(screen);
      const ratio = panelWidth / panelHeight;
      const target = screen.width / screen.height;
      // Salvo que el tope de anchura entre en juego, que es otro caso.
      expect(ratio, screen.name).toBeCloseTo(target, 3);
    }
  });

  it('y es más pequeña que la pantalla en los dos ejes', () => {
    for (const screen of SCREENS) {
      const { panelWidth, panelHeight } = panel(screen);
      expect(panelWidth, screen.name).toBeLessThan(screen.width);
      expect(panelHeight, screen.name).toBeLessThan(screen.height);
    }
  });

  /**
   * Centrada en el VIEWPORT, que es lo pedido: el mismo margen arriba que
   * abajo. Y ese margen tiene que ser mayor que el área segura superior, o la
   * ventana se metería bajo el notch.
   */
  it('centrada, deja el mismo margen arriba y abajo, y esquiva el notch', () => {
    for (const screen of SCREENS) {
      const { panelHeight } = panel(screen);
      const margen = (screen.height - panelHeight) / 2;

      expect(margen, screen.name).toBeGreaterThan(screen.top);
      expect(margen, screen.name).toBeGreaterThan(screen.bottom);
    }
  });

  /** Y queda sitio para el formulario: el selector es la pieza más ancha. */
  it('el contenido cabe: el selector de clase es lo más ancho que lleva', () => {
    const SELECTOR = 64 * 3 + 4 * 2; // tres segmentos y el relleno de la pista
    const RELLENO = 16 * 2; // `body.paddingHorizontal`

    for (const screen of SCREENS) {
      const { panelWidth } = panel(screen);
      expect(panelWidth - RELLENO, screen.name).toBeGreaterThan(SELECTOR);
    }
  });

  /**
   * En una pantalla ancha —una tableta, o el móvil tumbado— la altura por la
   * proporción daría un ancho mayor que la pantalla. El tope existe para eso.
   */
  it('en apaisado el tope de anchura evita que se salga', () => {
    const landscape: Screen = { name: 'tumbado', width: 852, height: 393, top: 0, bottom: 21 };
    const { panelWidth } = panel(landscape);

    expect(panelWidth).toBeLessThanOrEqual(landscape.width - landscape.width * 0.06);
    expect(panelWidth).toBeLessThan(landscape.width);
  });
});

/**
 * Cuánto sube la ventana cuando aparece el teclado.
 *
 * Antes no se apartaba, y con la ventana midiendo una fracción de la pantalla
 * era lo correcto: no cabía junto al teclado, así que encogerla la habría
 * sacado por arriba. Ahora mide lo que su contenido, cabe, y subir es mejor que
 * dejar campos tapados — sobre todo en la pantalla pequeña, donde el concepto
 * quedaba justo al límite.
 *
 * **La cantidad sale de la geometría real**: la altura que informa el teclado y
 * la de la ventana, medida. Aquí se reproduce esa fórmula para fijar sus dos
 * propiedades — que basta y que no se pasa —, no para inventar alturas de
 * teclado: las de abajo son órdenes de magnitud para comprobar el ÁLGEBRA, y el
 * dato real lo pone el sistema en cada evento.
 */
describe('el desplazamiento por teclado', () => {
  const PANEL = 492;
  const GAP = 16;

  function lift(screen: Screen, keyboard: number) {
    const keyboardTop = screen.height - keyboard;
    const panelTop = (screen.height - PANEL) / 2;
    const needed = panelTop + PANEL + GAP - keyboardTop;
    const room = panelTop - screen.top;
    return Math.max(0, Math.min(needed, room));
  }

  it('nunca sube por encima del área segura', () => {
    for (const screen of SCREENS) {
      for (const teclado of [216, 260, 300, 336, 400]) {
        const panelTop = (screen.height - PANEL) / 2;
        expect(
          panelTop - lift(screen, teclado),
          `${screen.name} · ${teclado}`,
        ).toBeGreaterThanOrEqual(screen.top);
      }
    }
  });

  it('y nunca baja: subir es un desplazamiento, no una corrección', () => {
    for (const screen of SCREENS) {
      for (const teclado of [0, 100, 216, 336]) {
        expect(lift(screen, teclado), screen.name).toBeGreaterThanOrEqual(0);
      }
    }
  });

  /** Sin teclado no se mueve, que es lo que hace exacta la posición base. */
  it('sin teclado el desplazamiento es cero', () => {
    for (const screen of SCREENS) {
      expect(lift(screen, 0), screen.name).toBe(0);
    }
  });

  /** Y con el teclado abierto, el concepto queda por encima de él. */
  it('el concepto queda visible con el teclado abierto', () => {
    const DESDE_ARRIBA = 250; // dónde cae la fila del concepto dentro del panel
    for (const [screen, teclado] of [
      [SCREENS[0], 260],
      [SCREENS[1], 336],
      [SCREENS[2], 336],
    ] as const) {
      const panelTop = (screen.height - PANEL) / 2 - lift(screen, teclado);
      expect(panelTop + DESDE_ARRIBA, screen.name).toBeLessThan(screen.height - teclado);
    }
  });
});

describe('la ventana compacta', () => {
  /** Alto del contenido, sumado de los estilos que lo componen. */
  const CONTENIDO =
    8 +
    44 +
    4 + // encabezado
    54 +
    16 + // selector
    20 +
    16 + // ámbito
    (8 * 2 + 56) +
    16 + // importe
    52 +
    16 + // concepto
    18 +
    16 + // nota de la fecha
    (32 + 18 + 8 + 58) + // pie: separación, aviso, hueco y Guardar
    24; // relleno inferior

  it('el ancho es exactamente el de antes', () => {
    for (const screen of SCREENS) {
      const { panelWidth } = panel(screen);
      const referencia = Math.min(
        (screen.height - screen.top - screen.bottom - screen.height * 0.1) *
          (screen.width / screen.height),
        screen.width - screen.width * 0.06,
      );
      expect(panelWidth, screen.name).toBeCloseTo(referencia, 6);
    }
  });

  it('y la altura baja a la del contenido en todas las pantallas', () => {
    for (const screen of SCREENS) {
      const { panelHeight } = panel(screen);
      const alto = Math.min(CONTENIDO, panelHeight);

      expect(alto, screen.name).toBeLessThan(panelHeight);
      // Y ya no depende del aparato: la misma en las tres.
      expect(alto, screen.name).toBe(CONTENIDO);
    }
  });

  it('sigue centrada, y sin meterse bajo el notch', () => {
    for (const screen of SCREENS) {
      const margen = (screen.height - CONTENIDO) / 2;
      expect(margen, screen.name).toBeGreaterThan(screen.top);
      expect(margen, screen.name).toBeGreaterThan(screen.bottom);
    }
  });

  /** El tope sigue siendo real: en la pantalla más pequeña aún sobra sitio. */
  it('el contenido cabe bajo el tope incluso en la pantalla pequeña', () => {
    const { panelHeight } = panel(SCREENS[0]);
    expect(CONTENIDO).toBeLessThan(panelHeight);
  });
});

/**
 * El eje derecho del bloque central.
 *
 * El control de moneda se centra sobre el ancho de los dos círculos que tiene
 * debajo, de modo que las dos filas comparten eje en vez de ser dos filas sin
 * relación. Como ambos salen de la misma constante, la coincidencia no es un
 * ajuste: es una identidad, y aquí se comprueba que se mantiene en cualquier
 * ancho de pantalla.
 */
/**
 * La cifra cae en el centro del ancho útil, no desplazada por el control.
 *
 * La fila es `[contrapeso][hueco][cifra][hueco][€]`, y como el contrapeso mide
 * lo mismo que el control, la simetría es exacta: no es un ajuste que haya que
 * revisar, es una identidad.
 */
describe('la cifra del importe', () => {
  const MONEDA = 56;
  const HUECO = 16; // amountRow.gap
  const RELLENO = 16; // body.paddingHorizontal

  it('su centro es el del ancho útil, en cualquier pantalla', () => {
    for (const screen of SCREENS) {
      const { panelWidth } = panel(screen);
      const util = panelWidth - RELLENO * 2;
      const ranura = util - MONEDA - HUECO - HUECO - MONEDA;

      expect(MONEDA + HUECO + ranura / 2, screen.name).toBeCloseTo(util / 2, 6);
    }
  });

  /** Y le queda sitio: «55,55» a cuerpo 56 ronda los 105 puntos. */
  it('y la ranura da para una cantidad de cuatro cifras', () => {
    for (const screen of SCREENS) {
      const { panelWidth } = panel(screen);
      const ranura = panelWidth - RELLENO * 2 - MONEDA * 2 - HUECO * 2;
      expect(ranura, screen.name).toBeGreaterThan(110);
    }
  });
});
