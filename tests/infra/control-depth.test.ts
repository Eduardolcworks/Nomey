import { describe, expect, it } from 'vitest';

/**
 * LA PROFUNDIDAD DE LOS CONTROLES: UNA FUENTE, Y CADA CAPA CON UNA FUNCIÓN.
 *
 * **El defecto que fija.** En Android la proyección exterior viajaba en el
 * mismo `boxShadow` que el rim, sobre la misma vista que pinta el fondo, el
 * borde y el radio. Ese renderizador no funde la lista: dibuja cada entrada
 * como una silueta independiente, así que lo que se veía no era una caída sino
 * un contorno de canto duro, igual en todos los controles oblongos y
 * circulares.
 *
 * Aquí se comprueba la ESTRUCTURA, nunca el aspecto. Ninguna de estas pruebas
 * dice que dos plataformas se parezcan: eso se valida sobre el aparato.
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

/** Cualquier fuente, sin sus comentarios: se afirma sobre el código, no sobre la prosa. */
function limpio(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function code(relative: string): string {
  return limpio(FILES.find((candidate) => candidate.path === relative)?.text ?? '');
}

describe('una única fuente de profundidad', () => {
  /**
   * Nadie escribe cifras de sombra fuera del tema. Un consumidor con sus
   * propios números deja de moverse con los demás en cuanto se calibre, que es
   * cómo empezaron a separarse los controles la vez anterior.
   */
  it('ningún fichero fuera del tema escribe una sombra literal', () => {
    for (const { path, text } of FILES) {
      if (path.startsWith('ui/theme/')) continue;
      expect(limpio(text), path).not.toMatch(/blurRadius:\s*\d/);
      expect(limpio(text), path).not.toMatch(/shadowOpacity|shadowRadius|shadowOffset/);
    }
  });

  /** `elevation` es la sombra de Material: otra curva, otro recorte, otro halo. */
  it('nadie usa elevation', () => {
    for (const { path, text } of FILES) {
      expect(limpio(text), path).not.toMatch(/\belevation:\s/);
    }
  });

  /**
   * Las dos mitades salen del MISMO token. Si dejaran de filtrar el mismo
   * origen, la capa y la vista discreparían sin que nada fallara.
   */
  it('las dos mitades filtran el mismo token', () => {
    const fuente = code('ui/theme/depth.ts');
    expect(fuente).toContain('function castShadow');
    expect(fuente).toContain('function innerShading');
    expect(fuente).toContain('layer.inset !== true');
    expect(fuente).toContain('layer.inset === true');
  });

  it('surfaceDepth es quien decide qué lleva la propia vista', () => {
    const fuente = code('ui/theme/depth.ts');
    expect(fuente).toContain('export function surfaceDepth');
    expect(fuente).toContain("Platform.OS === 'android' ? innerShading(state) : Tactile[state]");
  });
});

describe('la capa de proyección', () => {
  const android = code('ui/components/depth-layer.android.tsx');
  const ios = code('ui/components/depth-layer.tsx');

  it('en iOS no monta ningún nodo', () => {
    expect(ios).toContain('return null;');
    expect(ios).not.toContain('<View');
    expect(ios).not.toContain('boxShadow');
  });

  it('en Android lleva la mitad exterior y nada más', () => {
    expect(android).toContain('castShadow(state)');
    expect(android).not.toContain('backgroundColor');
    expect(android).not.toContain('borderColor');
    expect(android).not.toContain('borderWidth');
    expect(android).not.toContain('children');
  });

  it('no recorta, y toma el radio del control', () => {
    expect(android).not.toContain('overflow');
    expect(android).toContain('borderRadius: radius');
  });

  /**
   * Queda detrás por ORDEN, no por `zIndex`. Se probó con `zIndex: -1` y la
   * capa dejaba de pintarse dentro de un padre sin fondo propio — medido sobre
   * el emulador, con la chapa de Deudas quedándose sin su caja.
   */
  it('no entra en el reparto, no recibe toques y no usa zIndex', () => {
    expect(android).toContain("position: 'absolute'");
    expect(android).toContain('pointerEvents="none"');
    expect(android).not.toContain('zIndex');
  });
});

describe('la implementación Android separa host, material, rim y contenido', () => {
  const fuente = code('ui/components/glass-surface.android.tsx');

  /**
   * **El host es la vista exterior y lleva TODA la proyección.** No sólo la del
   * estado: también la mitad `outset` de la lente del material, que en el nivel
   * `action` es el halo ámbar del `+`. Quedándose en la vista del material se
   * sumaba a su borde y salía como un anillo duro.
   */
  it('el host lleva el radio y toda la proyección, y nada más', () => {
    expect(fuente).toContain('borderRadius: radius, boxShadow: proyeccion(');
    expect(fuente).toContain('outerHalf(TactileAndroid[estado])');
    expect(fuente).toContain('outerHalf(lens ?? [])');
    // Sin material propio: si lo tuviera volvería a ser dos cosas a la vez.
    const host = fuente.slice(fuente.indexOf('boxShadow: proyeccion('));
    expect(host.slice(0, host.indexOf('}'))).not.toContain('backgroundColor');
  });

  /** Y hacia dentro va todo lo demás, en la capa del material. */
  it('el material lleva el rim, el sombreado interior y las lentes inset', () => {
    expect(fuente).toContain('innerHalf(TactileAndroid[estado])');
    expect(fuente).toContain('innerHalf(lens ?? [])');
    expect(fuente).toContain('...rimShadow(rim, highlight)');
  });

  /**
   * La máscara vive en el host, y no se come su proyección: `overflow` recorta
   * HIJOS, no lo que la propia vista dibuja fuera de sus límites.
   */
  it('la máscara está en el host y no cancela la proyección', () => {
    expect(fuente).toContain('clip ? styles.mask : null');
    const mask = fuente.slice(fuente.indexOf('mask: {'));
    expect(mask.slice(0, mask.indexOf('}'))).toContain("overflow: 'hidden'");
    // Nada condiciona la proyección a la ausencia de máscara.
    expect(fuente).not.toContain('!clip');
  });

  it('el material cubre sin ocupar sitio, no recibe toques y no usa zIndex', () => {
    const material = fuente.slice(fuente.indexOf('material: {'));
    const estilo = material.slice(0, material.indexOf('},'));
    expect(estilo).toContain("position: 'absolute'");
    expect(estilo).not.toContain('zIndex');
    expect(fuente).toContain('pointerEvents="none"');
    /*
     * El orden es el mecanismo, y hay dos ramas: la de control monta
     * `ControlMaterial` antes del contenido, y la de superficie su capa de
     * material. En las dos, lo que pinta va ANTES que los hijos.
     */
    const control = fuente.slice(fuente.indexOf("material === 'control'"));
    expect(control.indexOf('<ControlMaterial')).toBeLessThan(control.indexOf('{children}'));
    const superficie = fuente.slice(fuente.indexOf('styles.material'));
    expect(superficie.indexOf('borderRadius: radius')).toBeLessThan(
      superficie.indexOf('{children}'),
    );
  });

  /** El rim es un `inset`: no puede confundirse con la proyección. */
  it('el rim sigue siendo interior y separado del estado', () => {
    const rim = fuente.slice(fuente.indexOf('function rimShadow'));
    expect(rim).toContain('inset: true');
    expect(rim).not.toContain('outerHalf');
  });

  /**
   * `disabled` es exclusivo de Android, se resuelve dentro de esta
   * implementación y no toca el contrato de estados táctiles.
   */
  it('disabled se resuelve aquí y no llega a TactileState', () => {
    expect(fuente).toContain("return disabled ? 'disabled' : (depth ?? 'raised');");
    expect(code('ui/theme/elevation.ts')).toContain(
      "Record<keyof typeof TactileIOS | 'disabled', readonly BoxShadowValue[]>",
    );
  });
});

describe('los controles que no pasan por GlassSurface', () => {
  const CONSUMIDORES = [
    'ui/components/action-button.tsx',
    'features/auth/account-avatar.tsx',
    'features/shell/nomey-tab-bar.tsx',
  ] as const;

  it('leen la fuente compartida y no el token directo', () => {
    for (const ruta of CONSUMIDORES) {
      const fuente = code(ruta);
      /*
       * `surfaceDepth` para quien lleva la sombra en su propia vista, y
       * `emphasisDepth` para la capa de énfasis translúcida del dock, que en
       * Android no lleva ninguna. Las dos viven en `ui/theme/depth.ts`: lo que
       * la guarda impide es escribir las cifras, no elegir la función.
       */
      expect(fuente, ruta).toMatch(/surfaceDepth\(|emphasisDepth\(/);
      expect(fuente, ruta).not.toMatch(/boxShadow:\s*Tactile\./);
    }
  });

  it('el botón de acción monta la capa con el radio del control', () => {
    const fuente = code('ui/components/action-button.tsx');
    expect(fuente).toContain(
      '<DepthLayer state={estado(pressed, primary)} radius={Radius.full} />',
    );
    /*
     * La vista y la capa leen el MISMO estado, resuelto una sola vez. Con el
     * material neutro pedido, la profundidad se apaga en Android por la misma
     * función que usa el dock, no por una lista escrita aquí.
     */
    expect(fuente).toContain('const tacto = estado(pressed, primary);');
    expect(fuente).toContain('boxShadow: neutro ? emphasisDepth(tacto) : surfaceDepth(tacto),');
    expect(fuente).toContain('<ControlMaterial radius={Radius.full} fill={!pressed} />');
  });
});

describe('la jerarquía de los estados en Android', () => {
  /**
   * Se afirma sobre la ESTRUCTURA de los tokens, no sobre cómo se ven: cuántas
   * mitades tiene cada estado y en qué orden quedan sus proyecciones. Lo que la
   * caída parezca sobre el aparato no lo decide un fichero de texto.
   */
  const tema = code('ui/theme/elevation.ts');
  const bloque = tema.slice(tema.indexOf('TactileAndroid'));
  const estado = (nombre: string) => {
    const desde = bloque.indexOf(nombre + ': [');
    return bloque.slice(desde, bloque.indexOf('],', desde));
  };
  /** Las proyecciones de un estado: las entradas que NO son `inset`. */
  const proyecciones = (nombre: string) =>
    estado(nombre)
      .split('\n')
      .filter((linea) => linea.includes('offsetX') && !linea.includes('inset: true'));

  /** Pulsado pierde la proyección exterior: hundido, no levantado. */
  it('pulsado no proyecta nada', () => {
    expect(proyecciones('pressed')).toHaveLength(0);
  });

  it('reposo y seleccionado proyectan una sola vez', () => {
    expect(proyecciones('raised')).toHaveLength(1);
    expect(proyecciones('selected')).toHaveLength(1);
  });

  /** Y hundido no proyecta: una cavidad no puede arrojar sombra. */
  it('hundido no proyecta', () => {
    expect(proyecciones('well')).toHaveLength(0);
  });

  /**
   * **SELECCIONADO NO PROYECTA MÁS FUERTE QUE REPOSO.** Lo que lo distingue es
   * el MATERIAL —`GlassPressable` sube el nivel a `heavy`—, no una sombra más
   * oscura. Se probó al revés, subiéndole la opacidad a 0,46, y sobre el aparato
   * eso fue lo que puso una segunda píldora negra bajo el selector.
   */
  it('seleccionado no proyecta más fuerte que reposo', () => {
    const cifra = (linea: string, clave: string) =>
      Number(new RegExp(clave + ':\\s*(-?\\d+)').exec(linea)?.[1]);
    const alfa = (linea: string) => Number(/rgba\([^)]*?([\d.]+)\)/.exec(linea)?.[1]);
    const reposo = proyecciones('raised')[0];
    const elegido = proyecciones('selected')[0];
    expect(alfa(elegido)).toBeLessThanOrEqual(alfa(reposo));
    // Y su caída no es más corta, que es lo que la volvería un canto.
    expect(cifra(elegido, 'blurRadius')).toBeGreaterThanOrEqual(cifra(reposo, 'blurRadius'));
  });

  /**
   * La caída tiene que ser MUCHO más larga que el desplazamiento. Con
   * difuminado 16 sobre desplazamiento 4 —lo que se probó— Android dibuja una
   * plancha desplazada; a partir de una relación de ocho a uno deja de tener
   * canto. Medido, no deducido.
   */
  it('la caída es al menos ocho veces el desplazamiento', () => {
    for (const nombre of ['raised', 'selected']) {
      for (const linea of proyecciones(nombre)) {
        const desplazamiento = Math.abs(Number(/offsetY:\s*(-?\d+)/.exec(linea)?.[1]));
        const difuminado = Number(/blurRadius:\s*(\d+)/.exec(linea)?.[1]);
        expect(difuminado, nombre).toBeGreaterThanOrEqual(desplazamiento * 8);
      }
    }
  });

  /**
   * El difuminado es más largo que el desplazamiento en todas las proyecciones.
   * Es la condición estructural de una caída: con el difuminado por debajo del
   * desplazamiento, Android dibuja una silueta desplazada con canto — que es
   * exactamente el contorno duro que se corrigió.
   */
  it('ninguna proyección tiene el difuminado por debajo del desplazamiento', () => {
    for (const nombre of ['raised', 'selected', 'well']) {
      for (const linea of proyecciones(nombre)) {
        const desplazamiento = Number(/offsetY:\s*(-?\d+)/.exec(linea)?.[1]);
        const difuminado = Number(/blurRadius:\s*(\d+)/.exec(linea)?.[1]);
        expect(difuminado, nombre).toBeGreaterThan(Math.abs(desplazamiento) * 2);
      }
    }
  });
});

describe('el split deja la ruta iOS congelada', () => {
  const ios = code('ui/components/glass-surface.tsx');

  /**
   * **Ni una rama de plataforma en el fichero genérico.** Es el criterio del
   * split: la topología de Android sale del camino de iOS por construcción, no
   * por un condicional que alguien pueda ampliar.
   */
  it('la implementación genérica no menciona a Android', () => {
    expect(ios).not.toContain('Platform');
    expect(ios).not.toContain('android');
    expect(ios).not.toContain('RELIEVE_APARTE');
  });

  /**
   * Y resuelve todo sobre UNA vista, que es la composición aprobada: una sola
   * lista con el rim, el estado y la lente, sin capas intermedias.
   */
  it('compone rim, estado y lente en una sola lista sobre una sola vista', () => {
    expect(ios).toContain(
      '...rimShadow(rim, token.highlight),\n        ...depthShadow(depth, castsShadow),\n        ...(token.lens ?? []),',
    );
    expect(ios).toContain('return casts ? Tactile[depth] : innerShading(depth);');
    // Ninguna capa hija: el árbol es la vista y sus hijos, como antes.
    expect(ios).not.toContain('styles.material');
    expect(ios).not.toContain('styles.proyeccion');
    expect(ios).not.toContain('styles.relieve');
    expect(ios).not.toContain('pointerEvents="none"');
  });

  /** La máscara y el efecto nativo siguen donde estaban. */
  it('conserva la máscara y el efecto nativo de siempre', () => {
    expect(ios).toContain("...(clip ? { overflow: 'hidden' as const } : {})");
    expect(ios).toContain('useNativeGlass() && nativeEffect');
    expect(ios).toContain('<GlassView');
  });

  /** Y `disabled` le llega, pero no lo mira: en iOS eso es la opacidad. */
  it('ignora disabled', () => {
    expect(ios).toContain('disabled: _disabled = false');
    const cuerpo = ios.slice(ios.indexOf('const token = Glass[level]'));
    expect(cuerpo).not.toContain('_disabled');
  });

  /** El estilo de la superficie es exactamente el borde de siempre. */
  it('el borde de la superficie no ha cambiado', () => {
    expect(ios).toContain('surface: {\n    borderWidth: StyleSheet.hairlineWidth,\n  },');
  });
});

describe('iOS conserva sus tokens y su árbol', () => {
  const tema = code('ui/theme/elevation.ts');

  /**
   * `TactileIOS` está congelado. Si alguna cifra cambiara, esta prueba lo dice
   * — que es lo único que un fichero de texto puede afirmar sobre iOS.
   */
  it('TactileIOS no ha cambiado', () => {
    const bloque = tema.slice(tema.indexOf('TactileIOS'), tema.indexOf('TactileAndroid'));
    for (const esperado of [
      "offsetY: -10, blurRadius: 14, color: 'rgba(0, 0, 0, 0.45)', inset: true",
      "offsetY: 8, blurRadius: 20, color: 'rgba(0, 0, 0, 0.65)'",
      "offsetY: -12, blurRadius: 16, color: 'rgba(0, 0, 0, 0.38)', inset: true",
      "offsetY: 10, blurRadius: 26, color: 'rgba(0, 0, 0, 0.75)'",
      "offsetY: 8, blurRadius: 12, color: 'rgba(0, 0, 0, 0.62)', inset: true",
      "offsetY: 5, blurRadius: 8, color: 'rgba(0, 0, 0, 0.50)', inset: true",
      "offsetY: 2, blurRadius: 6, color: 'rgba(0, 0, 0, 0.35)'",
    ]) {
      expect(bloque).toContain(esperado);
    }
  });

  it('la calibración de Android no toca la de iOS', () => {
    const fuente = code('ui/theme/depth.ts');
    expect(fuente).toContain("Platform.OS === 'android' ? TactileAndroid : TactileIOS");
    expect(fuente).toContain("Platform.OS === 'android' ? RimBlurAndroid : RimBlurIOS");
  });

  /** Ni una rama de plataforma en la capa: la elige Metro por extensión. */
  it('la capa no ramifica por plataforma', () => {
    expect(code('ui/components/depth-layer.tsx')).not.toContain('Platform');
    expect(code('ui/components/depth-layer.android.tsx')).not.toContain('Platform');
  });
});

/**
 * PERFIL, y la regla es la misma que en el resto: **el consumidor pide un
 * material, no escribe sus capas**.
 *
 * Sus superficies estuvieron excluidas de la propagación anterior, así que aquí
 * se fija a qué material entró cada familia y por qué. Lo que se afirma es la
 * FUENTE de cada superficie; cómo se ve sobre el aparato no lo decide un
 * fichero de texto.
 */
describe('las superficies de Perfil', () => {
  it('las dos tarjetas de grupo piden el material de control', () => {
    const fuente = code('app/profile.tsx');
    /*
     * `OptionGroup` es el contenedor de las filas —General, Cuenta y el bloque
     * de desarrollo comparten exactamente este— y `PlansCard` la tarjeta de
     * planes. Ninguna de las dos es una ventana: no flotan sobre un velo, no
     * recortan contenido y no son modales. Son tarjetas de control.
     */
    expect(fuente).toContain(
      '<GlassSurface material="control" level="regular" style={styles.plans}>',
    );
    expect(fuente).toContain(
      '<GlassSurface material="control" level="regular" style={[styles.group, style]}>',
    );
    // Y ninguna se convirtió en ventana por el camino.
    expect(fuente).not.toContain('material="window"');
  });

  it('Cuenta pide el material en los dos botones y en la ficha de dato', () => {
    const fuente = code('app/account.tsx');
    // Los dos `ActionButton` de la pantalla, el normal y el de recuperación.
    expect(fuente.match(/material="control"/g)).toHaveLength(2);
    expect(fuente).toContain('<ControlMaterial radius={Radius.md} />');
    // El borde propio se apaga en Android para que no haya dos hilos.
    expect(fuente).toContain('borderColor: controlEdge(theme.border)');
  });

  it('el avatar conserva su respuesta al pulsarlo y pierde el inset', () => {
    const fuente = code('features/auth/account-avatar.tsx');
    expect(fuente).toContain('<ControlMaterial radius={Radius.full} fill={!pressed} />');
    expect(fuente).toContain("boxShadow: emphasisDepth(pressed ? 'pressed' : 'raised')");
    expect(fuente).toContain('borderColor: controlEdge(theme.border)');
    // Nadie volvió a pedir la mitad interior del token en este control.
    expect(fuente).not.toContain('surfaceDepth(');
  });

  it('no apareció una cuarta variante', () => {
    const contrato = code('ui/components/glass-surface-props.ts');
    const union = /material\?:\s*([^;]+);/.exec(contrato);
    expect(union).not.toBeNull();
    expect(union?.[1].replace(/\s+/g, ' ').trim()).toBe(
      "'control' | 'translucent-control' | 'surface' | 'window'",
    );
  });

  it('el canto del host sólo se apaga en Android', () => {
    const fuente = code('ui/theme/depth.ts');
    const cuerpo = fuente.slice(fuente.indexOf('export function controlEdge'));
    expect(cuerpo).toContain("Platform.OS === 'android' ? 'transparent' : colour");
  });
});

/**
 * EL SELECTOR DE INTERVALO, cuya geometría es la de DOS formas encajadas.
 *
 * El material se pintaba con `Radius.full` sobre un host de `Radius.md`: una
 * píldora de radio 22 dentro de una caja de radio 12. El indicador del estado
 * seleccionado —radio 8, separado 2 del canto— cabe dentro de la de 12 y no
 * dentro de la de 22, así que en las opciones de los extremos sus esquinas
 * salían por encima del rim. Medido sobre el aparato: a 17 px del canto
 * superior el rim caía en x≈79 y el indicador llegaba a x=65.
 *
 * Lo que se fija aquí es la relación, no una cifra: **el material lleva el
 * radio de la caja que lo contiene**.
 */
describe('la geometría del selector de intervalo', () => {
  const fuente = code('features/personal/interval-selector.tsx');

  it('el material del grupo lleva el radio del grupo', () => {
    expect(fuente).toContain('<ControlMaterial radius={Radius.md} />');
    const grupo = fuente.slice(fuente.indexOf('  group: {'));
    expect(grupo.slice(0, grupo.indexOf('  },'))).toContain('borderRadius: Radius.md,');
  });

  it('el círculo del calendario sí es una píldora, y conserva el suyo', () => {
    expect(fuente).toContain('<ControlMaterial radius={Radius.full} />');
    const circulo = fuente.slice(fuente.indexOf('  calendar: {'));
    expect(circulo.slice(0, circulo.indexOf('  },'))).toContain('borderRadius: Radius.full,');
  });

  it('la máscara existe y usa el mismo radio, como última protección', () => {
    const grupo = fuente.slice(fuente.indexOf('  group: {'));
    const cuerpo = grupo.slice(0, grupo.indexOf('  },'));
    expect(cuerpo).toContain("overflow: 'hidden',");
    expect(cuerpo).toContain('borderRadius: Radius.md,');
  });

  it('el indicador sigue siendo el fondo de la propia opción', () => {
    /*
     * No hay `translateX`, ni `width / 4`, ni interpolación: el indicador es el
     * `backgroundColor` del `Pressable` seleccionado, así que su caja ES la de
     * la opción y sus centros coinciden por construcción. Cualquiera de esas
     * tres técnicas volvería a abrir la puerta a un desfase.
     */
    expect(fuente).toContain('selected && { backgroundColor: theme.surfaceRaised }');
    expect(fuente).not.toMatch(/translateX|width\s*\/\s*4|interpolate/);
  });
});
