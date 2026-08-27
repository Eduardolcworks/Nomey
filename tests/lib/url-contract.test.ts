import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

/**
 * El contrato de `URL` que exige `@supabase/supabase-js`, y por el que existe
 * `react-native-url-polyfill`.
 *
 * El constructor de `SupabaseClient` hace esto **antes de mirar ninguna
 * opción** (`dist/index.cjs:626`):
 *
 *     this.realtimeUrl = new URL('realtime/v1', baseUrl);
 *     this.realtimeUrl.protocol = this.realtimeUrl.protocol.replace('http', 'ws');
 *
 * El `URL` que React Native 0.86 instala como global tiene **un solo setter en
 * todo el fichero, `set search`**; `protocol` es getter puro. En strict mode
 * —y el cuerpo de una clase siempre lo es— esa asignación lanza.
 *
 * **Qué prueba este fichero y qué no.** No se puede importar el polyfill aquí:
 * su entrada `auto` importa `Platform` de `react-native`, que no existe en
 * Vitest. Y copiar su implementación para probarla sería probar el polyfill, no
 * a Nomey. Así que se prueban las dos cosas que sí son nuestras:
 *
 * 1. **El requisito**, contra el `URL` del entorno: qué tiene que cumplir
 *    cualquier implementación para que el cliente se construya. Si algún día
 *    `supabase-js` dejara de exigirlo, el control negativo lo dirá.
 * 2. **Que el arranque sigue conectado**: que `client.ts` importa el bootstrap
 *    y que el bootstrap importa el polyfill. Es la parte que alguien puede
 *    borrar creyendo que sobra.
 *
 * Lo que **solo** puede comprobar el dispositivo es que el polyfill esté activo
 * en Hermes. Eso es la sonda de F5.A, no esto.
 */

const SOURCES = import.meta.glob('../../src/lib/supabase/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function source(name: string): string {
  const entry = Object.entries(SOURCES).find(([path]) => path.endsWith(`/${name}`));
  if (entry === undefined) throw new Error(`No se encontró src/lib/supabase/${name}`);
  return entry[1] as string;
}

const BASE = 'http://192.168.0.10:54321';

describe('el contrato de URL que supabase-js da por hecho', () => {
  it('resuelve una ruta relativa contra la base', () => {
    expect(new URL('realtime/v1', BASE).toString()).toBe(`${BASE}/realtime/v1`);
  });

  it('deja cambiar `protocol` de http a ws', () => {
    const url = new URL('realtime/v1', BASE);

    expect(() => {
      url.protocol = url.protocol.replace('http', 'ws');
    }).not.toThrow();

    expect(url.protocol).toBe('ws:');
    expect(url.toString()).toMatch(/^ws:\/\//);
  });

  it('y con eso el cliente se construye', () => {
    expect(() => createClient(BASE, 'sb_publishable_contract_probe')).not.toThrow();
  });
});

describe('control negativo: por qué hace falta el polyfill', () => {
  /**
   * Un `URL` con la forma del de React Native en lo único que importa aquí:
   * `protocol` es un getter sin setter. No es una copia del de RN ni del
   * polyfill — es el mínimo que reproduce el fallo.
   */
  /*
   * `SpecURL` is captured before anything is swapped. Without it the class
   * would build its inner value with whatever `URL` is global at call time -
   * itself, once installed - and recurse until the stack gives out. That looks
   * like a completely different failure, and it is not the one being
   * documented here.
   */
  const SpecURL = globalThis.URL;

  class GetterOnlyProtocolURL {
    private readonly inner: URL;

    constructor(url: string, base?: string) {
      this.inner = base === undefined ? new SpecURL(url) : new SpecURL(url, String(base));
    }

    get protocol(): string {
      return this.inner.protocol;
    }

    get hostname(): string {
      return this.inner.hostname;
    }

    toString(): string {
      return this.inner.toString();
    }
  }

  it('sin un `protocol` asignable, createClient lanza TypeError', () => {
    const spec = globalThis.URL;
    globalThis.URL = GetterOnlyProtocolURL as unknown as typeof URL;

    try {
      expect(() => createClient(BASE, 'sb_publishable_contract_probe')).toThrow(TypeError);
    } finally {
      globalThis.URL = spec;
    }
  });

  it('y vuelve a construirse en cuanto `URL` cumple el contrato', () => {
    expect(() => createClient(BASE, 'sb_publishable_contract_probe')).not.toThrow();
  });
});

describe('el polyfill sigue enchufado al arranque', () => {
  it('el bootstrap importa el polyfill', () => {
    expect(source('bootstrap.ts')).toMatch(/^import 'react-native-url-polyfill\/auto';$/m);
  });

  it('el cliente importa el bootstrap', () => {
    expect(source('client.ts')).toMatch(/^import '\.\/bootstrap';$/m);
  });

  it('nadie más lo importa: un único punto de arranque', () => {
    const elsewhere = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('/bootstrap.ts'))
      .filter(([, text]) => (text as string).includes("from 'react-native-url-polyfill"))
      .map(([path]) => path);

    expect(elsewhere).toEqual([]);
  });
});
