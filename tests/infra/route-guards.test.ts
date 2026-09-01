import { describe, expect, it } from 'vitest';

import LAYOUT from '../../src/app/_layout.tsx?raw';

/**
 * Qué rama de la app es alcanzable, y cuándo.
 *
 * Se lee el layout raíz en vez de renderizarlo: no hay renderer de React en el
 * proyecto, y montar expo-router para esto sería probar expo-router. Lo que
 * importa aquí es **la política** —qué pantalla vive detrás de qué guarda— y
 * eso sí está en el fuente.
 *
 * El fallo que previene es concreto y silencioso: alguien añade una ruta de
 * producto nueva, la registra fuera de cualquier `Stack.Protected`, y esa
 * pantalla queda alcanzable sin sesión. No rompe nada visible, porque el
 * backend seguirá respondiendo 42501 — pero enseña una pantalla de producto a
 * quien no ha entrado, que es exactamente lo que este bloque viene a impedir.
 *
 * **`Stack.Protected` no es seguridad**, y este test tampoco lo comprueba. La
 * autorización es la RLS. Esto es navegación.
 */

/** Los ficheros de `src/app/` que expo-router convierte en ruta de primer nivel. */
const ROUTE_FILES = import.meta.glob('../../src/app/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * Los ficheros de `src/app/` que NO son pantallas.
 *
 * `_layout` compone; los que empiezan por `+` son ficheros especiales de
 * expo-router —hoy `+native-intent`, que decide qué URLs entrantes son
 * navegables y cuál no—. Ninguno se registra en una guarda porque ninguno se
 * monta: exigirles una sería exigir que existiera una pantalla que no existe.
 */
const NOT_A_SCREEN = (name: string) => name === '_layout' || name.startsWith('+');

const ROUTE_NAMES = Object.keys(ROUTE_FILES)
  .map((path) => path.replace('../../src/app/', '').replace('.tsx', ''))
  .filter((name) => !NOT_A_SCREEN(name));

/** Cada bloque `<Stack.Protected guard={…}>` con los `name` que registra. */
function protectedBlocks(): { guard: string; screens: string[] }[] {
  const blocks = [
    ...LAYOUT.matchAll(/<Stack\.Protected\s+guard=\{([^}]*)\}>([\s\S]*?)<\/Stack\.Protected>/g),
  ];

  return blocks.map((match) => ({
    guard: match[1].replace(/\s+/g, ' ').trim(),
    screens: [...match[2].matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((screen) => screen[1]),
  }));
}

/** Pantallas registradas fuera de cualquier bloque protegido. */
function unguardedScreens(): string[] {
  const withoutBlocks = LAYOUT.replace(/<Stack\.Protected[\s\S]*?<\/Stack\.Protected>/g, '');
  return [...withoutBlocks.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((match) => match[1]);
}

describe('guardas de ruta del layout raíz', () => {
  const blocks = protectedBlocks();
  const registered = blocks.flatMap((block) => block.screens);

  it('el layout se lee y usa `Stack.Protected`', () => {
    expect(LAYOUT).toContain('Stack.Protected');
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });

  it('NINGUNA pantalla queda registrada fuera de una guarda', () => {
    expect(unguardedScreens()).toEqual([]);
  });

  describe('la rama pública', () => {
    const publicBlock = blocks.find((block) => block.guard.includes('isPublic'));

    it('existe y la decide `isPublic`', () => {
      expect(publicBlock).toBeDefined();
    });

    it('contiene el grupo `(auth)` y nada más', () => {
      expect(publicBlock?.screens).toEqual(['(auth)']);
    });
  });

  describe('la rama protegida', () => {
    const productBlock = blocks.find(
      (block) => block.guard.includes('isSignedIn') && !block.guard.includes('__DEV__'),
    );

    it('existe y la decide `isSignedIn`', () => {
      expect(productBlock).toBeDefined();
    });

    it('contiene las tabs y todas las rutas de producto', () => {
      expect(productBlock?.screens).toEqual([
        '(tabs)',
        'add',
        'edit-movement',
        'edit-balance',
        'notifications',
        'profile',
        'account',
      ]);
    });

    it('`account` está dentro, y no en la pública', () => {
      // La pantalla que enseña nombre y email y cierra la sesión. Si acabara
      // en la rama pública sería una pantalla de cuenta sin cuenta.
      expect(productBlock?.screens).toContain('account');
      const publicBlock = blocks.find((block) => block.guard.includes('isPublic'));
      expect(publicBlock?.screens).not.toContain('account');
    });

    it('`(auth)` no está en ella', () => {
      expect(productBlock?.screens).not.toContain('(auth)');
    });
  });

  describe('las rutas de desarrollo', () => {
    const devBlock = blocks.find((block) => block.guard.includes('__DEV__'));

    it('están detrás de `__DEV__` **y** de la sesión', () => {
      expect(devBlock).toBeDefined();
      expect(devBlock?.guard).toContain('isSignedIn');
      expect(devBlock?.guard).toContain('__DEV__');
    });

    it('son exactamente las tres conocidas', () => {
      expect(devBlock?.screens.sort()).toEqual(['diagnostics', 'session-probe', 'states']);
    });

    it('ninguna vive en la rama pública: no son una puerta para saltarse el acceso', () => {
      const publicBlock = blocks.find((block) => block.guard.includes('isPublic'));
      for (const dev of ['diagnostics', 'states', 'session-probe']) {
        expect(publicBlock?.screens).not.toContain(dev);
      }
    });
  });

  it('toda ruta de primer nivel del disco está registrada en alguna guarda', () => {
    // Si alguien añade `src/app/algo.tsx` y no lo registra, expo-router lo
    // sirve igual — y quedaría fuera de las dos ramas.
    const missing = ROUTE_NAMES.filter((name) => !registered.includes(name));
    expect(missing).toEqual([]);
  });

  describe('mientras se restaura', () => {
    it('el navegador no se monta: se sale antes con un return', () => {
      // Las dos guardas en false dejarían un Stack sin pantallas disponibles.
      // La regla de producto es más fuerte que eso: ninguna rama se monta.
      expect(LAYOUT).toMatch(/if\s*\(!resolved\)\s*\{\s*return/);
    });

    it('y el splash se suelta con CUALQUIER resolución, no solo con la buena', () => {
      // Un splash que solo se levanta al acertar es un splash que se puede
      // quedar puesto para siempre.
      expect(LAYOUT).toMatch(/if\s*\(!resolved\)\s*return;[\s\S]*hideAsync/);
    });
  });
});
