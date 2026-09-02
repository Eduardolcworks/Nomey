import { describe, expect, it } from 'vitest';

import { CATEGORY_ICON_KEYS, categorySymbol } from '../../src/ui/theme/category-palette';
import { Symbols } from '../../src/ui/theme/symbols';

/**
 * QUE NINGÚN ICONO SE QUEDE SIN LADO ANDROID.
 *
 * `SymbolView` acepta un nombre de SF Symbol suelto o un par `{ ios, android }`,
 * y esa union es una trampa: una cadena suelta **es** un nombre de Apple, así
 * que en Android no hay nada que resolver y el icono cae en su recuadro de
 * respaldo. Compila, pasa los tipos, se ve perfecto en el iPhone y deja media
 * aplicación sin iconos en el emulador. Fue exactamente lo que pasó.
 *
 * **Esto no busca cadenas en el fuente.** Recorre los registros de verdad y
 * valida cada nombre Android contra `symbols.json` de `expo-symbols`, que es el
 * vocabulario que el aparato podrá resolver — 4055 nombres. Un nombre inventado
 * por parecerse a su SF Symbol falla aquí, no en el emulador.
 *
 * Y no se valida sólo lo que hoy se usa: se valida el registro entero, porque
 * lo que hoy no se usa es lo que mañana se pone sin mirar.
 */

/*
 * Se lee crudo y no por `import`: `expo-symbols` no publica ese fichero en sus
 * `exports`, y el objetivo es precisamente comprobar contra el catalogo que
 * el paquete instalado lleva dentro — no contra una copia nuestra, que podria
 * envejecer sin que nadie se enterara.
 */
const CRUDO = import.meta.glob('../../node_modules/expo-symbols/build/android/symbols.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const VOCABULARIO: ReadonlySet<string> = new Set(
  Object.keys(JSON.parse(Object.values(CRUDO)[0] ?? '{}') as Record<string, unknown>),
);

describe('el vocabulario Android de expo-symbols', () => {
  /**
   * Sin esto la prueba se volvería vacía en silencio el día que el paquete mueva
   * ese fichero — que es justo el modo de fallo contra el que existe.
   */
  it('está disponible y es el catálogo de Material', () => {
    expect(VOCABULARIO.size).toBeGreaterThan(1000);
    for (const conocido of ['home', 'edit', 'delete', 'close', 'notifications']) {
      expect(VOCABULARIO.has(conocido), conocido).toBe(true);
    }
    // Son dos vocabularios distintos, y por eso traducir por parecido no vale:
    // ninguno de estos nombres de Apple existe en Material.
    for (const deApple of ['pencil', 'xmark', 'trash', 'bell']) {
      expect(VOCABULARIO.has(deApple), deApple).toBe(false);
    }
  });

  /**
   * **Y EL CASO PEOR NO ES EL QUE FALTA, sino el que existe y no significa lo
   * mismo.** `house` es un nombre válido de Material —una casa como forma— pero
   * el icono de «Inicio» es `home`. Copiar el nombre de Apple al lado Android
   * habría dado ahí un icono que se pinta, se ve y está mal, sin que ninguna
   * comprobación de existencia lo notara.
   */
  it('un nombre valido en los dos catalogos no significa lo mismo', () => {
    expect(VOCABULARIO.has('house')).toBe(true);
    expect(Symbols.home.ios).toBe('house');
    expect(Symbols.home.android).toBe('home');
  });
});

describe('los símbolos de la interfaz', () => {
  const entradas = Object.entries(Symbols);

  it('el registro no está vacío y cubre la interfaz', () => {
    expect(entradas.length).toBeGreaterThan(20);
  });

  it.each(entradas)('%s tiene sus dos lados', (clave, par) => {
    expect(par.ios, `${clave}.ios`).toBeTruthy();
    expect(par.android, `${clave}.android`).toBeTruthy();
  });

  it.each(entradas)('%s resuelve a un símbolo Material real', (clave, par) => {
    expect(VOCABULARIO.has(par.android as string), `${clave} → ${par.android}`).toBe(true);
  });

  /**
   * **El lado Android no es el de Apple con otro formato.** Si alguien copia el
   * nombre iOS al lado Android, el icono desaparece en el emulador y aquí no se
   * notaría comprobando sólo que existe: `bolt` y `key` valen en los dos
   * catálogos, y son legítimos. Lo que no puede pasar es que un nombre con
   * puntos —la forma de Apple— acabe en el lado Android.
   */
  it.each(entradas)('%s no lleva un nombre de Apple en el lado Android', (clave, par) => {
    expect(par.android as string, clave).not.toContain('.');
  });
});

describe('los símbolos de las categorías', () => {
  it.each(CATEGORY_ICON_KEYS)('%s resuelve a un símbolo Material real', (clave) => {
    const par = categorySymbol(clave);
    expect(par.ios, `${clave}.ios`).toBeTruthy();
    expect(par.android, `${clave}.android`).toBeTruthy();
    expect(VOCABULARIO.has(par.android as string), `${clave} → ${par.android}`).toBe(true);
  });

  /** Y una clave que esta versión no conozca cae en el genérico, no en vacío. */
  it('una clave desconocida sigue dando un par válido', () => {
    const par = categorySymbol('clave-que-no-existe');
    expect(VOCABULARIO.has(par.android as string)).toBe(true);
  });
});
