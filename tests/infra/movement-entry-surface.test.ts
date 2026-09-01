import { describe, expect, it } from 'vitest';

/**
 * La ventana del `+`, comprobada sobre el fuente.
 *
 * No hay biblioteca de test de componentes en el proyecto y no se añade una
 * para este bloque. Lo que aquí se afirma son propiedades **estructurales** —de
 * qué contrato sale cada campo, qué controles existen, qué no se inventa— que
 * un render tampoco demostraría mejor: una captura enseñaría píxeles, no que la
 * categoría desapareció del payload de un ingreso.
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

function file(relative: string): string {
  return FILES.find((candidate) => candidate.path === relative)?.text ?? '';
}

/** El fuente sin comentarios: aquí se afirma sobre el código, no sobre la prosa. */
function code(relative: string): string {
  return file(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const ADD = file('app/add.tsx');
/*
 * **La ventana se extrajo a `ui/components/sheet-window.tsx`.** La abrió esta
 * ruta, y ahora la comparten «Añadir movimiento», «Editar movimiento» y
 * «Editar disponible»: una sola implementación de la geometría, la animación y
 * el desplazamiento por teclado, que es lo que estas guardas protegen. La ruta
 * sigue siendo la dueña de su presentación transparente y de su fondo.
 */
const VENTANA = file('ui/components/sheet-window.tsx');
const VENTANA_CODE = code('ui/components/sheet-window.tsx');
/*
 * **Y el editor monetario a `features/personal/amount-field.tsx`.** Lo comparten
 * las tres superficies que piden una cifra; extraerlo es lo que evita un
 * segundo parser que se comporte distinto.
 */
const CAMPO = file('features/personal/amount-field.tsx');
/*
 * **La composición compartida por «Editar disponible» y «Editar movimiento».**
 * Compartir `SheetWindow` no las hacía iguales: el armazón era común y el
 * interior no. La fila del importe, el control de moneda, el aviso y el CTA
 * viven ahora en un solo sitio, y estas guardas lo comprueban ahí.
 */
const HOJA = code('features/personal/amount-sheet.tsx');
/*
 * **Corregir un movimiento es su propia pantalla**, no un modo del alta: las
 * dos hacen cosas distintas y comparten las PIEZAS —la composición, los
 * campos, el borrador y el writer—, no el componente.
 */
const EDICION = code('features/personal/movement-editor.tsx');
const MENU = code('features/personal/category-menu.tsx');
const MENU_IOS = code('features/personal/category-menu.ios.tsx');
const TRIGGER = code('features/personal/category-trigger.tsx');
const CAMPOS = code('features/personal/movement-fields.tsx');
const BORRADOR = code('features/personal/use-movement-draft.ts');
const FORM = file('features/personal/movement-form.tsx');
const SELECTOR = file('features/personal/entry-kind-selector.tsx');
const PICKERS = file('features/personal/entry-pickers.tsx');
const ENTRY = code('features/personal/movement-entry.ts');
const LAYOUT = file('app/_layout.tsx');

describe('la ventana se presenta sobre Inicio, no en lugar de Inicio', () => {
  /**
   * **La ventana ya no es una ruta, y ésa es la corrección.** Estaba en
   * `app/add.tsx` como `transparentModal`: iOS monta esa presentación en un
   * controlador aparte, así que el `BlurView` no tenía las pestañas en su
   * jerarquía visual y desenfocaba un fondo vacío. Se descartó antes que fuera
   * el servidor caducado — se reinició limpio y seguía negro.
   *
   * Ahora la monta el layout de las pestañas, hermana de `<Tabs>` y dibujada
   * después, o sea encima y en el MISMO árbol.
   */
  /**
   * **La ruta se declara transparente**, y es lo que mantiene Inicio montado
   * detrás en vez de sustituirlo.
   *
   * > Se intentó mover esto al árbol de las pestañas para que el `BlurView`
   * > tuviera Inicio en su jerarquía y el fondo se desenfocara de verdad. Rompió
   * > la composición —el lienzo es `flex: 1` y como hermano de `<Tabs>` quedaba
   * > maquetado debajo— y se revirtió. Queda anotado para que el próximo intento
   * > empiece por posicionar el lienzo en absoluto.
   */
  it('la ruta se declara transparente', () => {
    expect(file('app/_layout.tsx')).toContain("presentation: 'transparentModal'");
  });

  /**
   * **Y su CONTENIDO tambien, que no es lo mismo.** Las `screenOptions` del
   * Stack dan a toda pantalla un `contentStyle` con el negro del tema. Para las
   * demas esta bien; para una ventana que debe dejar ver lo de detras significa
   * pintarse encima un rectangulo negro completo — la presentacion era
   * transparente y el contenido no.
   *
   * Fue la causa de que el fondo se viera negro, y de que ninguna intensidad de
   * desenfoque cambiara nada: no habia nada que desenfocar.
   */
  it('y su contenido tambien, que es lo que dejaba ver Inicio', () => {
    const raiz = code('app/_layout.tsx');
    const desde = raiz.indexOf('name="add"');
    const bloque = raiz.slice(desde, raiz.indexOf('/>', desde));
    expect(bloque).toContain("contentStyle: { backgroundColor: 'transparent' }");
    // Y la excepcion es SOLO de esta pantalla: el resto conserva su fondo.
    expect(raiz).toContain('contentStyle: { backgroundColor: Colors.dark.background }');
  });

  /** El area fuera del panel no pinta nada: ni tema, ni vidrio, ni negro. */
  it('la ventana no pinta ningun fondo a pantalla completa', () => {
    expect(VENTANA_CODE).not.toContain('backgroundColor');
  });

  /**
   * El velo pinta SIEMPRE y el desenfoque nativo se superpone sólo cuando va a
   * hacer algo. `expo-glass-effect` no degrada, desaparece: confiar en él
   * dejaría Inicio legible y a foco completo detrás de la ventana en Android y
   * en iOS anterior a 26.
   */
  /**
   * **El desenfoque es lo principal y la atenuación lo secundario**, en ese
   * orden. Antes era al revés y por eso el fondo salía negro: sólo había velo,
   * porque `expo-glass-effect` no desenfoca salvo con Liquid Glass.
   */
  it('el fondo desenfoca, y sólo atenúa un poco por encima', () => {
    const scrim = code('ui/components/scrim.tsx');
    expect(scrim).not.toContain('useNativeGlass');
    expect(scrim).not.toContain('expo-glass-effect');
    expect(scrim.indexOf('<BlurView')).toBeLessThan(scrim.indexOf('styles.veil'));
  });

  it('queda un borde por el que se ve lo de detrás', () => {
    // La ventana ya no es un `flex` con márgenes: es una caja de tamaño
    // explícito, y el borde es lo que sobra al centrarla. Lo que hay que fijar
    // es que ese tamaño salga SIEMPRE menor que la pantalla.
    expect(VENTANA).toContain('const referenceHeight =');
    expect(VENTANA).toContain('const panelWidth =');
    expect(VENTANA).toContain('height * 0.1');
    expect(VENTANA).toContain('width - width * 0.06');
  });

  it('tocar fuera cierra, y la X también', () => {
    expect(VENTANA).not.toContain('<Scrim />');
    expect(VENTANA_CODE).toContain('name="xmark"');
    // Una sola salida, y pasa por la animación: deshacer la ruta es lo que
    // hace `useSlideDown` cuando la hoja termina de bajar, no cada control por
    // su cuenta.
    expect(VENTANA_CODE.match(/onPress=\{close\}/g) ?? []).toHaveLength(2);
    expect(VENTANA_CODE).toContain('runOnJS(done)()');
  });

  /**
   * La ruta hace el velo y la ventana sube por su cuenta. Con
   * `slide_from_bottom` en la ruta subiría también el velo, y durante la
   * transición se vería su canto cruzando la pantalla con la mitad de Inicio
   * sin atenuar.
   */
  it('la ventana entra desde abajo, y el velo no viaja con ella', () => {
    expect(VENTANA).toContain('entering={SLIDE_IN}');
    expect(file('app/_layout.tsx')).toContain("animation: 'fade'");
    expect(file('app/_layout.tsx')).not.toContain('slide_from_bottom');
  });

  /** Y al cerrar baja antes de deshacer la ruta, o no habría nada que animar. */
  it('y al cerrar baja antes de desmontarse', () => {
    expect(VENTANA).toContain('withTiming(screenHeight');
    expect(VENTANA).toContain('if (finished) runOnJS(done)()');
  });

  /**
   * El fondo tiene que dejar reconocer Inicio. Al 62 % era un negro cualquiera,
   * y entonces presentar por encima no aporta nada sobre presentar a pantalla
   * completa.
   */
  it('el velo deja ver la pantalla de debajo', () => {
    const alpha = /rgba\(0, 0, 0, ([\d.]+)\)/.exec(file('ui/components/scrim.tsx'));
    expect(alpha).not.toBeNull();
    expect(Number((alpha as RegExpExecArray)[1])).toBeLessThanOrEqual(0.4);
  });
});

describe('el selector de clase', () => {
  it('ofrece las tres, y abre en gasto', () => {
    expect(ENTRY).toContain("['expense', 'income', 'transfer']");
    expect(ENTRY).toContain("INITIAL_ENTRY_KIND: EntryKind = 'expense'");
  });

  /**
   * **El color nunca es la única señal.** Cada segmento lleva su glifo, el
   * elegido crece, y el estado se anuncia a la tecnología asistiva.
   * `design-direction.md` §8 lo exige, y el par rojo/verde es el peor posible
   * para no cumplirlo.
   */
  it('el estado no depende sólo del color', () => {
    expect(SELECTOR).toContain('accessibilityState={{ selected: active, disabled }}');
    expect(SELECTOR).toContain('scale:');
    expect(SELECTOR).toContain('GLYPH[kind]');
  });

  /**
   * El indicador es RELLENO, no vidrio. A través de una superficie translúcida
   * el tono se leía lavado: decía «hay algo elegido» pero no con la firmeza del
   * CTA. Que vuelva a ser vidrio es una regresión visual silenciosa, así que se
   * afirma la forma que lo impide.
   */
  it('el elegido lleva relleno sólido, no una superficie translúcida', () => {
    expect(SELECTOR).toContain('backgroundColor: tone[value]');
    // La pista sigue siendo vidrio; el indicador ya no.
    expect(code('features/personal/entry-kind-selector.tsx')).not.toMatch(
      /<GlassSurface[^>]*styles\.indicator/s,
    );
  });

  /**
   * Y sobre ese relleno el glifo se invierte. Medido: negro da 7.1:1 (rojo),
   * 10.0:1 (verde) y 7.9:1 (azul); en blanco habría dado 2.0–2.8 y ninguno
   * pasaría. Es la misma relación que el botón principal.
   */
  it('sobre el relleno el glifo se invierte a negro', () => {
    expect(SELECTOR).toContain('theme.onAccent');
  });

  it('las tres tienen nombre accesible, del catálogo', () => {
    for (const key of ['entry.kindExpense', 'entry.kindIncome', 'entry.kindTransfer']) {
      expect(SELECTOR, key).toContain(key);
    }
  });

  it('el azul es un token medido, no un literal suelto', () => {
    expect(SELECTOR).toContain('theme.neutralFlow');
    expect(code('features/personal/entry-kind-selector.tsx')).not.toMatch(/#[0-9A-Fa-f]{6}/);
  });
});

describe('el acabado de la ventana', () => {
  /**
   * El brillo del canto se pila en las esquinas de una forma redondeada: un
   * desplazamiento de un punto sin desenfoque toca la curva en tangente en las
   * puntas y allí se acumula. En un oblongo son dos destellos. `rim` es lo que
   * lo reparte, y esto afirma que los oblongos grandes lo usan.
   */
  it('los oblongos grandes no llevan el brillo duro del canto', () => {
    expect(CAMPOS).toContain('rim="soft"');
    expect(HOJA).toContain('rim="none"');
    expect(SELECTOR).toContain('rim="soft"');
    expect(VENTANA).toContain('rim="soft"');
  });

  it('y el sistema sigue trayendo el canto duro por defecto', () => {
    // Cambiarlo aquí repintaría el dock y las tarjetas de Inicio, que no
    // entran en esta pasada.
    expect(file('ui/components/glass-surface.tsx')).toContain("rim = 'catch'");
  });

  /**
   * **La ventana es la pantalla en pequeño.** El ancho se deriva de la altura
   * por la proporción del aparato, en vez de ser otro margen: con márgenes
   * independientes en cada eje la pieza salía o estrecha o ancha según el
   * teléfono, porque el 5 % del alto son más del doble de puntos que el 5 % del
   * ancho.
   */
  it('el ancho sale de la altura de referencia por la proporción de la pantalla', () => {
    expect(VENTANA).toContain('referenceHeight * (width / height)');
  });

  /**
   * **La altura la pone el contenido, no una fracción de la pantalla.** Con una
   * fracción, el hueco sobrante no dependía de lo que hay dentro y crecía con
   * el aparato: 190 puntos muertos en un 14 Pro y 262 en un 15 Pro Max, entre
   * el último campo y `Guardar`.
   *
   * `referenceHeight` sobrevive como TOPE —para que en una pantalla pequeña no
   * se salga del área segura— y como origen del ancho, que está aprobado y no
   * se mueve. Lo que desaparece es su uso como altura fija.
   */
  it('la ventana mide lo que mide su contenido, con un tope', () => {
    expect(VENTANA).toContain('maxHeight: referenceHeight');
    expect(VENTANA).not.toMatch(/size = \{ width: panelWidth, height:/);

    // Sobre el CÓDIGO, no sobre la prosa: las notas de esos estilos explican
    // por qué se retiró el estiramiento, y la explicación no es el defecto.
    const codigo = VENTANA_CODE;
    const ventana = code('ui/components/sheet-window.tsx');
    expect(/pane: \{([^}]*)\}/.exec(ventana)?.[1]).not.toContain('flex: 1');
    expect(/body: \{([^}]*)\}/.exec(ventana)?.[1]).not.toContain('flex: 1');
  });

  /** Y `Guardar` se separa con una distancia declarada, no empujado al canto. */
  it('Guardar se separa por spacing, no por un empuje al fondo', () => {
    const codigo = code('features/personal/amount-sheet.tsx');
    expect(codigo).not.toContain("marginTop: 'auto'");
    expect(/footer: \{([^}]*)\}/.exec(codigo)?.[1]).toContain('paddingTop: Spacing.xl');
    expect(/sheet: \{([^}]*)\}/.exec(codigo)?.[1]).not.toContain('flex: 1');
  });

  /**
   * **Y se centra en el viewport, no dentro de una pila de contenedores.**
   * Antes era `flex: 1` con márgenes dentro de un `SafeAreaView` dentro de un
   * `KeyboardAvoidingView`, y el resultado dependía de qué insets reportara cada
   * uno — que en un iPhone no son simétricos—. La pieza quedaba centrada
   * respecto a su caja y descentrada respecto a la pantalla.
   */
  it('y la ventana se centra en el lienzo, que ocupa la pantalla', () => {
    expect(VENTANA).toContain("alignItems: 'center'");
    expect(VENTANA).toContain("justifyContent: 'center'");
    expect(VENTANA).not.toContain('<SafeAreaView');
  });

  /** La altura sigue descontando las áreas seguras: no se mete bajo el notch. */
  it('la altura descuenta las áreas seguras', () => {
    expect(VENTANA).toContain('useSafeAreaInsets()');
    expect(VENTANA).toContain('insets.top - insets.bottom');
  });

  /**
   * Los márgenes en porcentaje de React Native se resuelven contra el ANCHO en
   * los dos ejes, así que `marginVertical: '5%'` habría dado otra vez el margen
   * horizontal. Por eso se calculan y no se declaran.
   */
  it('y no con porcentajes, que en React Native miden el ancho en los dos ejes', () => {
    expect(VENTANA_CODE).not.toMatch(/margin\w*:\s*'\d+%'/);
  });

  it('la X es un glifo suelto, sin superficie alrededor', () => {
    expect(VENTANA).toContain('<IconButton');
    expect(VENTANA_CODE).not.toContain('GlassPressable');
    // `IconButton` sin `filled` no pinta contenedor en reposo.
    expect(VENTANA_CODE).not.toContain('filled');
  });

  it('el título va centrado y en el registro secundario', () => {
    expect(VENTANA).toContain('variant="label"');
    expect(VENTANA).toContain('themeColor="textSecondary"');
    expect(VENTANA).toContain("textAlign: 'center'");
  });

  /**
   * `Guardar` abajo del todo: el contenido crece hasta la altura de la ventana
   * y el pie se empuja al fondo. Sin `flexGrow` el contenido mide lo que mide y
   * `marginTop: 'auto'` no tiene hueco que repartir.
   */
  /**
   * **Y no por un empuje.** Esta guarda afirmaba lo contrario —que el CTA
   * llevaba `marginTop: 'auto'`— y pasaba sobre el COMENTARIO que explica por
   * qué se retiró, no sobre el código. La ventana mide lo que mide su
   * contenido, así que no hay hueco que repartir: el botón se separa con una
   * distancia declarada.
   */
  it('Guardar queda al fondo de la ventana', () => {
    expect(VENTANA).toContain('flex: 1');
    expect(HOJA).toContain('paddingTop: Spacing.xl');
    expect(HOJA).not.toContain("marginTop: 'auto'");
  });

  it('y es amarillo con el texto en negro', () => {
    expect(HOJA).toContain('theme.accent');
    expect(HOJA).toContain('theme.onAccent');
  });

  it('el símbolo de moneda va después del importe', () => {
    const cuerpo = code('features/personal/amount-sheet.tsx');
    const importe = cuerpo.indexOf('<AmountField');
    const moneda = cuerpo.indexOf("t('entry.currencyLabel'");
    expect(importe).toBeGreaterThan(-1);
    expect(moneda).toBeGreaterThan(importe);
  });
});

