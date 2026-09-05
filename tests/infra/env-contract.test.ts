import { describe, expect, it } from 'vitest';

import CI from '../../.github/workflows/ci.yml?raw';
import ENV_EXAMPLE from '../../.env.example?raw';
import GITIGNORE from '../../.gitignore?raw';
import PACKAGE_JSON from '../../package.json?raw';
import RUNBOOK from '../../docs/runbooks/environments.md?raw';
import PREVIEW_SYNC from '../../scripts/eas-preview-sync.mjs?raw';
import STAGING_VERIFY from '../../scripts/staging-env-verify.mjs?raw';
import WRAPPER from '../../scripts/with-variant.mjs?raw';

/**
 * El contrato de entorno de ADR-031, comprobado donde se puede romper.
 *
 * Son tres nombres y ni uno más — `APP_VARIANT` y las dos `EXPO_PUBLIC_` — y
 * la propiedad que los hace útiles no es que existan, sino que **cambiar de
 * entorno sea configuración y nunca código**. Eso último no se puede afirmar
 * mirando un solo fichero: hace falta comprobar que ninguna capa del producto
 * pregunta en qué entorno se ejecuta, que los comandos nombran su variante en
 * voz alta, y que lo que no está versionado sigue sin estarlo.
 */

const SOURCES = import.meta.glob('../../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const SOURCE_FILES = Object.entries(SOURCES).map(([path, text]) => ({
  path: path.replace('../../', ''),
  text: text as string,
}));

const PUBLIC_VARIABLES = ['EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'EXPO_PUBLIC_SUPABASE_URL'];

describe('la superficie de entorno son tres nombres', () => {
  it('revisa de verdad lo que dice revisar', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(20);
    expect(ENV_EXAMPLE.length).toBeGreaterThan(100);
    expect(CI).toContain('name: CI');
  });

  it('`.env.example` documenta las tres, y ninguna cuarta', () => {
    for (const name of [...PUBLIC_VARIABLES, 'APP_VARIANT']) {
      expect(ENV_EXAMPLE).toContain(name);
    }

    const declared = [...ENV_EXAMPLE.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);
    expect(declared.sort()).toEqual(PUBLIC_VARIABLES);
  });

  it('y no ofrece un valor de clave que alguien pueda sustituir por el real', () => {
    // Un placeholder con forma de clave o bien derrota a
    // `no-backend-secrets.test.ts` o bien obliga a hacerle una excepción.
    // El valor vacío falla de inmediato, que es lo correcto en una plantilla.
    expect(ENV_EXAMPLE).toMatch(/^EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$/m);
    expect(ENV_EXAMPLE).toMatch(/^EXPO_PUBLIC_SUPABASE_URL=$/m);
  });

  it('`APP_VARIANT` pertenece al comando y no al fichero de entorno', () => {
    // Si viviera en `.env`, la identidad de una build dependería de un fichero
    // que no está en Git: dos máquinas, el mismo comando, dos apps distintas.
    expect(ENV_EXAMPLE).not.toMatch(/^APP_VARIANT=/m);
    expect(ENV_EXAMPLE).toContain('do NOT set it here');
  });
});

describe('lo que no está versionado sigue sin estarlo', () => {
  it('`.env` y sus variantes están ignoradas, y la plantilla no', () => {
    expect(GITIGNORE).toMatch(/^\.env$/m);
    expect(GITIGNORE).toMatch(/^\.env\.\*$/m);
    expect(GITIGNORE).toMatch(/^!\.env\.example$/m);
  });

  it('las carpetas nativas generadas siguen ignoradas — ADR-030', () => {
    expect(GITIGNORE).toMatch(/^\/ios$/m);
    expect(GITIGNORE).toMatch(/^\/android$/m);
  });
});

