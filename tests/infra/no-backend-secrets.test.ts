import { describe, expect, it } from 'vitest';

/**
 * Ninguna credencial de backend en lo que se empaqueta.
 *
 * Es el criterio 4 del cierre de la Fase 5 y el invariante de `AGENTS.md` §7,
 * y su modo de fallo es el peor que hay: una clave secreta en
 * `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` funciona **perfectamente** en
 * desarrollo. No hay error, no hay aviso, no hay síntoma. Solo se descubre
 * cuando alguien descomprime el binario publicado.
 *
 * Este test mira el **fuente versionado**, que es lo que se puede comprobar en
 * CI. Lo complementan otras dos capas, y ninguna sustituye a las demás:
 *
 * 1. `src/lib/env` rechaza una clave con forma de secreto **en tiempo de
 *    ejecución**, que es lo que cubre el `.env` de la máquina de cada uno —un
 *    fichero que este test no puede ver, porque no está versionado.
 * 2. El grep sobre el bundle exportado, antes de publicar, que es lo único que
 *    mira lo que de verdad se sube.
 */

const SOURCES = import.meta.glob('../../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const CONFIGS = import.meta.glob('../../{app.config.ts,.env.example,eslint.config.js}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const FILES = Object.entries({ ...SOURCES, ...CONFIGS }).map(([path, text]) => ({
  path: path.replace('../../', ''),
  text: text as string,
}));

/**
 * Formas literales de credencial. Se buscan como literal seguido de contenido:
 * el prefijo a secas aparece legítimamente en mensajes de error y en
 * comentarios, y prohibirlo convertiría el test en algo que hay que silenciar.
 */
const CREDENTIAL_SHAPES: readonly { name: string; pattern: RegExp }[] = [
  { name: 'clave secreta de Supabase', pattern: /sb_secret_[A-Za-z0-9_-]{8,}/ },
  { name: 'clave publicable literal', pattern: /sb_publishable_[A-Za-z0-9_-]{8,}/ },
  { name: 'JWT literal', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  { name: 'clave privada PEM', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/**
 * Variables cuyo nombre basta para condenarlas: `EXPO_PUBLIC_` se inlinea en
 * el bundle, así que la combinación con un nombre de secreto es el error
 * exacto que `.env.example` marca como PROHIBIDO.
 */
const FORBIDDEN_VARIABLES = /EXPO_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD)/;

describe('ausencia de credenciales de backend en el fuente', () => {
  it('revisa de verdad lo que dice revisar', () => {
    // Un glob que deja de resolver no falla: devuelve cero ficheros y todas
    // las comprobaciones de abajo pasan sin mirar nada.
    expect(FILES.length).toBeGreaterThan(20);
    const paths = FILES.map((file) => file.path);
    expect(paths).toContain('app.config.ts');
    expect(paths).toContain('.env.example');
    expect(paths).toContain('src/lib/env/index.ts');
  });

  for (const { name, pattern } of CREDENTIAL_SHAPES) {
    it(`no hay ninguna ${name}`, () => {
      const offenders = FILES.filter((file) => pattern.test(file.text)).map((file) => file.path);
      expect(offenders).toEqual([]);
    });
  }

  it('ninguna variable EXPO_PUBLIC_ tiene nombre de secreto', () => {
    const offenders = FILES.filter((file) => {
      // .env.example documenta las prohibidas con la palabra FORBIDDEN al lado.
      // Es el único sitio donde nombrarlas es el objetivo.
      if (file.path === '.env.example') return false;
      return FORBIDDEN_VARIABLES.test(file.text);
    }).map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it('el fuente solo lee las dos variables públicas previstas', () => {
    const referenced = new Set<string>();
    for (const file of FILES) {
      for (const match of file.text.matchAll(/process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g)) {
        referenced.add(match[1]);
      }
    }

    expect([...referenced].sort()).toEqual([
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'EXPO_PUBLIC_SUPABASE_URL',
    ]);
  });
});
