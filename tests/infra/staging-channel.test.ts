import { describe, expect, it } from 'vitest';

import APP_CONFIG from '../../app.config.ts?raw';
import PACKAGE_JSON from '../../package.json?raw';
import PLUGIN from '../../plugins/with-local-http.js?raw';
import PROJECT_CHECK from '../../scripts/android-project-check.mjs?raw';
import RELEASE from '../../scripts/gradle-release.mjs?raw';

/**
 * Lo que separa a las tres variantes, y no puede juntarse por descuido.
 *
 * **Los modos de fallo que impide, todos silenciosos.** Un Staging sin canal no
 * recibiría nunca una actualización y lo parecería todo. Un Development **con**
 * canal reemplazaría el código bajo prueba por lo último publicado. Una identidad
 * cruzada instalaría una variante encima de otra. Y un Production con tráfico sin
 * cifrar sería una degradación permanente que ninguna pantalla enseña.
 *
 * Ninguno de los cuatro rompe nada al escribirse: rompen más tarde, en un
 * aparato, y sin decir por qué.
 */

/** La tabla de variantes tal y como la declara la configuración. */
function variantBlock(name: string): string {
  const start = APP_CONFIG.indexOf(`  ${name}: {`);
  expect(start, `la variante ${name} no está en app.config.ts`).toBeGreaterThan(-1);
  return APP_CONFIG.slice(start, APP_CONFIG.indexOf('\n  },', start));
}

const DEVELOPMENT = variantBlock('development');
const STAGING = variantBlock('staging');
const PRODUCTION = variantBlock('production');

describe('el canal de actualización aísla las variantes', () => {
  it('revisa de verdad lo que dice revisar', () => {
    expect(DEVELOPMENT).toContain('Nomey Dev');
    expect(STAGING).toContain('Nomey Staging');
    expect(PRODUCTION).toContain("displayName: 'Nomey'");
  });

  it('Staging escucha su canal, y sin canal no sería Staging', () => {
    expect(STAGING).toContain("channel: 'staging'");
    expect(STAGING).toContain('updatesEnabled: true');
  });

  it('Development no escucha ninguno, ni tiene actualizaciones', () => {
    // Es la puerta por la que una publicación reemplazaría el código bajo
    // prueba con lo último que alguien haya subido.
    expect(DEVELOPMENT).toContain('channel: null');
    expect(DEVELOPMENT).toContain('updatesEnabled: false');
    expect(DEVELOPMENT).not.toMatch(/channel: '(staging|production)'/);
  });

  it('y la cabecera del canal sólo se emite cuando hay canal', () => {
    expect(APP_CONFIG).toContain('variant.channel === null');
    expect(APP_CONFIG).toContain("'expo-channel-name': variant.channel");
  });
});

describe('las tres identidades no se cruzan', () => {
  it('cada variante tiene su paquete, su nombre y su esquema', () => {
    const identities = [
      [DEVELOPMENT, 'es.lcworks.nomey.dev', 'nomey-dev'],
      [STAGING, 'es.lcworks.nomey.staging', 'nomey-staging'],
      [PRODUCTION, 'es.lcworks.nomey', 'nomey'],
    ] as const;

    for (const [block, id, scheme] of identities) {
      expect(block).toContain(`bundleIdentifier: '${id}'`);
      expect(block).toContain(`scheme: '${scheme}'`);
    }

    // Y son distintos entre sí, que es lo que permite tenerlas instaladas a la
    // vez y lo que impide que una sustituya a otra.
    const ids = [...APP_CONFIG.matchAll(/bundleIdentifier: '([^']+)'/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const schemes = [...APP_CONFIG.matchAll(/scheme: '([^']+)'/g)].map((m) => m[1]);
    expect(new Set(schemes).size).toBe(schemes.length);
  });

  it('la guarda del proyecto generado comprueba las dos que se compilan', () => {
    // Una sola tabla: duplicar el script dejaría dos comprobaciones que
    // envejecen por separado.
    expect(PROJECT_CHECK).toContain("name: 'Nomey Dev'");
    expect(PROJECT_CHECK).toContain("name: 'Nomey Staging'");
    expect(PROJECT_CHECK).toContain('otherIdentity');
    expect(PROJECT_CHECK).toContain('process.argv[2]');
  });
});

describe('el HTTP sin cifrar no sale de Staging', () => {
  it('sólo Staging lo declara', () => {
    expect(STAGING).toContain('allowsLocalHttp: true');
    expect(DEVELOPMENT).toContain('allowsLocalHttp: false');
    expect(PRODUCTION).toContain('allowsLocalHttp: false');
  });

  it('y el plugin se aplica condicionado a esa declaración', () => {
    // Sin el condicional, el plugin viajaría en las tres.
    expect(APP_CONFIG).toContain(
      "...(variant.allowsLocalHttp ? ['./plugins/with-local-http.js'] : [])",
    );
  });

  it('el permiso está acotado a loopback, no abierto en general', () => {
    /*
     * `usesCleartextTraffic` a secas permitiría texto claro contra cualquier
     * host, y eso sobreviviría al día en que Staging apunte a un backend
     * alojado — justo cuando dejaría de ser inocuo.
     */
    expect(PLUGIN).toContain("['127.0.0.1', 'localhost']");
    expect(PLUGIN).toContain('cleartextTrafficPermitted="true"');
    // El plugin nombra `usesCleartextTraffic` en su cabecera para explicar por
    // qué NO lo usa; lo que no puede es escribirlo en el manifiesto.
    expect(PLUGIN).not.toMatch(/android:usesCleartextTraffic/);
  });

  it('y la guarda del proyecto lo verifica en las dos direcciones', () => {
    expect(PROJECT_CHECK).toContain('permite texto claro fuera de loopback');
    expect(PROJECT_CHECK).toContain('lleva configuracion de HTTP sin cifrar y NO debe');
  });
});

describe('el artefacto de Staging no se compila a ciegas', () => {
  const scripts = (JSON.parse(PACKAGE_JSON) as { scripts: Record<string, string> }).scripts;

  it('cada comando de Staging carga el entorno `preview`', () => {
    /*
     * Un APK compilado sin esas variables sale con la configuración vacía: no
     * falla al compilar, no falla al instalar, y falla en el aparato. Por eso
     * el entorno se carga en el comando y la compilación además lo exige.
     */
    expect(scripts['staging:prebuild']).toContain('env:exec preview');
    expect(scripts['staging:build']).toContain('env:exec preview');
    for (const name of [
      'APP_VARIANT',
      'EXPO_PUBLIC_SUPABASE_URL',
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    ]) {
      expect(RELEASE).toContain(`'${name}'`);
    }
    expect(RELEASE).toContain('ABORTADO: faltan');
  });

  it('y comprueba el proyecto generado antes de gastar Gradle', () => {
    expect(scripts['staging:build']).toContain('npm run staging:check');
    expect(scripts['staging:check']).toContain('android-project-check.mjs staging');
    expect(scripts['staging:build'].indexOf('staging:check')).toBeLessThan(
      scripts['staging:build'].indexOf('gradle-release'),
    );
  });

  it('el túnel de Staging no abre el puerto de Metro', () => {
    // Un artefacto de Staging es independiente de Metro por definición: dejarle
    // el 8081 abierto conservaría justo la dependencia que no debe tener.
    expect(scripts['staging:reverse']).toContain('--no-metro');
  });
});
