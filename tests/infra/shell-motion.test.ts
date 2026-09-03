import { describe, expect, it } from 'vitest';

import TAB_BAR_RAW from '../../src/features/shell/nomey-tab-bar.tsx?raw';
import SCOPE_SWITCH_RAW from '../../src/features/shell/scope-switch.tsx?raw';
import SHELL_MOTION_RAW from '../../src/features/shell/shell-motion.ts?raw';
import MOTION_RUNTIME_RAW from '../../src/ui/theme/motion-runtime.ts?raw';
import GLASS_SURFACE_RAW from '../../src/ui/components/glass-surface.tsx?raw';
import DOCK_TOKENS_RAW from '../../src/features/shell/dock.ts?raw';
import TABS_LAYOUT_RAW from '../../src/app/(tabs)/_layout.tsx?raw';
import { Motion } from '../../src/ui/theme/motion';
import { Glass, MinGlassTintAlpha } from '../../src/ui/theme/elevation';

/**
 * El movimiento del shell: un solo lenguaje, y nada que se haya roto al
 * añadirlo.
 *
 * Lo que NO se comprueba aquí son los números de la animación uno a uno. Un
 * test que fije que el icono crece a 1.06 no protege nada: si alguien lo
 * cambia a 1.05 el test falla y la app está igual de bien. La validación de si
 * esto se siente premium es el dispositivo, y no hay renderer con el que
 * fingirla.
 *
 * Lo que sí se protege es lo que puede romperse en silencio: que los dos
 * controles sigan haciendo lo mismo que antes, que compartan una sola fuente
 * de movimiento, que no haya aparecido navegación imperativa, y que la
 * accesibilidad —contraste durante la transición y Reduce Motion— tenga un
 * camino explícito en vez de ser un olvido.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Todo el fuente, para las guardas que deben valer en CUALQUIER capa.
 *
 * Sin comentarios: las dos guardas de abajo buscan configs escritas a mano, y
 * un comentario que explique por qué no se escriben las haria fallar.
 */
