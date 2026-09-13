import { describe, expect, it } from 'vitest';

import LAYOUT from '../../src/app/_layout.tsx?raw';
import ROUTE from '../../src/app/group-action.tsx?raw';
import SHEET from '../../src/features/groups/group-action-sheet.tsx?raw';
import TAB_BAR from '../../src/features/shell/nomey-tab-bar.tsx?raw';
import TABS_LAYOUT from '../../src/app/(tabs)/_layout.tsx?raw';
import SCRIM from '../../src/ui/components/scrim.tsx?raw';
import BACKDROP from '../../src/features/shell/add-backdrop.tsx?raw';
import ACTIONS from '../../src/features/groups/group-actions.ts?raw';
import GLASS_IOS from '../../src/ui/components/glass-surface.tsx?raw';
import GLASS_ANDROID from '../../src/ui/components/glass-surface.android.tsx?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import EN from '../../src/lib/i18n/messages/en.ts?raw';

/**
 * El `+` lleva a donde toca, y la hoja se presenta como las demás.
 *
 * **El defecto que fija.** El botón navegaba SIEMPRE a `/add` —el alta de un
 * movimiento personal— y lo único que cambiaba con el destino era la etiqueta
 * accesible: en Grupos abría el alta de Personal con otro nombre. No fallaba
 * nada, simplemente hacía otra cosa, que es la peor forma de equivocarse.
 *
 * **Lo que se prueba en otro sitio.** El orden de las dos acciones y que una no
 * dispare la de la otra son datos y una función pura, y se interrogan por
 * comportamiento en `tests/lib/group-actions.test.ts`. Aquí queda el cableado:
 * qué ruta abre cada destino y cómo se declara la ventana. Sin renderer de
 * React no hay árbol al que preguntárselo, y añadir uno era una dependencia que
 * nadie ha aprobado.
 */

describe('el `+` bifurca por destino', () => {
  it('revisa de verdad lo que dice revisar', () => {
    expect(TAB_BAR).toContain('destinationFor');
    expect(TAB_BAR).toContain('/add');
  });

  it('Personal conserva su ruta y sus parámetros, intactos', () => {
    expect(TAB_BAR).toContain("router.push({ pathname: '/add', params: { from: destination } })");
  });

  it('Grupos abre el selector, y sale antes de tocar la ruta de Personal', () => {
    const press = TAB_BAR.slice(TAB_BAR.indexOf('onPress={() => {'));
    const rama = press.indexOf("destination === 'groups'");
    const selector = press.indexOf("router.push('/group-action')");
    const personal = press.indexOf("pathname: '/add'");

    expect(rama).toBeGreaterThan(-1);
    expect(selector).toBeGreaterThan(rama);
    // El `return` está en medio: sin él, Grupos apilaría las dos ventanas.
    expect(press.slice(selector, personal)).toContain('return;');
  });

  it('y el fondo se enciende antes de navegar, en las dos ramas', () => {
    const press = TAB_BAR.slice(TAB_BAR.indexOf('onPress={() => {'));
    expect(press.indexOf('backdrop.show(SHEET_BLUR_INTENSITY)')).toBeLessThan(
      press.indexOf("router.push('/group-action')"),
    );
  });
});

describe('la ventana se presenta como las otras tres', () => {
  it('está declarada como modal transparente y con fondo transparente', () => {
    /*
     * Sin `contentStyle` transparente, las `screenOptions` de la raíz le darían
     * el negro del tema: la presentación sería transparente y el CONTENIDO no,
     * y detrás se vería un rectángulo negro en vez de Grupos desenfocado.
     */
    const bloque = LAYOUT.slice(LAYOUT.indexOf('name="group-action"'));
    expect(bloque).toContain("presentation: 'transparentModal'");
    expect(bloque).toContain("animation: 'fade'");
    expect(bloque).toContain("contentStyle: { backgroundColor: 'transparent' }");
  });

  it('y apaga el fondo al desmontarse, no al pulsar cerrar', () => {
    // Cubre además el gesto del sistema y el botón Atrás, que si no dejarían el
    // desenfoque encendido sobre una pantalla sin ventana.
    expect(ROUTE).toContain('useEffect(() => hideBackdrop, [hideBackdrop])');
  });
});