describe('la transferencia se ofrece y no se inventa', () => {
  /**
   * Las dos funciones de `api` que se llaman transferencia no sirven aquí, y
   * la razón vive en el código: `record_internal_transfer` exige dos ámbitos
   * distintos y en la Fase 6 hay uno solo; `record_external_transfer` no
   * admite concepto ni hora.
   */
  it('no hay ninguna llamada de transferencia en el cliente', () => {
    // Sobre el CODIGO, no sobre la prosa: `movement-entry.ts` explica por
    // extenso por que esas dos funciones no sirven aqui, y la explicacion no
    // es el defecto.
    // `types/database.ts` queda fuera: se genera sobre `api` y LISTA las ocho
    // funciones existan o no se llamen. Excluirlo no debilita nada — lo que se
    // vigila es que nadie las invoque.
    const cliente = FILES.filter((candidate) => candidate.path !== 'types/database.ts');
    expect(cliente.length).toBe(FILES.length - 1);

    for (const source of cliente) {
      expect(code(source.path), source.path).not.toContain('record_internal_transfer');
      expect(code(source.path), source.path).not.toContain('record_external_transfer');
    }
  });

  it('elegirla bloquea el guardado, esté como esté el formulario', () => {
    expect(ENTRY).toContain("if (!canRecord(draft.kind)) return 'noRoute'");
  });

  it('y la pantalla lo dice en vez de fallar al pulsar', () => {
    expect(code('features/personal/movement-blocker.ts')).toContain(
      "noRoute: 'entry.transferSoon'",
    );
  });
});

