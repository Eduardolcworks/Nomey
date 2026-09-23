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
  /*
   * El círculo de categoría. Bajó a `ui/` cuando el alta de un gasto compartido
   * necesitó el mismo botón: sólo dependía de `ui/`, así que la mudanza no le
   * cambió ni un token.
   */
  ['ui/components/category-trigger.tsx', 1, 'el círculo de categoría'],
  /*
   * La pista del selector de clase. Bajó a `ui/` cuando el alta de un gasto
   * compartido necesitó el mismo control con dos opciones en vez de tres: una
   * feature no puede leer de otra. Lo que se quedó arriba son las clases, sus
   * glifos y sus tonos, que no pintan superficie ninguna.
   */
  ['ui/components/kind-selector.tsx', 1, 'la pista del selector de clase'],
  ['features/shell/scope-switch.tsx', 1, 'el selector Personal/Pareja'],
  ['features/shell/nomey-tab-bar.tsx', 2, 'las dos ACCIONES del dock'],
  /*
   * Los emblemas de la hoja de Grupos. Renuncian por el mismo motivo que el `+`
   * del que salen: no son superficies que contengan nada, son la marca de una
   * acción — y aquí, además, ni siquiera se pulsan. La tarjeta entera es el
   * botón; el disco es su emblema.
   */
  [
    'features/groups/group-action-sheet.tsx',
    1,
    'el emblema de la hoja, escrito una vez y pintado dos',
  ],
  /* Únete (F09/ADR-004): el emblema de la tarjeta del QR, el oblongo «Pegar
   * enlace» que se pulsa, y el avión redondo que envía. */
  ['features/groups/join-panel.tsx', 3, 'el emblema del QR, «Pegar enlace» y el avión'],
  /*
   * El formulario de crear grupo. Tres superficies y las tres son controles:
   * el disco del emoji —el mismo emblema de la hoja, aquí sí pulsable—, el
   * campo del nombre y las dos filas de participante: la del creador, que se
   * lee y no se escribe, y la editable, escrita una vez y pintada tantas veces
   * como participantes se añadan.
   */
  ['features/groups/group-form.tsx', 4, 'el emoji, el nombre y las dos filas de participante'],
  /* El campo de divisa: la cabecera que se pulsa, y su estado de carga. */
  ['features/groups/currency-field.tsx', 3, 'el campo de divisa: bloqueado, abierto y cargando'],
  /* El buscador del selector de emojis. Se toca y se escribe en él. */
  ['features/groups/emoji-picker.tsx', 1, 'el buscador del teclado de emojis'],
  /*
   * El `+` de la pantalla interior de un grupo. Es el MISMO material que la
   * acción del dock —de ahí la misma renuncia— y desde F9 es un control de
   * verdad: abre la ventana de añadir gasto compartido.
   *
   * Está clasificado aquí y no en ESTRUCTURA porque no contiene nada: es la
   * acción. Si la pieza se retira, la entrada se retira con ella.
   */
  ['app/group/[id].tsx', 1, 'el  de gasto compartido'],
  /*
   * El oblongo que despliega un menú. Un control, y de los que más se pulsan de
   * la ventana: el pagador y el método salen los dos de esta misma pieza.
   */
  ['ui/components/menu-pill.tsx', 1, 'el oblongo de pagador y de método'],
  /* El campo de concepto de un gasto compartido, hermano del de Personal. */
  ['features/groups/shared-expense-fields.tsx', 1, 'la superficie del concepto'],
  /*
   * F12.C: el campo del @username del destinatario, y el del concepto de la
   * propuesta. Los dos son hermanos del concepto de Personal: un pozo que se
   * escribe, no una superficie que contiene.
   */
  ['features/transfers/recipient-field.tsx', 2, 'el campo del @username, buscando y ya resuelto'],
  ['features/transfers/transfer-form.tsx', 1, 'el concepto de la propuesta'],
  /*
   * F12.E.B: el campo del @username de «Añadir amigo». El mismo pozo que el
   * del destinatario de una transferencia y por el mismo motivo —se escribe en
   * él—, pero UNA sola renuncia y no dos: aquí el hallazgo no se pinta dentro
   * del campo, sino en su propia tarjeta (`candidate-result.tsx`), porque la
   * misma identidad ofrece cinco cosas distintas según la relación.
   */
  ['features/friends/candidate-field.tsx', 1, 'el campo del @username de Amigos'],
  /*
   * F12.E.E: el buscador del selector de Amigos. Se escribe en él, como el
   * del teclado de emojis. La hoja que lo contiene NO renuncia: eso es
   * estructura, y por eso sólo hay una renuncia en este fichero.
   */
  ['features/friends/friend-picker.tsx', 1, 'el buscador local del selector de Amigos'],
  /*
   * Lo que cada participante DECLARA cuando el método lo pide: sus partes o su
   * importe. Es un campo, escrito una vez y pintado tantas veces como personas
   * participen. La tarjeta que lo contiene NO renuncia: eso es estructura.
   */
  [
    'features/groups/split-participants-card.tsx',
    2,
    'el control −/+ de partes y el oblongo de la cuota',
  ],
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