const ALL_SOURCES = Object.entries(
  import.meta.glob('../../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
).map(([file, text]) => ({
  path: file.replace('../../src/', ''),
  text: stripComments(text as string),
}));

const MOTION_RUNTIME = stripComments(MOTION_RUNTIME_RAW);
const GLASS_SURFACE = stripComments(GLASS_SURFACE_RAW);
const DOCK_TOKENS = stripComments(DOCK_TOKENS_RAW);

const TAB_BAR = stripComments(TAB_BAR_RAW);
const SCOPE_SWITCH = stripComments(SCOPE_SWITCH_RAW);
const SHELL_MOTION = stripComments(SHELL_MOTION_RAW);
const TABS_LAYOUT = stripComments(TABS_LAYOUT_RAW);

describe('los controles siguen haciendo lo que hacían', () => {
  /**
   * **El dock navega por el router, y ésa es la única fuente de verdad.**
   *
   * Antes lo hacía por el navegador —`navigation.emit` y `navigate`—, porque lo
   * pintaba él. Dejó de pintarlo por una razón física: dentro del árbol nativo
   * de la barra, el cristal de las píldoras no muestrea la escena. Al salir de
   * ahí, el dock deja de tener acceso al navegador y la ruta pasa a ser lo que
   * consulta y lo que cambia.
   *
   * Lo que NO cambia es que siga habiendo una sola verdad: ni la ruta activa ni
   * el destino se guardan en ningún estado paralelo.
   */
  it('el dock navega por el router y no guarda la pestaña activa', () => {
    expect(TAB_BAR).not.toContain('navigation.emit');
    expect(TAB_BAR).not.toContain('BottomTabBarProps');
    // La recibe de quien lo aloja; no la deduce ni la almacena.
    expect(TAB_BAR).toContain('activeRoute: string');
    expect(TAB_BAR).not.toContain('useState');

    expect(TABS_LAYOUT).toContain('usePathname()');
    expect(TABS_LAYOUT).toContain('router.navigate(');
  });

  it('y no se ha colado navegación imperativa nueva', () => {
    // El `+` navega a su ruta y las pestañas las cambia el navegador. Nada más
    // debe empujar el historial desde el dock.
    expect(TAB_BAR.match(/router\.\w+\(/g) ?? []).toHaveLength(1);
    expect(TAB_BAR).not.toContain('router.replace');
  });

  it('el selector de ámbito sigue cambiando el ámbito, y nada más', () => {
    expect(SCOPE_SWITCH).toContain('setScope(target)');
    expect(SCOPE_SWITCH).toContain('nextScope(scope)');
    // No navega: cambiar de contexto no es cambiar de sitio.
    expect(SCOPE_SWITCH).not.toContain('router.');
    expect(SCOPE_SWITCH).not.toContain('navigation.');
  });

  /** Y el resalte sale de esa misma ruta, no de una copia animada. */
  it('el resaltado sale de la ruta, no de una copia', () => {
    expect(TAB_BAR).toContain('focused={destination.route === activeRoute}');
  });

  it('el ámbito lo sigue leyendo del provider, no de un estado propio', () => {
    expect(SCOPE_SWITCH).toContain('useScope()');
    expect(SCOPE_SWITCH).toMatch(/\{t\(SCOPE_LABEL\[scope\]\)\}/);
  });
});

describe('un solo lenguaje de movimiento', () => {
  it('los dos controles usan el mismo muelle, del mismo sitio', () => {
    expect(TAB_BAR).toContain('withSpring(focused ? 1 : 0, SPRING)');
    expect(SCOPE_SWITCH).toContain('SPRING');
    // Y ninguno define el suyo: un segundo muelle es cómo dos controles dejan
    // de pertenecer al mismo sistema sin que nadie lo decida.
    for (const source of [TAB_BAR, SCOPE_SWITCH]) {
      expect(source).not.toMatch(/damping:\s*\d/);
      expect(source).not.toMatch(/stiffness:\s*\d/);
    }
  });

  it('y la misma respuesta al toque', () => {
    expect(TAB_BAR).toContain('usePressScale()');
    expect(SCOPE_SWITCH).toContain('usePressScale()');
    expect(MOTION_RUNTIME).toContain('Motion.press');
  });

  /*
   * El helper se mudó a `ui/theme` cuando dejó de ser sólo del shell: el
   * sistema de diseño lo necesita y `ui/` no puede importar de `features/`.
   * Que `shell-motion.ts` siga existiendo NO es ceremonia — quien lee el dock
   * busca su movimiento ahí—, pero tiene que reexportar y no redeclarar.
   */
  it('y el shell lo reexporta en vez de tener una segunda copia', () => {
    expect(SHELL_MOTION).toContain("from '@/ui/theme/motion-runtime'");
    expect(SHELL_MOTION).not.toContain('useSharedValue');
    expect(SHELL_MOTION).not.toContain('ReduceMotion');
  });

  it('el helper compartido no sabe qué está animando', () => {
    // La frontera que lo mantiene pequeño: si empezara a conocer pills,
    // ámbitos o destinos, sería un framework de animación disfrazado.
    expect(SHELL_MOTION).not.toContain('Destination');
    expect(SHELL_MOTION).not.toContain('Scope');
    expect(SHELL_MOTION).not.toContain('GlassSurface');
  });

  it('el contexto es el registro contenido, la navegación el fuerte', () => {
    // La familia se nota porque comparten curva y difieren en amplitud. Si el
    // selector llegara a moverse tanto como la barra, dejarían de leerse como
    // dos cosas distintas.
    expect(Motion.scope.surfaceScale).toBeLessThan(Motion.destination.iconScale);
    expect(Motion.destination.lift).toBeGreaterThan(0);
  });

  it('la escala de movimiento se queda donde se acordó', () => {
    // Banda, no valor exacto: protege contra un cambio de orden de magnitud
    // —un rebote grande, un zoom— sin congelar el afinado.
    expect(Motion.destination.iconScale).toBeGreaterThan(1);
    expect(Motion.destination.iconScale).toBeLessThanOrEqual(1.08);
    expect(Motion.scope.surfaceScale).toBeLessThanOrEqual(1.08);
    expect(Motion.destination.lift).toBeLessThanOrEqual(4);
    expect(Motion.scope.nudge).toBeLessThanOrEqual(4);
    expect(Motion.screen.travel).toBeLessThanOrEqual(24);
    expect(Motion.screen.duration).toBeLessThanOrEqual(250);
  });

  it('el muelle no rebota: está cerca del amortiguamiento crítico', () => {
    /*
     * Es la diferencia entre táctil y saltarín, y lo saltarín cansa a los
     * pocos minutos de uso real. ratio = c / (2 * sqrt(k * m)).
     */
    const { mass, stiffness, damping } = Motion.spring;
    const ratio = damping / (2 * Math.sqrt(stiffness * mass));
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThanOrEqual(1);
  });
});

describe('Reduce Motion tiene un camino explícito', () => {
  it('se declara UNA vez, donde los números se vuelven animación', () => {
    /*
     * Olvidarlo obliga a no usar `SPRING`/`timing` y a escribir una config a
     * mano, que se ve en un diff. Es lo contrario de un olvido silencioso.
     */
    expect(MOTION_RUNTIME).toContain('ReduceMotion.System');
    expect(MOTION_RUNTIME).toContain('export const SPRING');
    expect(MOTION_RUNTIME).toContain('export function timing');

    // Una sola vez, y se comprueba que lo es: dos declaraciones es como un
    // ajuste de accesibilidad acaba respetado en media aplicación.
    const declara = ALL_SOURCES.filter((file) => file.text.includes('ReduceMotion.System'));
    expect(declara.map((file) => file.path)).toEqual(['ui/theme/motion-runtime.ts']);
  });

  /**
   * Sobre TODO `src/`, y no sobre los dos ficheros del dock.
   *
   * Cuando esta guarda se escribió, el dock era lo único que animaba. Con el
   * `+` hay movimiento en `ui/` y en `features/personal`, y una guarda que
   * mirase sólo donde ya se sabe que está bien no vigila nada.
   */
  it('y ningún componente escribe su propia config sin él', () => {
    for (const { path, text: source } of ALL_SOURCES) {
      if (path === 'ui/theme/motion-runtime.ts') continue;
      // Nada de `withSpring(x, { ... })` ni `withTiming(x, { duration: n })`
      // con un objeto literal: eso se saltaría la declaración compartida.
      expect(source, path).not.toMatch(/withSpring\([^,)]+,\s*\{/);
      expect(source, path).not.toMatch(/withTiming\([^,)]+,\s*\{\s*duration/);
    }
  });

  it('la transición de pantalla se apaga aparte, porque no es de Reanimated', () => {
    expect(TABS_LAYOUT).toContain('useReducedMotion()');
    expect(TABS_LAYOUT).toMatch(/reduceMotion \? 'none' : 'shift'/);
  });

  it('y aun apagada, el cambio de pantalla sigue ocurriendo', () => {
    // `'none'` es la animación, no la navegación: el destino cambia igual.
    expect(TABS_LAYOUT).toContain('<Tabs');
    expect(TABS_LAYOUT).not.toContain('animationEnabled={false}');
  });
});

describe('el contraste no se cae a mitad de la transición', () => {
  it('nunca se anima la opacidad de un cristal traslúcido', () => {
    /*
     * La trampa: hacer fade a la propia `GlassSurface` baja su tinte por
     * debajo del suelo medido y el texto pierde contraste unos 100 ms. No sale
     * en una captura. Lo que se anima es una capa aparte, apilada sobre una
     * base que se queda opaca.
     */
    expect(TAB_BAR).not.toMatch(/<GlassSurface[^>]*style=\{\[[^\]]*(emphasisStyle|contentStyle)/);
    expect(TAB_BAR).toContain('styles.emphasis');
    expect(SCOPE_SWITCH).toContain('styles.sheen');
  });

  it('las capas animadas sólo añaden luz, nunca la quitan', () => {
    // Blanco a baja alfa: el fondo efectivo detrás del texto sólo puede
    // volverse más opaco durante el cruce, jamás menos.
    for (const source of [TAB_BAR_RAW, SCOPE_SWITCH_RAW]) {
      const veils = [...source.matchAll(/backgroundColor: '(rgba\([^)]*\))'/g)].map((m) => m[1]);
      for (const veil of veils) {
        expect(veil).toMatch(/^rgba\(255, 255, 255,/);
      }
    }
  });

  it('la base bajo el texto sigue siendo un cristal opaco de verdad', () => {
    // Si la base dejara de estar por encima del suelo, el cruce ya no tendría
    // garantía ninguna.
    expect(MinGlassTintAlpha).toBeLessThanOrEqual(0.9);
    expect(TAB_BAR).toContain('level="bar"');
  });
});

describe('la pantalla se mueve por el navegador, no alrededor de él', () => {
  it('usa las opciones del propio navegador de tabs', () => {
    expect(TABS_LAYOUT).toContain('animation:');
    expect(TABS_LAYOUT).toContain('sceneStyleInterpolator');
    expect(TABS_LAYOUT).toContain('transitionSpec');
  });

  /**
   * Era la condición para animar la pantalla: si hubiera hecho falta un
   * `PagerView`, un gesture handler o un índice propio, no habría merecido la
   * pena. La dirección la deduce el navegador del índice de pestaña.
   *
   * El layout llama a `router.navigate` —el dock ya no tiene al navegador a
   * mano—, pero eso NO es una segunda fuente de verdad: es la primera. Lo que
   * se sigue prohibiendo es una copia del estado de navegación.
   */
  it('sin pager, sin gestos y sin una segunda fuente de verdad', () => {
    expect(TABS_LAYOUT).not.toContain('PagerView');
    expect(TABS_LAYOUT).not.toContain('GestureDetector');
    expect(TABS_LAYOUT).not.toContain('useState');
    expect(TABS_LAYOUT).not.toMatch(/const \[\w*([Tt]ab|[Ii]ndex|[Aa]ctive)/);
  });

  it('el interpolador se tipa contra el preset que sustituye', () => {
    // Una firma de `Animated` escrita a mano es una copia que envejece en
    // silencio.
    expect(TABS_LAYOUT).toContain('typeof SceneStyleInterpolators.forShift');
  });
});

describe('el amarillo sigue siendo minoritario', () => {
  it('el `+` no se suma a la historia de selección', () => {
    /*
     * Recibe la misma respuesta al toque que los pills —eso es lo que hace que
     * el dock parezca un objeto— pero NO reacciona al cambio de destino: si se
     * moviera con él, parecería una tercera tab.
     */
    const addSection = TAB_BAR.slice(TAB_BAR.indexOf('function AddButton'));
    expect(addSection).toContain('usePressScale()');
    expect(addSection).not.toContain('focused');
    expect(addSection).not.toContain('activeRoute ===');
  });

  it('y ninguna capa animada es amarilla', () => {
    for (const source of [TAB_BAR, SCOPE_SWITCH]) {
      expect(source).not.toContain('FDC506');
      expect(source).not.toMatch(/(emphasis|sheen)[^;]*accent/);
    }
  });
});

/**
 * DÓNDE VIVE EL DOCK.
 *
 * Fuera del navegador, montado por `app/(tabs)/_layout.tsx`. Se llegó ahí
 * persiguiendo un desenfoque bajo las píldoras que se ha descartado, pero la
 * estructura **es la que da la geometría actual**: el navegador no pinta barra
 * ni reserva alto, así que la escena mide la pantalla entera. Devolverla al
 * `tabBar` movería el dock, que es justo lo que no debe pasar.
 */
describe('el host del dock', () => {
  it('el navegador no pinta barra, así que no reserva alto', () => {
    expect(TABS_LAYOUT).toContain('tabBar={() => null}');
  });

  it('y el dock se monta fuera de <Tabs>, como superposición', () => {
    expect(TABS_LAYOUT.indexOf('</Tabs>')).toBeLessThan(TABS_LAYOUT.indexOf('<NomeyDock'));
  });

  /** Una sola implementación de las píldoras y el `+`. No hay dos docks. */
  it('hay un solo dock en toda la aplicación', () => {
    const docks = ALL_SOURCES.filter((f) => f.text.includes('function NomeyDock'));
    expect(docks.map((f) => f.path)).toEqual(['features/shell/nomey-tab-bar.tsx']);
    expect(TABS_LAYOUT.match(/<NomeyDock/g) ?? []).toHaveLength(1);
  });

  /**
   * **El fondo de «Añadir» va DESPUÉS del dock**, así que al abrirse lo cubre y
   * lo desenfoca con el resto de la pantalla en vez de dejarlo nítido encima.
   */
  it('el fondo de «Añadir» queda por encima del dock', () => {
    expect(TABS_LAYOUT.indexOf('<NomeyDock')).toBeLessThan(TABS_LAYOUT.indexOf('<AddBackdrop'));
  });
});

/**
 * El dock flota, y el contenido pasa por detras NÍTIDO.
 *
 * El navegador de pestanas coloca en columna: el contenedor de escenas con
 * `flex: 1` y, debajo, la barra. Sin sacarla del flujo la pantalla TERMINA
 * donde empieza el dock, y la ultima fila de una lista queda tapada para
 * siempre. Absoluta, la barra sale de la columna y el contenido pasa por
 * detras. Es lo que hace la barra que trae React Navigation cuando se la
 * declara absoluta.
 */
describe('el dock flota sobre el contenido', () => {
  it('la barra no ocupa sitio en la columna del navegador', () => {
    const dock = /dock: {([^}]*)}/.exec(TAB_BAR)?.[1];
    expect(dock).toContain("position: 'absolute'");
    expect(dock).toContain('bottom: 0');
  });

  /**
   * **Y el hueco de scroll sigue siendo de cada pantalla.** Son dos cosas
   * distintas: el dock deja de reservar espacio, y el `paddingBottom` sigue
   * dejando que la ultima tarjeta suba por encima de el y se vea entera. Sin
   * esa reserva, el ultimo elemento quedaria tapado para siempre.
   */
  it('pero cada pantalla sigue reservando su hueco para la ultima fila', () => {
    for (const pantalla of ['app/(tabs)/index.tsx', 'app/(tabs)/groups.tsx']) {
      const fuente = ALL_SOURCES.find((f) => f.path === pantalla);
      expect(fuente?.text, pantalla).toContain('paddingBottom: DOCK_HEIGHT + insets.bottom');
    }
  });
});

/**
 * **El dock inferior no lleva desenfoque, y es una decisión cerrada.**
 *
 * Se intentó dos veces: primero con el efecto dentro de `GlassSurface`, y
 * después en una capa aparte, recortada a dos ventanas medidas contra las
 * píldoras. Ninguna llegó a desenfocar sobre el aparato — la segunda ni
 * siquiera llegó a dibujarse—, y en vez de dejar el andamio apagado se retiró
 * entero: el fichero de las ventanas, el contexto de marcos, la medición, los
 * dos interruptores de diagnóstico y la capacidad opcional de `GlassSurface`,
 * que no tenía ningún otro consumidor.
 *
 * Estas guardas no protegen una técnica. Protegen la decisión: **Inicio,
 * Grupos y lo que pasa por detrás se ven nítidos**, y lo que se retiró no
 * vuelve por descuido. El desenfoque de «Añadir movimiento» es otra cosa, está
 * aprobado, y tiene sus propias guardas.
 */
describe('el dock inferior se ve nítido', () => {
  it('ninguna pieza del dock pide desenfoque ni degradado', () => {
    for (const fuente of [TAB_BAR, DOCK_TOKENS]) {
      expect(fuente).not.toContain('BlurView');
      expect(fuente).not.toContain('backdropBlur');
      expect(fuente).not.toContain('LinearGradient');
      expect(fuente).not.toContain('MaskedView');
    }
    // Y el host tampoco cuela una capa entre la escena y el dock.
    expect(TABS_LAYOUT).not.toContain('BlurView');
    expect(TABS_LAYOUT.indexOf('</Tabs>')).toBeLessThan(TABS_LAYOUT.indexOf('<NomeyDock'));
  });

  /**
   * Lo que se borró está borrado, no apagado. Un interruptor a `false` deja el
   * código vivo y la pregunta abierta; esto la cierra.
   */
  it('no queda nada del experimento, ni apagado', () => {
    const restos = [
      'DockBlurWindows',
      'DOCK_BLUR',
      'diagnosticNoTint',
      'diagnosticShowBlurBounds',
      'useDockFrames',
      'measureLayout',
      'FadeEdge',
    ];
    for (const resto of restos) {
      const donde = ALL_SOURCES.filter((f) => f.text.includes(resto)).map((f) => f.path);
      expect(donde, resto).toEqual([]);
    }
  });

  /** Ni los marcadores de la prueba, que eran colores que nadie elegiría. */
  it('no queda ningún marcador de diagnóstico', () => {
    for (const fuente of ALL_SOURCES) {
      expect(fuente.text, fuente.path).not.toContain('#00FFFF');
      expect(fuente.text, fuente.path).not.toContain('#FF00FF');
      expect(fuente.text, fuente.path).not.toContain('[dock]');
    }
  });

  /**
   * `GlassSurface` vuelve a tener una sola manera de pintarse. La capacidad
   * opcional existía para el dock y sólo para él: sin consumidor, era API
   * muerta que el siguiente lector tomaría por una alternativa disponible.
   */
  it('GlassSurface no conserva API muerta', () => {
    expect(GLASS_SURFACE).not.toContain('backdropBlur');
    expect(GLASS_SURFACE).not.toContain('BlurView');
    // Y el tinte del nivel vuelve a pintarse sin condición.
    expect(GLASS_SURFACE).toContain('backgroundColor: token.tint');
  });

  /**
   * **El desenfoque de «Añadir movimiento» NO se toca.** Es la única pieza que
   * sí funciona sobre el aparato, está aprobada, y la decisión de retirar el
   * del dock no la alcanza.
   */
  it('el fondo de «Añadir» sigue entero', () => {
    const fondo = ALL_SOURCES.find((f) => f.path === 'features/shell/add-backdrop.tsx');
    expect(fondo?.text).toContain('BACKDROP_ENABLED = true');
    // El desenfoque lo pone el `Scrim`, que es donde vive desde el principio.
    expect(fondo?.text).toContain('<Scrim target={target} />');
    const scrim = ALL_SOURCES.find((f) => f.path === 'ui/components/scrim.tsx');
    expect(scrim?.text).toContain('<BlurView');
    expect(scrim?.text).toContain('intensity={70}');
    expect(TABS_LAYOUT).toContain('<AddBackdrop target={blurTarget} />');
    expect(TABS_LAYOUT.indexOf('<NomeyDock')).toBeLessThan(TABS_LAYOUT.indexOf('<AddBackdrop'));
  });

  /**
   * Y el token del nivel `bar` se queda como estaba: lo comparte el selector de
   * clase de «Añadir movimiento», que está aprobado.
   */
  it('el token del nivel bar se queda como estaba', () => {
    expect(Glass.bar.tint).toBe('rgba(24, 24, 27, 0.90)');
  });

  /** Y las píldoras lo usan tal cual, sin tinte propio ni transparencias. */
  it('las píldoras usan la superficie normal del nivel bar', () => {
    expect(TAB_BAR).toContain('level="bar"');
    expect(TAB_BAR).toContain('style={styles.pill}');
    expect(TAB_BAR).not.toContain("backgroundColor: 'transparent'");
    expect(TAB_BAR).not.toContain('Glass.bar.tint.replace');
  });
});

/**
 * EL DESENFOQUE DE ANDROID NECESITA UN OBJETIVO, Y AQUÍ SE FIJA CUÁL.
 *
 * iOS desenfoca lo que tiene detrás por composición del sistema. El método de
 * Android no puede: dibuja a partir de una vista concreta, y sin ella avisa
 * —«blurTarget prop has not been configured»— y **degrada a `none`**, que es un
 * relleno semitransparente. Sin objetivo no había desenfoque en Android, sólo
 * oscurecimiento — justo el efecto que el `Scrim` existe para no hacer.
 */
describe('el objetivo del desenfoque en Android', () => {
  const fuente = (ruta: string) => ALL_SOURCES.find((f) => f.path === ruta)?.text ?? '';
  const SCRIM = fuente('ui/components/scrim.tsx');
  const FONDO = fuente('features/shell/add-backdrop.tsx');
  const LAYOUT = fuente('app/(tabs)/_layout.tsx');

  /** Ningún `BlurView` con método activo se monta sin decir qué desenfoca. */
  it('el BlurView recibe siempre su objetivo', () => {
    expect(SCRIM).toContain('<BlurView');
    expect(SCRIM).toContain('blurTarget={target}');
    // Y el método sigue siendo el de Android 12+, por su prop vigente.
    expect(SCRIM).toContain("'dimezisBlurViewSdk31Plus'");
    expect(SCRIM).toContain('blurMethod=');
    expect(SCRIM).not.toContain('experimentalBlurMethod');
  });

  /** El objetivo lo pone quien sabe qué hay detrás, y viaja como prop. */
  it('el objetivo viene de fuera, no lo inventa el Scrim', () => {
    expect(SCRIM).toContain('target?: RefObject<View | null>');
    expect(FONDO).toContain('<Scrim target={target} />');
    expect(LAYOUT).toContain('<AddBackdrop target={blurTarget} />');
  });

  /**
   * **EL FONDO NO ES SU PROPIO OBJETIVO.** Envolver el `BlurView` en lo que
   * pretende desenfocar lo haría desenfocarse a sí mismo. El objetivo cubre las
   * pestañas y el dock —lo que el fondo tapa al abrirse— y el fondo queda
   * FUERA, como hermano.
   */
  it('el objetivo envuelve lo de detrás y deja el fondo fuera', () => {
    expect(LAYOUT).toContain('<BlurTarget target={blurTarget}>');
    const dentro = LAYOUT.slice(LAYOUT.indexOf('<BlurTarget'), LAYOUT.indexOf('</BlurTarget>'));
    expect(dentro).toContain('<Tabs');
    expect(dentro).toContain('<NomeyDock');
    expect(dentro).not.toContain('<AddBackdrop');
    // Y el fondo se monta después de cerrarlo.
    expect(LAYOUT.indexOf('</BlurTargetView>')).toBeLessThan(LAYOUT.indexOf('<AddBackdrop'));
  });

  /** Un solo objetivo para el único BlurView: no se multiplican. */
  it('hay un solo objetivo y un solo BlurView', () => {
    expect(LAYOUT.match(/<BlurTarget /g) ?? []).toHaveLength(1);
    const conBlur = ALL_SOURCES.filter((f) => f.text.includes('<BlurView'));
    expect(conBlur.map((f) => f.path)).toEqual(['ui/components/scrim.tsx']);
  });

  /**
   * **Y EN iOS NO ENVUELVE NADA.** El objetivo sólo lo necesita Android, así que
   * su variante de iOS devuelve los hijos tal cual: el árbol de iOS queda como
   * estaba, sin una vista de más. Un envoltorio «neutro» sigue siendo una vista.
   */
  it('en iOS el objetivo no añade ninguna vista', () => {
    const iOS = fuente('features/shell/blur-target.tsx');
    const android = fuente('features/shell/blur-target.android.tsx');
    expect(iOS).toContain('return <>{children}</>');
    expect(iOS).not.toContain('BlurTargetView');
    expect(android).toContain('<BlurTargetView ref={target}');
    expect(android).toMatch(/fill: \{\s*flex: 1,\s*\}/);
  });
});