describe('la categoría es del gasto, y en el ingreso no está', () => {
  /**
   * **Desaparece; no se desactiva.** Un control gris afirmaría «esto existe
   * para los ingresos y ahora no se puede», y lo cierto es lo contrario:
   * `category_id` no es un campo admisible de esa clase y mandarlo se rechaza
   * por FORMA del payload (ADR-027 §3).
   */
  it('el círculo sólo se monta cuando la clase lo usa', () => {
    expect(CAMPOS).toContain('{usesCategory(kind) ? (');
    expect(code('features/personal/movement-form.tsx')).not.toMatch(/disabled=\{[^}]*usesCategory/);
  });

  it('cambiar a ingreso suelta la categoría elegida', () => {
    expect(BORRADOR).toContain('if (!usesCategory(next)) setCategoryId(null)');
  });

  it('y el payload de un ingreso no la lleva ni vacía', () => {
    expect(ENTRY).toContain('usesCategory(draft.kind) && draft.categoryId !== null');
  });

  /**
   * El selector ofrece sólo lo vigente. `api.category` publica también las
   * dadas de baja —el histórico las necesita— y filtrar es de quien pinta un
   * selector, nunca de la vista (ADR-021 §7).
   */
  it('sólo se ofrecen categorías vigentes', () => {
    expect(code('features/personal/use-entry-categories.ts')).toContain('row.is_active');
  });
});

