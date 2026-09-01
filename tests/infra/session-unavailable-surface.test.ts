import { describe, expect, it } from 'vitest';

import { isPublic, isSignedIn, UNAVAILABLE } from '../../src/features/session/session-state';

/**
 * Qué se ve cuando la sesión no se pudo comprobar.
 *
 * **La regresión de un fallo real en iPhone.** `sign-in.tsx` devolvía pronto en
 * `unavailable` y pintaba el error SOLO, así que con el backend inalcanzable la
 * app llegaba a la rama pública —correctamente— y allí no había formulario:
 * únicamente «No hemos podido comprobar tu sesión». Un fallo recuperable de diez
 * segundos se convertía en una pantalla sin salida.
 *
 * Y el aviso no describía lo que estaba pasando. Medido con el cliente real
 * contra un stack real:
 *
 *   sesión válida ................................ `signed-in`  en   2 ms
 *   sin sesión ................................... `signed-out` en   0 ms
 *   sesión inválida (refresh revocado) ........... `signed-out` en  10 ms, y
 *                                                  el almacenamiento QUEDA VACÍO
 *   sesión caducada con refresh válido ........... `signed-in`  en 120 ms
 *   host inalcanzable ............................ `unavailable` a los 10 s, y
 *                                                  la sesión se CONSERVA
 *
 * Es decir: `unavailable` significa «no hemos podido mirar si había sesión
 * guardada», y no dice nada sobre si entrar con email y contraseña funcionaría.
 * Una sesión demostrablemente inválida no llega nunca aquí — se resuelve a
 * `signed-out` en milisegundos y se descarta sola.
 *
 * Se comprueba sobre el fuente porque no hay renderer de componentes en el
 * proyecto, y porque lo que hay que fijar es estructural: que el formulario no
 * desaparezca.
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
  const found = FILES.find((candidate) => candidate.path === relative);
  expect(found, `falta ${relative}`).toBeDefined();
  return found!.text;
}

/**
 * El fuente sin comentarios.
 *
 * Necesario cuando lo que se persigue es código y no una palabra: esta pantalla
 * **documenta** que no hay `router.replace` y por qué, así que buscar el
 * término en el fichero entero encuentra la explicación, no el defecto.
 */
function code(relative: string): string {
  return file(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const SIGN_IN = file('app/(auth)/sign-in.tsx');
const SIGN_IN_CODE = code('app/(auth)/sign-in.tsx');

describe('el routing sigue mandando `unavailable` a la rama pública', () => {
  /**
   * La dirección segura, y no se toca: enseñar la pantalla de entrar a quien
   * resulte estar dentro es una molestia pequeña; lo contrario montaría
   * pantallas de producto para alguien a quien no hemos podido identificar.
   */
  it('`unavailable` es rama pública y NUNCA rama protegida', () => {
    expect(isPublic(UNAVAILABLE)).toBe(true);
    expect(isSignedIn(UNAVAILABLE)).toBe(false);
  });
});

describe('la pantalla de entrar en `unavailable`', () => {
  /**
   * **La regresión.** Un `return` temprano antes del formulario es exactamente
   * el defecto: deja al usuario sin nada que pulsar salvo «Reintentar».
   */
  it('no devuelve pronto sustituyendo la pantalla entera', () => {
    const early = /if\s*\(\s*session\.status === 'unavailable'\s*\)\s*\{\s*return/;
    expect(SIGN_IN).not.toMatch(early);
  });

  it('sigue conociendo el estado y lo trata explícitamente', () => {
    expect(SIGN_IN).toContain("session.status === 'unavailable'");
  });

  /**
   * El aviso sigue estando —no se oculta el error— y conserva su reintento,
   * que reinicia el ciclo de vida entero.
   */
  it('mantiene el aviso visible y su reintento', () => {
    expect(SIGN_IN).toContain('session.unavailableTitle');
    expect(SIGN_IN).toContain('session.unavailableBody');
    expect(SIGN_IN).toMatch(/retry=\{\{\s*label: t\('action\.retry'\),\s*onPress: retry\s*\}\}/);
  });

  /**
   * Y el formulario está: los dos campos y el botón de entrar se renderizan
   * pase lo que pase con la restauración.
   */
  it('el formulario y su botón siguen renderizándose', () => {
    expect(SIGN_IN).toContain("t('auth.email')");
    expect(SIGN_IN).toContain("t('auth.password')");
    expect(SIGN_IN).toContain("t('auth.signInAction')");
    expect(SIGN_IN).toContain('href="/(auth)/sign-up"');
  });

  /**
   * El aviso va DENTRO del andamio de la pantalla, no en un contenedor propio
   * que se coma el layout de teclado que F5.C1 ajustó.
   */
  it('el aviso vive dentro del andamio de la pantalla de auth', () => {
    const scaffold = SIGN_IN.indexOf('<AuthScreen>');
    const notice = SIGN_IN.indexOf('session.unavailableTitle');
    expect(scaffold).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(scaffold);
  });
});

describe('lo que este arreglo NO hace', () => {
  /**
   * Ninguna de las salidas fáciles que estaban prohibidas: ni dar por
   * autenticado, ni saltarse la comprobación, ni caer a Inicio en silencio.
   */
  it('no da por autenticado a nadie ni navega a la rama protegida', () => {
    // Sobre el CÓDIGO: la pantalla documenta por extenso que no navega, y esa
    // explicación no es el defecto.
    expect(SIGN_IN_CODE).not.toContain('router.replace');
    expect(SIGN_IN_CODE).not.toContain('(tabs)');
    expect(SIGN_IN_CODE).not.toContain("'signed-in'");
  });

  /**
   * Y no se toca el watchdog: sigue siendo el de F5.B. Subirlo habría escondido
   * el síntoma sin arreglar nada, y bajarlo habría llamado fallo a una
   * restauración lenta legítima.
   */
  it('el watchdog sigue en sus diez segundos', () => {
    expect(file('features/session/session-lifecycle.ts')).toContain('DEFAULT_WATCHDOG_MS = 10_000');
  });
});
