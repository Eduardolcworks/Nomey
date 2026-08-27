import { describe, expect, it } from 'vitest';

import TAB_BAR_RAW from '../../src/features/shell/nomey-tab-bar.tsx?raw';
import SCOPE_SWITCH_RAW from '../../src/features/shell/scope-switch.tsx?raw';
import SHELL_MOTION_RAW from '../../src/features/shell/shell-motion.ts?raw';
import TABS_LAYOUT_RAW from '../../src/app/(tabs)/_layout.tsx?raw';
import { Motion } from '../../src/ui/theme/motion';
import { MinGlassTintAlpha } from '../../src/ui/theme/elevation';

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

const TAB_BAR = stripComments(TAB_BAR_RAW);
const SCOPE_SWITCH = stripComments(SCOPE_SWITCH_RAW);
const SHELL_MOTION = stripComments(SHELL_MOTION_RAW);
const TABS_LAYOUT = stripComments(TABS_LAYOUT_RAW);

describe('los controles siguen haciendo lo que hacían', () => {
  it('la barra sigue navegando por el navegador, no por el router', () => {
    // El fallo que evita: alguien envuelve el pill en algo animado y de paso
    // cambia la navegación por un `router.push`, que se saltaría el evento
    // `tabPress` y la lógica de "ya estoy en esta tab".
    expect(TAB_BAR).toContain('navigation.emit({');
    expect(TAB_BAR).toContain("type: 'tabPress'");
    expect(TAB_BAR).toContain('navigation.navigate(state.routes[index].name)');
    expect(TAB_BAR).toContain('event.defaultPrevented');
  });

  it('y no se ha colado navegación imperativa nueva', () => {
    // El único `router.push` legítimo de este fichero es el del botón `+`,
    // que abre el modal de añadir. No debe haber otro.
    const pushes = [...TAB_BAR.matchAll(/router\.push\(/g)];
    expect(pushes).toHaveLength(1);
    expect(TAB_BAR).toContain("pathname: '/add'");
    expect(TAB_BAR).not.toContain('router.replace');
  });

  it('el selector de ámbito sigue cambiando el ámbito, y nada más', () => {
    expect(SCOPE_SWITCH).toContain('setScope(target)');
    expect(SCOPE_SWITCH).toContain('nextScope(scope)');
    // No navega: cambiar de contexto no es cambiar de sitio.
    expect(SCOPE_SWITCH).not.toContain('router.');
    expect(SCOPE_SWITCH).not.toContain('navigation.');
  });

  it('el estado activo sigue siendo el del navegador, no una copia animada', () => {
    /*
     * La regresión concreta: guardar el índice activo en un shared value para
     * animar y acabar pintando desde él. Serían dos respuestas a «dónde
     * estoy» que pueden discrepar durante la transición.
     */
    expect(TAB_BAR).toContain('focused={state.index === index}');
    expect(TAB_BAR).toContain('accessibilityState={{ selected: focused }}');
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
    expect(SHELL_MOTION).toContain('Motion.press');
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
    expect(SHELL_MOTION).toContain('ReduceMotion.System');
    expect(SHELL_MOTION).toContain('export const SPRING');
    expect(SHELL_MOTION).toContain('export function timing');
  });

  it('y ningún componente escribe su propia config sin él', () => {
    for (const source of [TAB_BAR, SCOPE_SWITCH]) {
      // Nada de `withSpring(x, { ... })` ni `withTiming(x, { duration: n })`
      // con un objeto literal: eso se saltaría la declaración compartida.
      expect(source).not.toMatch(/withSpring\([^,)]+,\s*\{/);
      expect(source).not.toMatch(/withTiming\([^,)]+,\s*\{\s*duration/);
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

  it('sin pager, sin gestos y sin una segunda fuente de verdad', () => {
    /*
     * Era la condición para animar la pantalla: si hubiera hecho falta un
     * PagerView, un gesture handler o un índice propio, no habría merecido la
     * pena. La dirección la deduce el navegador del índice de tab.
     */
    expect(TABS_LAYOUT).not.toContain('PagerView');
    expect(TABS_LAYOUT).not.toContain('GestureDetector');
    expect(TABS_LAYOUT).not.toContain('useState');
    expect(TABS_LAYOUT).not.toContain('router.');
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