describe('los selectores son los del sistema', () => {
  it('categoría y fecha salen de @expo/ui, sin dependencia nueva', () => {
    expect(MENU).toContain("from '@expo/ui/community/menu'");
    expect(PICKERS).toContain("from '@expo/ui/community/datetime-picker'");
  });

  it('no hay un calendario ni una lista redibujados a mano', () => {
    expect(PICKERS).not.toContain('FlatList');
    expect(PICKERS).not.toContain('lastDayOfMonth');
  });

  /**
   * **La ventana es fija.** El `ScrollView` venía de cuando el panel no tenía
   * altura propia; ahora mide lo que mide y el formulario cabe, así que una
   * superficie desplazable no protegía de nada — sólo dejaba arrastrar una
   * pantalla que no se mueve, que se lee como que algo va mal.
   *
   * Se comprueba la AUSENCIA del componente, no que esté desactivado: un
   * `scrollEnabled={false}` deja el gesto ahí para que alguien lo reactive.
   */
  it('no queda ninguna superficie desplazable en la ventana', () => {
    for (const path of [
      'app/add.tsx',
      'features/personal/movement-form.tsx',
      'features/personal/entry-kind-selector.tsx',
    ]) {
      for (const desplazable of ['ScrollView', 'FlatList', 'SectionList', 'scrollEnabled']) {
        expect(code(path), `${path} · ${desplazable}`).not.toContain(desplazable);
      }
    }
  });

  /**
   * Lo que el `ScrollView` SÍ aportaba y había que conservar: tocar fuera de un
   * campo cierra el teclado. El importe usa teclado numérico, que no trae tecla
   * de retorno, así que sin esto la pantalla se quedaba encallada.
   */
  it('pero tocar fuera de un campo sigue cerrando el teclado', () => {
    expect(VENTANA).toContain('onPress={Keyboard.dismiss}');
  });

  /**
   * **El fondo desenfoca de verdad, y eso es una dependencia, no un estilo.**
   * Antes el velo era lo unico que habia: `expo-glass-effect` no desenfoca
   * salvo con Liquid Glass —su comprobacion generica es `return false`—, asi
   * que el fondo salia negro en vez de desenfocado.
   */
  it('el fondo lo desenfoca un BlurView real, no una opacidad', () => {
    const scrim = code('ui/components/scrim.tsx');
    expect(scrim).toContain("from 'expo-blur'");
    expect(scrim).toContain('<BlurView');
    expect(scrim).toContain('intensity={70}');
    // Y Android no se queda con el relleno semitransparente por defecto.
    expect(scrim).toContain('dimezisBlurViewSdk31Plus');
  });

  /** La atenuacion es secundaria: si subiera, se comeria el desenfoque. */
  it('y la atenuación es secundaria al desenfoque', () => {
    const alpha = /rgba\(0, 0, 0, ([0-9.]+)\)/.exec(code('ui/components/scrim.tsx'));
    expect(alpha).not.toBeNull();
    // Si subiera, se comería el desenfoque y volveríamos al fondo negro.
    expect(Number((alpha as RegExpExecArray)[1])).toBeLessThanOrEqual(0.15);
  });

  /**
   * **El desenfoque no envuelve a la ventana.** El velo es hermano del panel,
   * no su padre, asi que el modal queda nitido: texto, cifra y controles.
   */
  /**
   * **EL FONDO VIVE EN EL ÁRBOL DE LAS PESTAÑAS, LA VENTANA NO.**
   *
   * El desenfoque necesita tener Inicio en su misma jerarquía visual para
   * emborronarlo, y dentro de la ruta `/add` no lo tiene: iOS monta un
   * `transparentModal` en un controlador aparte, así que allí desenfoca un
   * fondo vacío y se ve negro. Se muda el fondo, y SÓLO el fondo.
   */
  it('el fondo lo dibujan las pestañas, no la ruta de la ventana', () => {
    expect(code('app/(tabs)/_layout.tsx')).toContain('<AddBackdrop />');
    expect(code('features/shell/add-backdrop.tsx')).toContain('<Scrim />');
    expect(ADD).not.toContain('Scrim');
  });

  /**
   * **Y va en absoluto, que es la lección del intento que se revirtió.**
   * Aquella vez se colgó la ventana entera de un `<View style={{ flex: 1 }}>`
   * hermano de `<Tabs>`: como competía por el espacio, dejó las pestañas
   * empujadas y la ventana caída con media pantalla de Inicio a la vista.
   *
   * Un fondo posicionado en absoluto no participa en el reparto: las pestañas
   * miden lo mismo esté puesto o no.
   */
  it('el fondo es absoluto y no participa en el layout', () => {
    const backdrop = code('features/shell/add-backdrop.tsx');
    expect(backdrop).toContain('StyleSheet.absoluteFill');
    expect(backdrop).not.toContain('flex: 1');

    // Y el layout de las pestañas no envuelve nada en una caja con flex.
    expect(code('app/(tabs)/_layout.tsx')).not.toContain('style={{ flex: 1 }}');
  });

  /** La ventana NUNCA vuelve a montarse dentro de las pestañas. */
  it('la ventana sigue siendo su propia ruta, no un hijo de las pestañas', () => {
    const layout = code('app/(tabs)/_layout.tsx');
    for (const prohibido of ['AddScreen', 'MovementEntryPanel', 'MovementForm']) {
      expect(layout, prohibido).not.toContain(prohibido);
    }
    expect(code('app/_layout.tsx')).toContain('name="add"');
  });

  /** El fondo tapa Inicio para los toques; la ventana, encima, los recibe. */
  it('con el fondo puesto no se puede pulsar lo que hay debajo', () => {
    const backdrop = code('features/shell/add-backdrop.tsx');
    // La vista exterior NO renuncia a los toques; el velo decorativo sí.
    expect(backdrop).not.toContain('pointerEvents="none"');
    expect(code('ui/components/scrim.tsx')).toContain('pointerEvents="none"');
  });

  /** Se enciende antes de navegar y se apaga al desmontarse la ruta. */
  it('se enciende antes de abrir y se apaga cuando la ruta se va', () => {
    const dock = code('features/shell/nomey-tab-bar.tsx');
    expect(dock.indexOf('backdrop.show()')).toBeLessThan(dock.indexOf('router.push'));
    // Al desmontarse, no al pulsar cerrar: durante la salida el desenfoque
    // sigue puesto, y así no se ve un fotograma de Inicio nítido.
    expect(ADD).toContain('useEffect(() => hideBackdrop, [hideBackdrop])');
  });

  /**
   * La ventana sube con el teclado, y lo hace con DOS valores compartidos que
   * se suman. Con uno solo, cerrar mientras el teclado esta abierto dejaria uno
   * de los dos desplazamientos a medias; separados, volver a cero es volver
   * exactamente a la base por muchas veces que se abra y se cierre.
   */
  it('el teclado desplaza la ventana, sin encogerla', () => {
    expect(VENTANA).toContain('keyboardWillShow');
    expect(VENTANA).toContain('keyboardDidShow');
    expect(VENTANA).toContain('fall.value + lift.value');
    // Y el alto sale de una medida real, no de una tabla por modelo.
    expect(VENTANA).toContain('event.endCoordinates.height');
    expect(VENTANA).toContain('onLayout={onPanelLayout}');
  });

  it('al cerrarse vuelve a cero exacto, no a una resta', () => {
    expect(VENTANA).toContain('lift.value = withTiming(0,');
  });

  /** Y sigue sin haber forma de arrastrarlo a mano. */
  it('el desplazamiento por teclado no reintrodujo scroll', () => {
    for (const desplazable of ['ScrollView', 'FlatList', 'scrollEnabled', 'KeyboardAvoidingView']) {
      expect(VENTANA_CODE, desplazable).not.toContain(desplazable);
    }
  });

  /** La fecha ya no se anuncia con texto; el dato sigue en el estado. */
  it('«Hoy» ya no se pinta, pero la fecha sigue viajando', () => {
    expect(FORM).not.toContain('entry.dateToday');
    expect(BORRADOR).toContain('todayInDeviceCalendar()');
    expect(CAMPOS).toContain('value={draft.date}');
  });

  /**
   * **El menú devuelve el IDENTIFICADOR, no una posición.** La rueda que hubo
   * antes era un control de índice y el UUID se resolvía por orden, así que
   * reordenar el catálogo elegía otra categoría. `MenuAction.id` vuelve tal
   * cual se mandó.
   */
  it('el menú devuelve el identificador y no una posición', () => {
    expect(MENU).toContain('id: option.id');
    expect(MENU).toContain('onSelect(nativeEvent.event)');
    expect(MENU).not.toContain('Number(value)');
    expect(MENU).not.toContain('findIndex');
  });

  /**
   * **La causa de que antes no abrieran, protegida.** El `BottomSheet` de
   * `@expo/ui` monta su propio `Host` y envuelve a sus hijos en un `Group` de
   * SwiftUI, así que lo que recibe se renderiza DENTRO de SwiftUI. Se le
   * estaban dando vistas de React Native, que allí no pueden existir: la hoja
   * se quedaba sin nada que presentar y no abría, sin lanzar ningún error.
   */
  /**
   * **El glifo de traslado es un símbolo, no el carácter `⇄`.** Un texto se
   * centra por su caja de línea y la tinta de ese carácter no está en el centro
   * de la suya —las flechas se dibujan alrededor del eje matemático de la
   * fuente, por encima de la mitad—, así que ningún `alignItems` lo bajaba: se
   * estaba centrando bien una caja cuyo contenido está alto.
   */
  it('el traslado se dibuja con un símbolo, no con un carácter', () => {
    expect(code('features/personal/entry-kind-selector.tsx')).not.toContain('⇄');
    expect(SELECTOR).toContain("ios: 'arrow.left.arrow.right'");
  });

  /**
   * Y los TRES con pareja de plataforma. Una cadena suelta es un nombre de SF
   * Symbol: fuera de iOS `Icon` cae en su recuadro de respaldo, así que dejar
   * dos sin pareja habría puesto en Android dos huecos y una flecha. Es el
   * mismo defecto que ADR-027 corrigió en las categorías.
   */
  it('y los tres glifos llevan su pareja iOS/Android', () => {
    for (const android of ['remove', 'add', 'swap_horiz']) {
      expect(SELECTOR, android).toContain(`android: '${android}'`);
    }
    // Ninguno con el mismo tamaño distinto: los tres se piden a 22.
    expect(SELECTOR).toContain('size={22}');
  });

  it('no se presentan con el BottomSheet de @expo/ui', () => {
    expect(code('features/personal/entry-pickers.tsx')).not.toContain('BottomSheet');
  });

  it('sino con el Modal del núcleo, que acepta vistas de React Native', () => {
    expect(PICKERS).toContain('<Modal');
    expect(PICKERS).toContain('animationType="slide"');
  });

  /** Y el control de dentro sigue siendo el nativo: trae su propio `Host`. */
  it('y los controles de dentro siguen siendo los del sistema', () => {
    expect(PICKERS).toContain('<DateTimePicker');
  });
});

/**
 * LA CATEGORÍA SE ELIGE EN EL MENÚ NATIVO DE LA PLATAFORMA.
 *
 * `MenuView` monta un `Menu` de SwiftUI en iOS y un `DropdownMenu` de Compose
 * en Android. Antes había una rueda dentro de un `Modal` propio: media pantalla
 * subiendo desde abajo para elegir entre diez cosas, y sin parecerse a nada del
 * sistema.
 */