describe('cambiar de entorno es configuración, nunca código', () => {
  it('ninguna capa del producto pregunta en qué entorno se ejecuta', () => {
    /*
     * Es la mitad de ADR-031 §2, y la que se rompe sin querer: basta un
     * `if (variante === 'staging')` dentro de una feature para que staging deje
     * de ser un ensayo de producción y pase a ser otra aplicación. La variante
     * es una propiedad del BINARIO, resuelta en `app.config.ts` en tiempo de
     * build; nada de `src/` tiene por qué conocerla.
     */
    const offenders = SOURCE_FILES.filter((file) => /APP_VARIANT/.test(file.text)).map(
      (file) => file.path,
    );
    expect(offenders).toEqual([]);
  });

  it('y tampoco lee el canal ni el proyecto de EAS desde el producto', () => {
    const offenders = SOURCE_FILES.filter((file) =>
      /expo-channel-name|u\.expo\.dev/.test(file.text),
    ).map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});

describe('los comandos nombran su variante en voz alta', () => {
  const scripts = (JSON.parse(PACKAGE_JSON) as { scripts: Record<string, string> }).scripts;

  it('el recorrido local arranca development explícitamente', () => {
    for (const name of ['start', 'android', 'ios']) {
      expect(scripts[name], `npm run ${name}`).toContain('scripts/with-variant.mjs development');
    }
  });

  it('ningún script invoca la CLI de Expo sin decir qué variante quiere', () => {
    // `expo start` a secas resolvería por defecto, que hoy es development y es
    // seguro — pero deja la identidad implícita, que es justo lo que este
    // bloque existe para impedir. `expo lint` no construye nada y no cuenta.
    const offenders = Object.entries(scripts)
      .filter(([name]) => name !== 'lint')
      .filter(([, command]) => /(^|\s)expo\s/.test(command))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  it('hay una forma reproducible de resolver cada una de las tres', () => {
    for (const variant of ['development', 'staging', 'production']) {
      expect(scripts[`config:${variant}`]).toBe(
        `node scripts/with-variant.mjs ${variant} config --type public`,
      );
    }
  });

  it('el wrapper no mantiene su propia lista de variantes', () => {
    // Dos listas es una que se queda atrás. `app.config.ts` es la autoridad, y
    // el wrapper sólo transporta el valor.
    expect(WRAPPER).not.toContain("'staging'");
    expect(WRAPPER).not.toContain("'production'");
    expect(WRAPPER).toContain('APP_VARIANT: variant');
  });

  it('y no pasa por ningún intérprete de línea de comandos', () => {
    // `shell: true` en Windows haría que el comando lo parsease `cmd.exe`.
    expect(WRAPPER).not.toContain('shell: true');
    expect(WRAPPER).toContain('process.execPath');
  });
});

describe('la configuración de Staging vive en el entorno EAS `preview`', () => {
  it('el sync valida por la frontera real, no por una copia de las reglas', () => {
    // Si reimplementase «qué es una clave válida», el día que la frontera
    // cambie de opinión EAS se quedaría con la versión antigua.
    expect(PREVIEW_SYNC).toContain("import('../src/lib/env/supabase-env.ts')");
    expect(STAGING_VERIFY).toContain("import('../src/lib/env/supabase-env.ts')");
  });

  it('y ninguno de los dos escribe un `.env` en el árbol de trabajo', () => {
    // `env:pull` dejaría un `.env.local` con credenciales en disco, y además
    // haría que la siguiente verificación pasara por el motivo equivocado.
    // Se busca la forma de ARGUMENTO —`'env:pull'` entre comillas, como
    // aparecería en un argv— y no la palabra suelta, que los dos scripts
    // mencionan legítimamente al explicar por qué no la usan.
    for (const script of [PREVIEW_SYNC, STAGING_VERIFY]) {
      expect(script).not.toContain("'env:pull'");
      expect(script).not.toContain('writeFileSync');
    }
  });

  it('el sync sólo toca `preview`, y nunca `production`', () => {
    expect(PREVIEW_SYNC).toMatch(/^const ENVIRONMENT = 'preview';$/m);
    expect(PREVIEW_SYNC).not.toContain("'production'");
  });

  it('el runbook nombra el modo de fallo VIGENTE, que ya no es la URL', () => {
    /*
     * Antes de F8.A5 la advertencia era «refréscalo cuando cambie la URL LAN»:
     * el valor de EAS caducaba al cambiar de Wi-Fi y fallaba en el aparato, no
     * al publicar. **Ese modo de fallo ya no existe** — la dirección es loopback
     * y no depende de la red — así que exigir aquella frase congelaría un aviso
     * que dejó de ser cierto.
     *
     * Lo que sí puede faltar ahora es el TÚNEL, y se pierde solo. El runbook
     * tiene que decirlo, porque el síntoma dentro de la app es «Sin conexión»,
     * que es honesto pero no nombra la causa.
     */
    expect(RUNBOOK).toContain('scripts/eas-preview-sync.mjs');
    expect(RUNBOOK).toContain('scripts/staging-env-verify.mjs');
    expect(RUNBOOK).toContain('channel:create staging');

    expect(RUNBOOK).not.toContain('CUANDO CAMBIE LA URL LAN');
    expect(RUNBOOK).toContain('http://127.0.0.1:54321');
    expect(RUNBOOK).toContain('npm run staging:reverse');
    expect(RUNBOOK).toMatch(/Un túnel se pierde solo/);
  });
});

describe('CI ejecuta las dos comprobaciones que no caben en la suite', () => {
  it('resuelve las tres variantes y las compara', () => {
    expect(CI).toContain('node scripts/variant-matrix-check.mjs');
  });

  it('y revisa el bundle exportado de las tres, con su caso sembrado', () => {
    expect(CI).toContain('./scripts/bundle-secrets-matrix.sh');
  });

  it('sin usar ningún secreto del repositorio para conseguirlo', () => {
    // El job cuyo propósito es demostrar que no hay valores reales en el
    // bundle no puede necesitar un valor real para arrancar.
    const guardJob = CI.slice(CI.indexOf('bundle-secrets-matrix.sh') - 2000);
    expect(guardJob).not.toContain('secrets.');
  });
});