describe('la hoja se comporta como una ventana modal', () => {
  it('el panel ENTERO sube desde abajo y baja al cerrarse', () => {
    // `SLIDE_IN` es `SlideInDown`, y va en el panel — no en cada tarjeta, que
    // sería el fundido de dos objetos sueltos que esto no debe ser.
    const panel = SHEET.slice(SHEET.indexOf('<Animated.View'));
    expect(panel).toContain('entering={SLIDE_IN}');
    expect(SHEET).toContain('fall.value = withTiming(panelHeight');
  });

  it('es una hoja pegada a los tres bordes, sin margen exterior', () => {
    expect(SHEET).toContain("position: 'absolute'");
    expect(SHEET).toContain('left: 0');
    expect(SHEET).toContain('right: 0');
    expect(SHEET).toContain('bottom: 0');
    // Sólo las esquinas de arriba: las otras dos no se ven.
    expect(SHEET).toContain('borderTopLeftRadius');
    expect(SHEET).toContain('borderTopRightRadius');
    expect(SHEET).not.toMatch(/borderBottom(Left|Right)Radius/);
  });

  it('el PANEL es negro y opaco, no una superficie de cristal', () => {
    // El cristal es de los emblemas, que van dentro. Lo que no puede ser de
    // cristal es la hoja: eso la devolvería a ser una ventana flotante.
    const panel = SHEET.slice(SHEET.indexOf('  panel: {'), SHEET.indexOf('  emblem: {'));
    expect(SHEET).toContain('backgroundColor: theme.background');
    expect(panel).not.toContain('Glass');
    expect(SHEET).not.toMatch(/<GlassSurface[^>]*style={styles.panel/);
  });

  it('su alto lo decide una regla, no un número suelto', () => {
    expect(SHEET).toContain('sheetHeight(height)');
    expect(SHEET).toContain('height: panelHeight');
  });

  it('las dos tarjetas miden lo mismo y llevan icono a la izquierda', () => {
    const card = SHEET.slice(SHEET.indexOf('  card: {'));
    expect(card).toContain('flex: 1');
    expect(card).toContain("flexDirection: 'row'");
    expect(card).toContain("alignItems: 'center'");
    // El icono forma parte de la tarjeta y va ANTES del texto, no flotando.
    expect(SHEET.indexOf('<Icon name={Symbols[action.symbol]}')).toBeLessThan(
      SHEET.indexOf('<ThemedText variant="body"'),
    );
    expect(SHEET).toContain('size={EMBLEM_GLYPH}');
    expect(SHEET).toContain('colour={tint[action.key]}');
  });

  it('y se declara modal, para que no se alcance lo de detrás', () => {
    expect(SHEET).toContain('accessibilityViewIsModal');
    expect(TABS_LAYOUT).toContain("'no-hide-descendants'");
    expect(TABS_LAYOUT).toContain('backdrop.visible');
  });

  it('cierra al tocar fuera, y el velo cubre la pantalla entera', () => {
    expect(SHEET).toContain('style={StyleSheet.absoluteFill}');
    expect(SHEET).toContain("accessibilityLabel={t('action.close')}");
  });

  it('el botón Atrás de Android cierra igual, sin deshacer la ruta a medias', () => {
    expect(SHEET).toContain("BackHandler.addEventListener('hardwareBackPress'");
    expect(SHEET).toContain('return true;');
  });

  it('y dos cierres seguidos no deshacen dos veces la ruta', () => {
    // Sin esta guarda, un toque y el botón Atrás casi a la vez dejarían la pila
    // una pantalla más atrás de la cuenta.
    expect(SHEET).toContain('if (closing) return;');
    expect(SHEET).toContain('disabled={closing}');
  });

  it('respeta el área segura inferior en vez de un margen inventado', () => {
    expect(SHEET).toContain('insets.bottom');
    expect(SHEET).toContain('useSafeAreaInsets');
  });

  it('las tarjetas quedan por encima del velo, con el orden declarado', () => {
    // El `zIndex` se escribe en vez de confiar en el orden de los hermanos, que
    // un reordenamiento inocente invertiría sin cambiar nada del aspecto.
    expect(SHEET).toContain('zIndex: 1');
    // El panel ya no es una capa que deje pasar toques: es opaco y ocupa su
    // franja entera, así que lo de dentro lo recibe él y lo de fuera, el velo.
    expect(SHEET.indexOf('<Pressable')).toBeLessThan(SHEET.indexOf('<Animated.View'));
  });

  it('cada opción es un botón con su nombre accesible completo', () => {
    expect(SHEET).toContain('accessibilityRole="button"');
    expect(SHEET).toContain('accessibilityLabel={t(action.labelKey)}');
  });

  it('son dos tarjetas separadas, no una lista dentro de una ventana', () => {
    // La separación es lo que las hace dos tarjetas y no dos filas.
    expect(SHEET).toContain('gap: Spacing.md');
    // La hoja NOMBRA `SheetWindow` en sus comentarios para contrastar con ella;
    // lo que no puede es usarla, que la volvería una ventana centrada.
    expect(SHEET).not.toMatch(/import[^;]*SheetWindow/);
    expect(SHEET).not.toMatch(/<SheetWindow/);
  });
});

describe('las cadenas existen en los dos idiomas', () => {
  it('crear y unirse, con su texto', () => {
    expect(ES).toContain("'groups.createGroup': 'Crear grupo'");
    expect(ES).toContain("'groups.joinGroup': 'Únete a un grupo'");
    expect(EN).toContain("'groups.createGroup'");
    expect(EN).toContain("'groups.joinGroup'");
  });

  it('y sus descripciones, también en los dos', () => {
    expect(ES).toContain("'groups.createGroupDescription': 'Inicia un nuevo grupo.'");
    expect(ES).toContain("'groups.joinGroupDescription': 'Únete mediante un enlace o código QR.'");
    expect(EN).toContain("'groups.createGroupDescription'");
    expect(EN).toContain("'groups.joinGroupDescription'");
  });

  it('y NINGUNA de las dos frases está escrita en el componente', () => {
    // El defecto que impide: una cadena literal en el JSX se queda en español
    // para siempre y nadie se entera hasta que alguien cambia de idioma.
    expect(SHEET).not.toContain('Inicia un nuevo grupo');
    expect(SHEET).not.toContain('código QR');
    expect(SHEET).toContain('{t(action.descriptionKey)}');
  });
});

/**
 * LA COLUMNA DE TEXTO DE CADA TARJETA.
 *
 * Título arriba, descripción debajo, y el disco a su izquierda centrado sobre
 * el bloque entero. Lo que estas guardas fijan no es el aspecto sino CÓMO se
 * consigue: por composición —una fila que centra a sus hijos— y no colocando
 * nada a mano, que es lo que se rompe en cuanto una cadena cambia de largo o
 * alguien traduce la app.
 */
describe('la columna de título y descripción', () => {
  it('van en una columna, y en ese orden', () => {
    const columna = SHEET.slice(SHEET.indexOf('<View style={styles.copy}>'));
    expect(columna.indexOf('{t(action.labelKey)}')).toBeLessThan(
      columna.indexOf('{t(action.descriptionKey)}'),
    );
    // El disco queda FUERA de la columna: es hermano suyo, no su primera fila.
    expect(SHEET.indexOf('style={styles.emblem}')).toBeLessThan(
      SHEET.indexOf('<View style={styles.copy}>'),
    );
  });

  it('la descripción usa el secundario que ya existe, no uno nuevo', () => {
    expect(SHEET).toContain('variant="bodySmall"');
    expect(SHEET).toContain('themeColor="textSecondary"');
    // Y el título conserva el suyo: la jerarquía es tamaño y color, no peso.
    expect(SHEET).toContain('variant="body" themeColor="text"');
  });

  it('nada se coloca a mano: lo centra la fila', () => {
    /*
     * `alignItems: 'center'` en una fila centra a sus hijos entre sí, así que el
     * disco queda a la mitad del bloque de texto mida lo que mida. Un margen o
     * una posición absoluta darían el mismo resultado hoy y otro en cuanto una
     * traducción ocupara otra línea.
     */
    const card = SHEET.slice(SHEET.indexOf('  card: {'));
    expect(card).toContain("alignItems: 'center'");
    const columna = SHEET.slice(SHEET.indexOf('  copy: {'), SHEET.indexOf('  card: {'));
    expect(columna).not.toContain('marginTop');
    expect(columna).not.toContain('position');
    expect(columna).not.toContain('top:');
  });

  it('la descripción tiene ancho del que partir, y puede encoger', () => {
    // Sin `flex: 1` la columna se ajusta a su contenido y la frase larga empuja
    // hacia fuera de la tarjeta; sin `minWidth: 0` ese `flex` no baja del ancho
    // natural del texto y tampoco salta de línea.
    const columna = SHEET.slice(SHEET.indexOf('  copy: {'), SHEET.indexOf('  card: {'));
    expect(columna).toContain('flex: 1');
    expect(columna).toContain('minWidth: 0');
  });

  it('el hueco de la descripción sale del interlineado de su rol', () => {
    // Ni 40 escrito a mano ni un `height` fijo: si `bodySmall` cambia de
    // interlineado, el hueco lo sigue. Y es `minHeight`, así que una cadena que
    // no cupiera crecería en vez de recortarse.
    expect(SHEET).toContain('DESCRIPTION_LINES * (Typography.bodySmall.lineHeight ?? 0)');
    expect(SHEET).toContain('minHeight: DESCRIPTION_HEIGHT');
    expect(ACTIONS).toContain('export const DESCRIPTION_LINES = 2;');
  });

  it('y NO se recorta con puntos suspensivos', () => {
    // Se busca la PROP, no la palabra: la cabecera de la descripción nombra
    // `numberOfLines` justamente para explicar por qué no está.
    expect(SHEET).not.toMatch(/numberOfLines=/);
    expect(SHEET).not.toMatch(/ellipsizeMode=/);
  });

  it('la tarjeta sigue siendo un solo botón: nombre e indicación', () => {
    // El título es el nombre y la descripción la indicación. El sistema las
    // anuncia por separado; juntas en la etiqueta se leerían de corrido.
    expect(SHEET).toContain('accessibilityLabel={t(action.labelKey)}');
    expect(SHEET).toContain('accessibilityHint={t(action.descriptionKey)}');
    expect(SHEET.match(/<Pressable/g) ?? []).toHaveLength(2);
    // Y el disco sigue sin foco propio.
    const emblema = SHEET.slice(SHEET.indexOf('style={styles.emblem}'));
    expect(emblema).toContain('accessibilityElementsHidden');
  });
});

describe('los emblemas de las tarjetas', () => {
  it('son el material del `+`, no una copia de su estilo', () => {
    // `GlassSurface` con un nivel de `Glass`: el mismo cristal teñido, el mismo
    // canto y el mismo volumen que el botón del dock.
    expect(SHEET).toContain('<GlassSurface');
    expect(SHEET).toContain('level={glass[action.key]}');
    expect(SHEET).toContain("{ create: 'action', join: 'join' }");
    // Y NO se reutiliza el control de navegación, que trae gesto y ruta.
    expect(SHEET).not.toContain('AddButton');
    expect(SHEET).not.toContain('usePressScale');
  });

  it('los dos discos miden exactamente lo mismo', () => {
    // Una sola constante para los dos: dos números serían dos emblemas.
    expect(SHEET).toContain('const EMBLEM_SIZE = 50');
    expect(SHEET.match(/width: EMBLEM_SIZE/g) ?? []).toHaveLength(2);
    expect(SHEET.match(/height: EMBLEM_SIZE/g) ?? []).toHaveLength(2);
    expect(SHEET).toContain('radius={Radius.full}');
  });

  it('el glifo va centrado y a la mitad del disco, como en el ', () => {
    expect(SHEET).toContain('const EMBLEM_GLYPH = 25');
    expect(SHEET).toContain('size={EMBLEM_GLYPH}');
    expect(SHEET).toContain("alignItems: 'center'");
    expect(SHEET).toContain("justifyContent: 'center'");
  });

  it('son decorativos: la tarjeta entera sigue siendo el único botón', () => {
    const emblema = SHEET.slice(SHEET.indexOf('style={styles.emblem}'));
    expect(emblema).toContain('accessibilityElementsHidden');
    expect(emblema).toContain('importantForAccessibility="no-hide-descendants"');
    // Un solo pulsable por tarjeta: el emblema no es un `Pressable`.
    expect(SHEET.match(/<Pressable/g) ?? []).toHaveLength(2);
  });

  it('conservan la jerarquía cromática: ámbar para crear, lila para unirse', () => {
    expect(SHEET).toContain('{ create: theme.accent, join: theme.joinAccent }');
  });

  it('NO proyectan el halo del material, y el `+` del dock lo conserva', () => {
    /*
     * La lente de `action` mezcla brillos `inset` con una capa que sí sale del
     * contorno. Sobre el negro del dock ese halo es lo que hace que el `+` lea
     * como luz sostenida, y ahí está aprobado; dentro de una tarjeta no hay
     * fondo del que separarse y el disco se lee como una bombilla.
     *
     * `lens="inner"` filtra la lista que ya existe. Lo que esto fija es el
     * reparto: el emblema lo pide y el dock no. Que el filtro haga lo que dice
     * se interroga por comportamiento en `tests/lib/group-actions.test.ts`.
     */
    expect(SHEET).toContain('lens="inner"');
    /*
     * El `+` del dock lo elige por DESTINO: sin halo en Inicio, con halo en
     * Grupos, que es donde está aprobado. Lo que sigue prohibido es que se
     * decida por la ruta activa, que cambia en cuanto se abre una ventana.
     */
    expect(TAB_BAR).toContain("lens={destination === 'home' ? 'inner' : 'full'}");
    expect(TAB_BAR).toContain('const destination = destinationFor(activeRoute);');
  });

  it('y quitarlo es filtrar la lista que ya hay, no escribir otra lente', () => {
    /*
     * El corte es el mismo que `castsShadow` aplica a la lista del estado, y por
     * eso se reutiliza `innerHalf` / `outerHalf` en vez de una regla nueva. Si
     * alguien lo resolviera recortando el círculo o reescribiendo alfas, esto no
     * lo vería, pero tampoco pasaría por aquí: no habría filtro que leer.
     */
    expect(GLASS_IOS).toContain("mode === 'full' ? layers : innerHalf(layers)");
    expect(GLASS_ANDROID).toContain("modo === 'full' ? outerHalf(lens ?? []) : []");
    // El brillo interior de la lente NO pasa por el modo: sigue entrando entero.
    expect(GLASS_ANDROID).toContain('...innerHalf(lens ?? []),');
    // Y no se resuelve recortando: el emblema no enmascara ni cambia su radio.
    expect(SHEET).not.toContain('clip');
    expect(SHEET).not.toContain("overflow: 'hidden'");
  });

  it('y los dos emblemas lo piden a la vez, porque son un solo sitio', () => {
    // La equivalencia entre el ámbar y el lila no se sostiene repitiendo la
    // misma prop dos veces: se sostiene habiendo un solo `GlassSurface` que
    // recorre las dos acciones.
    expect(SHEET.match(/<GlassSurface/g) ?? []).toHaveLength(1);
    expect(SHEET.match(/lens="inner"/g) ?? []).toHaveLength(1);
    expect(SHEET).toContain('GROUP_ACTIONS.map');
  });
});

describe('el fondo se desenfoca de verdad', () => {
  it('hay un blur real, con su objetivo y su método de Android', () => {
    /*
     * Sin `blurTarget`, el método de Android avisa y degrada a `none`, que es un
     * relleno semitransparente: oscurecería sin desenfocar, que es justo lo que
     * no se quiere. Y sin `blurMethod` no llega a intentarlo.
     */
    expect(SCRIM).toContain('<BlurView');
    expect(SCRIM).toContain('blurTarget={target}');
    expect(SCRIM).toContain("'dimezisBlurViewSdk31Plus'");
  });

  it('hay DOS puntos medidos, y el de Personal es el de siempre', () => {
    /*
     * Una ventana centrada tapa casi toda la pantalla y otra deja dos tercios a
     * la vista: no piden el mismo desenfoque. Lo que esto fija es que separarlos
     * no haya movido el que ya estaba revisado — Personal sigue en 70 — y que el
     * de la hoja sea una constante con nombre y no un literal en la feature.
     */
    expect(SCRIM).toContain('export const BLUR_INTENSITY = 70;');
    expect(SCRIM).toContain('export const SHEET_BLUR_INTENSITY = 85;');
    expect(SCRIM).toContain('intensity = BLUR_INTENSITY,');
    expect(SCRIM).toContain('intensity={intensity}');
    // La banda acordada: fuera de ella deja de ser un ajuste y es otro diseño.
    const punto = /export const SHEET_BLUR_INTENSITY = ([0-9]+);/.exec(SCRIM);
    expect(Number(punto?.[1])).toBeGreaterThanOrEqual(80);
    expect(Number(punto?.[1])).toBeLessThanOrEqual(90);
  });

  it('y el punto viaja con la señal: la hoja lo pide, Personal no', () => {
    // Si la intensidad se quedara puesta al apagar, la siguiente ventana que
    // encendiera sin pedir nada heredaría la de la anterior.
    expect(TAB_BAR).toContain('backdrop.show(SHEET_BLUR_INTENSITY)');
    expect(TAB_BAR).toContain('backdrop.show();');
    expect(BACKDROP).toContain('setIntensity(undefined)');
    expect(BACKDROP).toContain('<Scrim target={target} intensity={intensity} />');
  });

  it('el efecto NO se hace subiendo un velo negro', () => {
    // El velo está para separar la ventana del fondo. Si subiera, volvería a
    // confundirse «oscurece» con «desenfoca», que es el defecto histórico.
    // Se lee el valor que se PINTA, no cualquier mención: la cabecera del
    // componente cita el 0.34 histórico para explicar por qué ya no está.
    const velo = /backgroundColor: 'rgba\(0, 0, 0, ([\d.]+)\)'/.exec(SCRIM);
    expect(velo).not.toBeNull();
    expect(Number(velo?.[1])).toBeLessThanOrEqual(0.15);
  });

  it('cubre la pantalla entera y el panel se queda fuera de él', () => {
    // El blur es hermano del panel, no su padre: la hoja no se desenfoca.
    expect(SCRIM).toContain("position: 'absolute'");
    expect(SHEET).not.toContain('Scrim');
    expect(SHEET).not.toContain('BlurView');
  });

  it('se enciende antes de navegar y se apaga al desmontarse la ventana', () => {
    // Coordinado con la entrada y retirado al terminar la salida: sin esto se
    // ve un fotograma del fondo nítido antes de cerrar.
    const press = TAB_BAR.slice(TAB_BAR.indexOf('onPress={() => {'));
    expect(press.indexOf('backdrop.show(SHEET_BLUR_INTENSITY)')).toBeLessThan(
      press.indexOf("router.push('/group-action')"),
    );
    expect(ROUTE).toContain('useEffect(() => hideBackdrop, [hideBackdrop])');
  });
});