describe('la categoría se elige en el menú nativo', () => {
  it('es el menú del sistema, no una copia', () => {
    expect(MENU).toContain('<MenuView');
    // Ni hoja, ni modal, ni tira horizontal, ni animación de JavaScript.
    for (const imitacion of [
      'Modal',
      'BottomSheet',
      'ScrollView',
      'FlatList',
      'Animated',
      'withTiming',
    ]) {
      expect(MENU, imitacion).not.toContain(imitacion);
    }
  });

  /**
   * **Se abre con un toque.** `shouldOpenOnLongPress` por defecto es `false` en
   * la versión instalada, así que ponerlo sería pedir lo contrario.
   */
  it('se abre con un toque y no con una pulsación larga', () => {
    expect(MENU).not.toContain('shouldOpenOnLongPress');
  });

  /**
   * **Anclado, y sin decirle hacia dónde.** Es iOS quien decide arriba o abajo
   * según el hueco. Forzarlo sería volver a construir la presentación a mano.
   */
  it('no se le fuerza la dirección ni la posición', () => {
    for (const forzado of ['anchor', 'placement', 'direction', 'position:']) {
      expect(MENU, forzado).not.toContain(forzado);
    }
  });

  /** Una lista PLANA: sin submenús ni secciones. */
  it('es una lista plana, sin submenús', () => {
    expect(MENU).not.toContain('subactions');
    expect(MENU).not.toContain('displayInline');
  });

  /** El check es el nativo, que es además lo que lee VoiceOver. */
  it('la seleccionada se marca con el estado nativo, no con un color', () => {
    expect(MENU).toContain("state: option.selected ? 'on' : 'off'");
  });

  /**
   * **El icono sólo viaja en iOS.** `MenuAction.image` admite un nombre de SF
   * Symbol —que sólo pinta iOS— o un recurso de dibujo, que sólo pinta Android.
   * Nomey tiene lo primero y no lo segundo, así que en Android el menú va con
   * texto en vez de con un icono roto.
   */
  it('el icono se manda sólo donde la API lo admite', () => {
    // Android no tiene nada admisible que mandar: no un recurso de dibujo, que
    // es lo único que pinta ahí. Así que no se manda nada.
    expect(MENU).not.toContain('image:');
    // Y en iOS sí, porque allí el símbolo lo dibuja SwiftUI.
    expect(MENU_IOS).toContain('systemImage={categorySymbol(option.icon).ios}');
  });

  /** El trigger es el botón de siempre, y anuncia la categoría vigente. */
  it('el trigger es el botón de antes y anuncia lo elegido', () => {
    expect(CAMPOS).toContain('<CategoryMenu');
    expect(TRIGGER).toContain('level="regular"');
    expect(TRIGGER).toContain('depth="well"');
    expect(TRIGGER).toContain('rim="catch"');
    expect(CAMPOS).toContain("t('entry.categoryChosen'");
    expect(MENU).toContain('accessibilityRole="button"');
    expect(MENU).toContain('accessibilityLabel={label}');
  });

  /**
   * **EL ENVOLTORIO DEL MENÚ NO PINTA NADA.**
   *
   * La sombra pertenece a la superficie que tiene la geometría real —el círculo
   * de cristal—, nunca a la caja del trigger. Una sombra puesta aquí sería
   * rectangular por construcción: ésta es la caja, no el círculo.
   */

  it('el trigger de categoría lleva el relieve de los controles', () => {
    expect(CAMPOS).toContain('nativeEffect={false}');
  });
});

/**
 * EN iOS EL MENÚ ES SWIFTUI DE PRINCIPIO A FIN.
 *
 * La documentación de Expo lo dice sin rodeos: no dar un cristal a la etiqueta
 * del `Menu` —hace aparecer un halo rectangular al cerrar— y usar `buttonStyle`
 * sobre el propio `Menu`, que sí se integra con su animación de cierre. Es lo
 * mismo que registra expo/expo#44126.
 *
 * Android se queda con `MenuView`: su `DropdownMenu` de Compose funciona y no
 * tiene este problema.
 */
