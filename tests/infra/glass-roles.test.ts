import { describe, expect, it } from 'vitest';

/**
 * QUÉ SUPERFICIE ES UN CONTROL Y CUÁL ES ESTRUCTURA.
 *
 * `GlassSurface` pinta las dos cosas, y por eso la distinción no se ve en el
 * tipo: una ventana, una tarjeta y un botón se escriben igual. Lo que las
 * separa es su función, y aquí queda escrita — que es lo que impide que la
 * próxima superficie se clasifique por su nombre o por dónde vive.
 *
 * **La regla:** un control renuncia al efecto nativo y se apoya en el relieve
 * de los tokens; una superficie estructural conserva el cristal nativo. Las dos
 * ramas pintan los MISMOS tokens —tinte, borde, radio, rim y profundidad—, así
 * que la renuncia no cambia de material: sólo cede la refracción en vivo de lo
 * que queda detrás.
 *
 * **Y el defecto sigue siendo el cristal nativo.** Una superficie que nadie ha
 * clasificado se comporta como siempre; apagarlo es una decisión explícita y
 * por eso se puede enumerar.
 */

const SOURCES = import.meta.glob('../../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const FILES = Object.entries(SOURCES).map(([file, text]) => ({
  path: file.replace('../../src/', ''),
  text: text as string,
}));

/** El fuente sin comentarios: aquí se afirma sobre el código, no sobre la prosa. */
function code(relative: string): string {
  return (FILES.find((candidate) => candidate.path === relative)?.text ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/**
 * LOS CONTROLES. Se pulsan, se escriben o se arrastran.
 *
 * `GlassPressable` es el punto central: su definición entera es «superficie que
 * se pulsa», así que lo lleva dentro y con él van la moneda, el CTA `Guardar` y
 * el calendario sin que ninguno lo pida. Los demás montan `GlassSurface`
 * directamente porque tienen su propio gesto o su propio estado, y cada uno
 * está clasificado a mano — que no es lo mismo que a bulto.
 */
const CONTROLES: readonly (readonly [string, number, string])[] = [
  ['ui/components/glass-pressable.tsx', 1, 'el primitive de los botones de cristal'],
  ['features/personal/movement-fields.tsx', 1, 'la superficie del concepto'],
  ['features/personal/category-trigger.tsx', 1, 'el círculo de categoría'],
  ['features/personal/entry-kind-selector.tsx', 1, 'la pista del selector − / + / ⇄'],
  ['features/shell/scope-switch.tsx', 1, 'el selector Personal/Pareja'],
  ['features/shell/nomey-tab-bar.tsx', 2, 'las dos ACCIONES del dock'],
];

/**
 * LA ESTRUCTURA. Contiene cosas, no se pulsa.
 *
 * Incluye dos casos que se clasifican por función y no por nombre: los grupos
 * de Perfil parecen botones porque llevan filas pulsables dentro, pero la
 * superficie es el grupo y lo pulsable es cada fila —un `Pressable` corriente
 * que no pinta cristal—; y el fondo del dock, que ni siquiera es una
 * `GlassSurface`.
 */
const ESTRUCTURA: readonly (readonly [string, string])[] = [
  ['ui/components/sheet-window.tsx', 'el panel de la ventana'],
  ['features/personal/entry-pickers.tsx', 'la hoja del calendario'],
  ['features/personal/balance-card.tsx', 'el bloque de deudas de la tarjeta'],
  ['app/profile.tsx', 'la tarjeta de planes y los grupos de opciones'],
];

describe('el relieve de los controles', () => {
  it('el efecto nativo sigue siendo el defecto de la superficie', () => {
    const superficie = code('ui/components/glass-surface.tsx');
    expect(superficie).toContain('nativeEffect = true');
    expect(superficie).toContain('useNativeGlass() && nativeEffect');
  });

  it('cada control clasificado renuncia al efecto nativo', () => {
    for (const [path, veces, que] of CONTROLES) {
      expect(code(path).match(/nativeEffect=\{false\}/g) ?? [], `${path} — ${que}`).toHaveLength(
        veces,
      );
    }
  });

  it('y ninguna superficie estructural lo hace', () => {
    for (const [path, que] of ESTRUCTURA) {
      expect(code(path), `${path} — ${que}`).not.toContain('nativeEffect');
    }
  });

  /**
   * **La lista es cerrada.** Sin esto, la estética se extendería sola: cada
   * superficie nueva copiaría a su vecina y la distinción dejaría de existir a
   * los tres commits.
   */
  it('no hay más renuncias que las clasificadas', () => {
    const renuncias = FILES.filter((f) => code(f.path).includes('nativeEffect={false}'))
      .map((f) => f.path)
      .sort();

    expect(renuncias).toEqual(CONTROLES.map(([path]) => path).sort());
  });

  /**
   * **Y el fondo del dock no es una de estas superficies**, que es lo que hace
   * que «las acciones sí, el contenedor no» sea estructural y no una promesa.
   */
  it('el contenedor del dock no es una superficie de cristal', () => {
    const dock = code('features/shell/nomey-tab-bar.tsx');
    const contenedor = dock.slice(0, dock.indexOf('function DestinationButton'));
    expect(contenedor).not.toContain('<GlassSurface');
  });
});