describe('el menú de categorías en iOS', () => {
  it('lo monta SwiftUI, no una vista alojada', () => {
    expect(MENU_IOS).toContain("from '@expo/ui/swift-ui'");
    expect(MENU_IOS).toContain('<Host');
    expect(MENU_IOS).toContain('<Menu');
  });

  /**
   * **NADA VISIBLE ENTRA EN EL ÁRBOL DEL `Menu`.** La etiqueta es una vista
   * vacía con su tamaño y su forma táctil declarados; el círculo se pinta
   * fuera. Al recomponer su etiqueta al cerrar, SwiftUI no tiene nada que
   * alterar.
   *
   * Medido antes: el círculo como etiqueta directa dejaba la placa
   * rectangular, y alojarlo con `RNHostView` también — la vista de React
   * Native se recompone igual.
   */
  it('la etiqueta es el círculo, para que el menú nazca de él', () => {
    expect(MENU_IOS).toContain('<RNHostView matchContents>');
    expect(MENU_IOS).toContain('<CategoryTrigger icon={icon} chosen={chosen} size={size}');
    // Una etiqueta vacía quitaba el artefacto pero el menú salía despegado:
    // SwiftUI transforma lo que ve, y no veía la forma.
    expect(MENU_IOS).not.toContain('<Spacer');
  });

  /**
   * **La capa visual va FUERA del `Host`**, no recibe toques y no se anuncia:
   * un solo elemento accesible, y ningún gesto que disputarle al menú.
   */
  it('sólo la sombra exterior queda fuera del Host', () => {
    // Hermana estable y anterior al menú, y sin nada que pintar salvo la
    // mitad exterior del token: ni fondo, ni borde, ni un segundo círculo.
    expect(MENU_IOS.indexOf("castShadow('well')")).toBeLessThan(MENU_IOS.indexOf('<Host'));
    expect(MENU_IOS).toContain('pointerEvents="none"');
    expect(MENU_IOS).toContain('accessibilityElementsHidden');
    expect(MENU_IOS).toContain('importantForAccessibility="no-hide-descendants"');
    expect(MENU_IOS).not.toContain('backgroundColor');
    expect(MENU_IOS).not.toContain('borderWidth');
  });

  /**
   * **Y la etiqueta se queda sin esa mitad, no sin relieve.** Las dos son
   * entradas distintas del mismo token, así que repartirlas es filtrarlas.
   */
  it('la etiqueta conserva el relieve interior y cede la sombra', () => {
    expect(MENU_IOS).toContain('castsShadow={false}');
    expect(TRIGGER).toContain('castsShadow={castsShadow}');

    const superficie = code('ui/components/glass-surface.tsx');
    expect(superficie).toContain('castsShadow = true');
    expect(superficie).toContain('casts ? Tactile[depth] : innerShading(depth)');

    // Las dos mitades salen del MISMO token, filtrado — nunca reescrito.
    const tokens = code('ui/theme/elevation.ts');
    expect(tokens).toContain('layers.filter((layer) => layer.inset !== true)');
    expect(tokens).toContain('layers.filter((layer) => layer.inset === true)');
  });

  /**
   * **Y el trigger se REUTILIZA, no se reescribe.** Llega por `children`, es el
   * mismo elemento que monta Android y sale de un único sitio. Reproducir sus
   * tokens en SwiftUI además no se podría: `shadow()` es sólo exterior y las
   * dos capas que dan el relieve —el rim y el sombreado de `Tactile.well`— son
   * interiores.
   */
  it('no reescribe los tokens del círculo en SwiftUI', () => {
    for (const aproximacion of ['rgba(', 'backgroundOverlay', 'strokeBorder', 'shadow(']) {
      expect(MENU_IOS, aproximacion).not.toContain(aproximacion);
    }
  });

  /**
   * **Sin cristal nativo en la etiqueta**, que es lo que Expo desaconseja. El
   * círculo aprobado ya monta la rama no nativa de `GlassSurface`.
   */
  it('no mete cristal nativo en la etiqueta', () => {
    for (const prohibido of ['GlassView', 'glassEffect', "buttonStyle('glass')"]) {
      expect(MENU_IOS, prohibido).not.toContain(prohibido);
    }
    expect(CAMPOS).toContain('nativeEffect={false}');
  });

  /** El gesto es del menú y de nadie más. */
  it('la etiqueta no lleva interacción propia', () => {
    for (const gesto of ['Pressable', 'onPress', 'onTapGesture']) {
      expect(MENU_IOS, gesto).not.toContain(gesto);
    }
  });

  /**
   * **La etiqueta es TODO el trigger.** Sin estos tres, SwiftUI la envuelve en
   * su propio botón y le añade el galón de despliegue al lado. `'plain'` es la
   * ausencia de estilo, no el cristal.
   */
  it('no queda cromo del sistema alrededor', () => {
    expect(MENU_IOS).toContain("menuStyle('button')");
    expect(MENU_IOS).toContain("buttonStyle('plain')");
    expect(MENU_IOS).toContain("menuIndicator('hidden')");
  });

  /** Y como la etiqueta ya no es texto, quien anuncia es el modificador. */
  it('conserva su etiqueta de accesibilidad', () => {
    expect(MENU_IOS).toContain('accessibilityLabel(label)');
  });

  /** El diámetro lo manda quien compone la fila, no un número escrito aquí. */
  it('el tamaño viene de fuera y es el del círculo', () => {
    expect(MENU_IOS).toContain('{ width: size, height: size }');
    expect(CAMPOS).toContain('size={CIRCLE}');
  });

  /** El check es el del sistema: un `Toggle` con `isOn` dentro de un `Menu`. */
  it('la marca de la vigente es la nativa', () => {
    expect(MENU_IOS).toContain('<Toggle');
    expect(MENU_IOS).toContain('isOn={option.selected}');
  });

  /** Y el catálogo es el mismo de siempre: una fuente, no dos. */
  it('las opciones salen del mismo catálogo que en Android', () => {
    for (const fuente of [MENU, MENU_IOS]) {
      expect(fuente).toContain('categoryOptions(categories, selected, t)');
    }
    expect(MENU_IOS).toContain('onSelect(option.id)');
  });

  /** Sin rodeos de tiempo: el artefacto no se disimula, se deja de producir. */
  it('no hay temporizador, remontaje ni opacidad', () => {
    for (const parche of ['setTimeout', 'opacity', 'requestAnimationFrame', 'useState']) {
      expect(MENU_IOS, parche).not.toContain(parche);
    }
    // La única `key` es la de la lista, y es el UUID: estable, así que nada se
    // remonta a propósito.
    expect(MENU_IOS.match(/key=\{/g) ?? []).toHaveLength(1);
    expect(MENU_IOS).toContain('key={option.id}');
  });

  it('y Android conserva su implementación', () => {
    expect(MENU).toContain('<MenuView');
    expect(MENU).not.toContain('swift-ui');
  });

  it('el envoltorio del trigger no pinta fondo, borde ni sombra', () => {
    for (const pintura of [
      'backgroundColor',
      'boxShadow',
      'shadowColor',
      'shadowOpacity',
      'elevation',
      'borderWidth',
      'borderRadius',
      'overflow',
    ]) {
      expect(MENU, pintura).not.toContain(pintura);
    }
  });
});

/**
 * LOS CÍRCULOS PESAN LO MISMO QUE LOS OBLONGOS.
 *
 * `raised` y `well` no son dos intensidades de un mismo relieve. Su sombra
 * EXTERIOR es `offsetY 8 / blur 20 / negro 0.65` frente a `offsetY 2 / blur 6 /
 * 0.35`: más del triple de difuminado y casi el doble de opacidad. Sobre un
 * fondo negro, eso era la mancha que se veía bajo cada círculo mientras los
 * oblongos de la misma fila se apoyaban con discreción.
 *
 * **Se iguala, no se apaga.** `well` conserva su sombreado interior y su sombra
 * exterior corta, que es lo que sigue haciendo del control un objeto.
 */
describe('la profundidad de los controles de la ventana', () => {
  const OBLONGOS = [
    // El concepto y la pista del selector de clase: los dos oblongos.
    ['features/personal/movement-fields.tsx', 'conceptBox'],
    ['features/personal/entry-kind-selector.tsx', 'styles.track'],
  ] as const;

  it('los oblongos son la referencia, y siguen en `well`', () => {
    for (const [path] of OBLONGOS) {
      expect(code(path), path).toContain('depth="well"');
    }
  });

  /** Moneda, categoría y calendario: los tres círculos de la composición. */
  it('los tres círculos usan el token de los oblongos', () => {
    // La moneda, por su `GlassPressable`.
    expect(HOJA).toContain('depth="well"');
    // El concepto y el calendario, en la fila. El círculo de categoría se mudó
    // a `CategoryTrigger` cuando iOS necesitó su variante sin sombra exterior.
    expect(CAMPOS.match(/depth="well"/g) ?? []).toHaveLength(2);
    expect(TRIGGER).toContain('depth="well"');
  });

  /**
   * Y ninguno se queda con el token pesado. El único `well` de la hoja es el de
   * la moneda: el CTA conserva su relieve, que no es uno de estos círculos.
   */
  it('ninguno de los tres sigue en `raised`', () => {
    expect(CAMPOS).not.toContain('depth="raised"');
    expect(HOJA).not.toContain('depth="raised"');
    expect(HOJA.match(/depth="well"/g) ?? []).toHaveLength(1);
  });

  /**
   * **No se inventa una sombra nueva.** El token ya existía y es el que usan
   * los oblongos; escribir una tercera profundidad a mano habría dejado tres
   * relieves donde el sistema define dos.
   */
  it('no hay una sombra escrita a mano en la composición', () => {
    for (const fuente of [CAMPOS, HOJA, MENU]) {
      expect(fuente).not.toContain('boxShadow');
      expect(fuente).not.toContain('shadowColor');
    }
  });

  /** Un ingreso sigue sin categoría: el círculo desaparece, no se desactiva. */
  it('los ingresos siguen sin selector de categoría', () => {
    expect(CAMPOS).toContain('usesCategory(kind) ? (');
    expect(MENU).not.toContain('income');
  });

  /**
   * **Sin segunda lista.** Las opciones salen enteras del catálogo que llega, y
   * quien filtra lo vigente sigue siendo `useEntryCategories` — en un solo
   * sitio, que es lo que conserva la excepción de la categoría ya retirada.
   */
  it('no hay un catálogo escrito a mano en la pantalla', () => {
    expect(MENU).toContain('categoryOptions(categories, selected, t)');
    for (const nombre of ['groceries', 'dining', 'transport', 'Supermercado']) {
      expect(MENU, nombre).not.toContain(nombre);
    }
    expect(code('features/personal/category.ts')).not.toContain('is_active');
  });
});

describe('el dinero no se convierte en número por el camino', () => {
  it('no hay parseFloat ni Number sobre el importe', () => {
    for (const path of [
      'features/personal/movement-entry.ts',
      'features/personal/movement-form.tsx',
      'features/personal/use-record-movement.ts',
    ]) {
      expect(code(path), path).not.toContain('parseFloat');
      expect(code(path), path).not.toContain('parseInt');
    }
  });

  it('el importe sale como texto', () => {
    expect(ENTRY).toContain('amount: minor.toString()');
  });

  /**
   * **Nada que el formulario dibuje puede depender del ámbito antes de que
   * resuelva.** El importe vacío se pintaba formateando un cero de la moneda
   * del ámbito, y en el primer render ese ámbito todavía es `null`:
   * `currencyDefinition` recibía el código vacío, lanzaba, y la ventana no
   * llegaba a montarse. El símbolo de la moneda —que sí la necesita— ya estaba
   * guardado; esto no.
   */
  it('el formulario no construye definiciones monetarias', () => {
    expect(code('features/personal/movement-form.tsx')).not.toContain('currencyDefinition(');
    expect(code('features/personal/movement-form.tsx')).not.toContain("from '@/domain'");
  });

  /**
   * **La cifra es UN texto con una tirada anidada, no dos textos en fila.**
   * Con dos había que alinearlos por línea base a mano y quedaban separados el
   * ancho del primero — que llevaba el `minWidth` del campo, así que los
   * céntimos salían a 132 puntos del entero e invadían el control del €.
   * Anidado, el motor de texto los compone pegados y sobre la misma base.
   */
  it('los enteros y los céntimos se componen en un solo texto', () => {
    expect(FORM).not.toContain("flexDirection: 'row',\n    alignItems: 'baseline'");
    expect(CAMPO).toContain('minimumFractionDigits: scale');
    // La tirada pequeña NO lleva caja de línea propia: hereda la del padre, que
    // es lo que la deja sobre la misma base.
    expect(CAMPO).toMatch(/amountDecimals: \{[^}]*\}/);
    expect(/amountDecimals: \{([^}]*)\}/.exec(CAMPO)?.[1]).not.toContain('lineHeight');
  });

  /** El campo y su cero comparten estilo: el cero cae donde caerá el dígito. */
  it('la cifra no lleva ancho mínimo, que es lo que abría el hueco', () => {
    expect(CAMPO).toContain('style={styles.amount}');
    expect(/amount: \{([^}]*)\}/.exec(CAMPO)?.[1]).not.toContain('minWidth');
  });

  /** Y un contrapeso mantiene la cifra en el centro, no el conjunto. */
  /**
   * **El `€` y los dos círculos salen de la MISMA constante.** El control se
   * centra sobre el ancho del bloque de abajo, así que escribir ese ancho dos
   * veces habría bastado para que se separaran en cuanto alguien tocara el
   * tamaño de un círculo — y el `€` habría quedado flotando sin relación con lo
   * que tiene debajo, que es justo lo que se estaba corrigiendo.
   */
  /**
   * **La cifra va centrada en la ventana, y el contrapeso es lo que lo hace.**
   * Sin él la fila centra el CONJUNTO —cifra, hueco y `€`— y la cantidad queda
   * media anchura del control a la izquierda del centro real.
   *
   * Y eso deja el `€` sin alinear con los dos círculos de abajo, a sabiendas:
   * las dos cosas no caben. Centrar exige un hueco igual al ancho del control a
   * cada lado; alinearlo con los círculos exige una columna de 112, y con dos
   * de ésas a la cifra le quedarían 55 puntos de los 279 útiles.
   */
  it('la cifra va centrada, con un contrapeso que lo garantiza', () => {
    const fuente = code('features/personal/amount-sheet.tsx');
    expect(fuente).toContain('styles.currencyGutter');
    // Acotado a la hoja de estilos: el tipo de las props también declara un
    // campo `currency`, y ahí no hay anchuras que comparar.
    const codigo = fuente.slice(fuente.indexOf('StyleSheet.create('));

    const gutter = /currencyGutter: \{([^}]*)\}/.exec(codigo)?.[1];
    const currency = /currency: \{([^}]*)\}/.exec(codigo)?.[1];
    // El contrapeso mide lo MISMO que el control: si no, no hay simetría.
    expect(/width: (\d+)/.exec(gutter ?? '')?.[1]).toBe(/width: (\d+)/.exec(currency ?? '')?.[1]);
  });

  it('y el texto de la cifra también', () => {
    const estilo = /amount: \{([^}]*)\}/.exec(code('features/personal/amount-field.tsx'))?.[1];
    expect(estilo).toContain("textAlign: 'center'");
    // El cuerpo de la pasada anterior se conserva: aquí sólo cambió la
    // alineación, no el tamaño.
    expect(estilo).toContain('fontSize: 56');
  });

  /** Con el entero al doble que los decimales, que es la jerarquía pedida. */
  it('y el entero dobla en cuerpo a los decimales', () => {
    const codigo = code('features/personal/amount-field.tsx');
    const entero = Number(/amount: \{[^}]*fontSize: (\d+)/.exec(codigo)?.[1]);
    const decimal = Number(/amountDecimals: \{[^}]*fontSize: (\d+)/.exec(codigo)?.[1]);

    expect(entero).toBeGreaterThan(48); // más grande que antes
    expect(decimal / entero).toBeLessThanOrEqual(0.55);
  });

  /** Una cifra larga encoge en vez de salirse: no hay sitio infinito. */
  it('una cantidad larga se ajusta en vez de desbordar', () => {
    expect(code('features/personal/amount-field.tsx')).toContain('adjustsFontSizeToFit');
  });

  it('y la cifra se dibuja sin saber qué moneda es', () => {
    // La cifra recibe el estado del editor y la escala, y nada más: ni el
    // código de la moneda ni un símbolo. Lo que se dibuje sale de ahí.
    expect(CAMPO).toContain('<AmountFigure entry={showing} scale={scale}');
    expect(CAMPO).toContain('minimumFractionDigits: scale');
  });

  /**
   * **EL CURSOR NO SE VE, NUNCA.** El campo sigue siendo enfocable y sigue
   * abriendo el teclado decimal —eso es lo que hace que se pueda escribir—,
   * pero ni su barra ni su texto ni su selección se pintan: lo que se lee es la
   * composición de debajo, que es la única capaz de llevar dos cuerpos.
   *
   * `caretHidden` es la capacidad de React Native para esto. No es un carácter
   * encima ni un truco visual.
   */
  it('el campo captura el teclado sin enseñar cursor', () => {
    // Sobre el CODIGO, no sobre la prosa: la nota de arriba explica por que el
    // cursor no se ve, y esa explicacion no es la propiedad.
    const codigo = code('features/personal/amount-field.tsx');
    expect(codigo).toContain('caretHidden');
    expect(codigo).toContain('selectionColor="transparent"');
    expect(codigo).toContain("color: 'transparent'");
    // Y sigue siendo un control enfocable de verdad: nada de `opacity: 0`,
    // que en algunas versiones de iOS deja de entregar el foco.
    expect(/capture: \{([^}]*)\}/.exec(CAMPO)?.[1]).not.toContain('opacity');
    expect(CAMPO).toContain('keyboardType="decimal-pad"');
  });

  /**
   * Y el teclado se cierra sólo al COMPLETAR los céntimos —no si ya lo
   * estaban—, para que corregir uno y volver a escribirlo lo cierre otra vez.
   * Cuántos son los dice la escala de la moneda, no un dos escrito aquí.
   */
  it('el teclado se cierra al completar los céntimos, y sólo entonces', () => {
    expect(CAMPO).toContain('Keyboard.dismiss()');
    expect(CAMPO).toContain('!amountComplete(entry, scale) && amountComplete(moved, scale)');
  });

  /**
   * **Los tres tonos salen del editor, no de un indicador propio.** Si la
   * pantalla llevara su propia bandera de «ya hay decimales», borrar hasta la
   * parte entera podria dejar la fraccion encendida sin nada escrito. Derivarlo
   * es lo que hace que ese estado no exista.
   */
  it('el color de cada pieza lo decide el estado del editor', () => {
    expect(CAMPO).toContain('amountTones(entry)');
    expect(CAMPO).toContain('paint(tones.whole)');
    expect(CAMPO).toContain('paint(tones.separator)');
    expect(CAMPO).toContain('paint(tones.fraction)');
    // Y no hay una segunda verdad: ni estado ni ref para el color.
    expect(code('features/personal/movement-form.tsx')).not.toMatch(/const \[\w*[Tt]one/);
  });

  /** El tono apagado sigue siendo el mismo de siempre, no uno nuevo. */
  it('y usa el tono secundario que ya existia', () => {
    expect(CAMPO).toContain("'textDisabled'");
  });

  /** La cifra visible sale del modelo, no del texto crudo del campo. */
  it('lo que se pinta viene del modelo, no del campo', () => {
    expect(CAMPO).toContain('amountParts(entry, scale)');
    expect(CAMPO).toContain('applyAmountInput(entry, next, scale)');
  });

  it('la escala viene de la moneda del ámbito, nunca fijada a dos', () => {
    expect(FORM).toContain('scope?.currencyScale');
    expect(HOJA).toContain('currencySymbol(locale');
    expect(code('features/personal/movement-form.tsx')).not.toContain("'€'");
  });
});

describe('guardar una vez, aunque se pulse dos', () => {
  const HOOK = code('features/personal/use-record-movement.ts');

  it('la clave se genera antes del envío y se conserva por intención', () => {
    expect(HOOK).toContain('newClientOperationId()');
    expect(HOOK).toContain('keys.current.get(intent)');
  });

  /**
   * Y se olvida cuando la intención cambia: reusar la clave tras corregir el
   * importe daría `IDEMPOTENCY_KEY_REUSED · 409` y la corrección se perdería.
   */
  it('la huella incluye la clase, el importe, el concepto, la fecha y la hora', () => {
    for (const part of [
      'draft.kind',
      'draft.amount',
      'draft.concept',
      'draft.date',
      'draft.time',
    ]) {
      expect(HOOK, part).toContain(part);
    }
  });

  it('el botón no se puede pulsar mientras está enviando', () => {
    expect(FORM).toContain("saving={status === 'saving'}");
    expect(HOJA).toContain('busy={saving}');
    expect(file('ui/components/glass-pressable.tsx')).toContain('disabled={disabled || busy}');
  });

  it('un fallo no se da por guardado', () => {
    expect(HOOK).toContain("setStatus('failed')");
    expect(HOOK).toContain('return false');
    expect(FORM).toContain('if (ok) onSaved()');
  });
});

describe('nada de texto visible fuera del catálogo', () => {
  /**
   * `tests/lib/i18n-usage.test.ts` ya vigila esto, pero **sólo sobre `app/` y
   * `ui/`**: las pantallas que viven en `features/` quedan fuera de su alcance,
   * y este bloque trae tres. Se mira el fuente sin comentarios, porque estos
   * ficheros explican por extenso lo que hacen.
   */
  it('los componentes del formulario sólo pintan claves traducidas', () => {
    for (const path of [
      'features/personal/movement-form.tsx',
      'features/personal/entry-kind-selector.tsx',
      'features/personal/entry-pickers.tsx',
      'app/add.tsx',
    ]) {
      const sueltos = [...code(path).matchAll(/>\s*([A-Za-zÁÉÍÓÚáéíóúÑñ][^<>{}\n]{2,})\s*</g)];
      expect(
        sueltos.map((match) => match[1].trim()),
        path,
      ).toEqual([]);
    }
  });

  it('cada clave nueva existe en los dos idiomas', () => {
    const es = file('lib/i18n/messages/es-ES.ts');
    const en = file('lib/i18n/messages/en.ts');
    const claves = new Set(
      [
        ...[ADD, FORM, EDICION, CAMPOS, SELECTOR, PICKERS]
          .join('\n')
          .matchAll(/'(entry\.[A-Za-z]+)'/g),
      ].map((match) => match[1]),
    );

    expect(claves.size).toBeGreaterThan(10);
    for (const key of claves) {
      expect(es, key).toContain(`'${key}':`);
      expect(en, key).toContain(`'${key}':`);
    }
  });
});

/**
 * TOCAR DENTRO DE LA VENTANA NO LA CIERRA.
 *
 * El velo que cierra al tocar fuera es un hermano a pantalla completa, y la
 * ventana va encima por orden de hermanos. Eso basta mientras el punto tocado
 * caiga sobre un control — pero **un hueco de la ventana no lo reclamaba
 * nadie**: el toque la atravesaba, lo recogía el velo, y la ventana se cerraba
 * al tocar dentro.
 *
 * `onStartShouldSetResponder` lo cierra: la ventana se queda con los toques que
 * caen en ella. Los hijos siguen teniendo la primera oportunidad —el sistema de
 * respondedores pregunta de dentro hacia fuera— así que el importe, la moneda,
 * el CTA y la X reciben los suyos igual.
 */
describe('tocar dentro de la ventana no la cierra', () => {
  const ARMAZON = code('ui/components/sheet-window.tsx');

  /**
   * **Y el `onStartShouldSetResponder` del panel se retiró.** No arregló nada
   * sobre el aparato —la causa estaba en el cristal— y un manejador de
   * respondedor en un ANTECESOR de un `TextInput` puede quedarse con el toque
   * antes de que el campo llegue a enfocarse.
   */
  it('el panel no intercepta los toques de sus hijos', () => {
    expect(ARMAZON).not.toContain('onStartShouldSetResponder');
  });

  /**
   * **El velo sigue debajo y sigue cerrando.** La regla de fuera no cambia:
   * tocar fuera cierra, exactamente como antes.
   */
  it('tocar fuera sigue cerrando, y la X también', () => {
    // Dos vías de cierre y sólo dos: el velo y la X.
    expect(ARMAZON.match(/onPress=\{close\}/g) ?? []).toHaveLength(2);
    expect(ARMAZON).toContain('style={StyleSheet.absoluteFill}');
    expect(ARMAZON).toContain('name="xmark"');

    // Y el velo va ANTES que la ventana: el orden de hermanos es lo que la
    // pone encima.
    expect(ARMAZON.indexOf('style={StyleSheet.absoluteFill}')).toBeLessThan(
      ARMAZON.indexOf('<Animated.View'),
    );
  });

  /**
   * **No se ha tocado la geometría.** El arreglo es de reparto de toques: ni un
   * estilo, ni un tamaño, ni una capa nueva.
   */
  it('no cambia la composición ni añade envoltorios', () => {
    // El lienzo sigue teniendo dos hijos: velo y centro.
    expect(ARMAZON).toContain('<View style={styles.centre} pointerEvents="box-none">');
    // Y sigue habiendo un solo armazón para todas las ventanas.
    const armazones = FILES.filter((f) => f.text.includes('export function SheetWindow'));
    expect(armazones.map((f) => f.path)).toEqual(['ui/components/sheet-window.tsx']);
    // Nada de resolverlo apagando el cierre exterior ni quitando el velo.
    expect(ARMAZON).not.toContain('pointerEvents="none"');
    expect(ARMAZON).not.toContain('stopPropagation');
  });

  /**
   * EL CONTRATO DE CAPAS, DECLARADO.
   *
   * El velo cubre la pantalla entera, panel incluido, así que quién se queda
   * cada toque lo decide el orden de capas. El orden de escritura ya daba el
   * resultado correcto, pero lo dejaba a merced de que nadie reordenara los
   * hermanos: un cambio así habría puesto el velo por encima del panel sin
   * tocar el aspecto y sin que ninguna prueba se enterara.
   */
  it('el panel está por encima del velo por declaración, no por orden', () => {
    // Un solo `zIndex` en todo el armazón, y va en la capa del panel.
    expect(ARMAZON.match(/zIndex/g) ?? []).toHaveLength(1);
    expect(ARMAZON).toMatch(/centre: {[^}]*zIndex: 1,/s);

    // Y NO en el velo: subirlo ahí invertiría exactamente la regla.
    const velo = ARMAZON.slice(0, ARMAZON.indexOf('<Animated.View'));
    expect(velo).not.toContain('zIndex');

    // Sigue siendo una capa puramente táctil: no pinta ni desplaza nada.
    expect(ARMAZON).not.toMatch(/centre: {[^}]*backgroundColor/s);
    expect(ARMAZON).not.toContain('elevation');
  });

  /**
   * Y el arreglo es del armazón, así que alcanza a las tres ventanas por igual
   * — no hay un parche en ninguna pantalla.
   */
  it('el arreglo vive en el armazón compartido', () => {
    for (const pantalla of [
      'app/add.tsx',
      'app/edit-balance.tsx',
      'app/edit-movement.tsx',
      'features/personal/movement-editor.tsx',
      'features/personal/balance-editor.tsx',
    ]) {
      expect(code(pantalla), pantalla).not.toContain('onStartShouldSetResponder');
      expect(code(pantalla), pantalla).not.toContain('pointerEvents');
    }
  });

  /** El campo del importe y el CTA siguen siendo controles de verdad. */
  it('el importe y el CTA siguen recibiendo sus toques', () => {
    expect(CAMPO).toContain('<TextInput');
    expect(CAMPO).toContain('keyboardType="decimal-pad"');
    expect(HOJA).toContain('<SaveButton');
    expect(code('ui/components/glass-pressable.tsx')).toContain('disabled={disabled || busy}');
  });
});
