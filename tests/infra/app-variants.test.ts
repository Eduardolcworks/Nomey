import { describe, expect, it } from 'vitest';

import APP_CONFIG from '../../app.config.ts?raw';

/**
 * Las tres variantes de ADR-031, leídas del fuente que las produce.
 *
 * **Qué cubre esto y qué no.** Aquí se comprueba lo que está ESCRITO en
 * `app.config.ts`: la tabla, el valor por defecto, el fallo ante un valor
 * desconocido y el cableado del canal. Lo que se comprueba en otro sitio, y a
 * propósito, es lo que Expo RESUELVE a partir de eso:
 * `scripts/variant-matrix-check.mjs` ejecuta `expo config` tres veces y
 * compara los resultados enteros. Esa parte cuesta segundos por invocación y
 * no cabe en una suite de 2400 tests que dura menos de seis.
 *
 * Se lee como texto y no se importa, igual que `brand-chrome.test.ts`:
 * importar el config arrastraría los tipos ambientales de Expo a este
 * proyecto, y leer el fuente demuestra además que los valores no están
 * repetidos a mano en cada uso.
 */

/** El cuerpo de un bloque `clave: { ... }`, para afirmar sobre su contenido. */
function variantBlock(name: string): string {
  const start = APP_CONFIG.indexOf(`  ${name}: {`);
  expect(start, `app.config.ts debe declarar la variante ${name}`).toBeGreaterThan(-1);
  return APP_CONFIG.slice(start, APP_CONFIG.indexOf('\n  },', start));
}

const IDENTITY = {
  development: {
    displayName: 'Nomey Dev',
    bundleIdentifier: 'es.lcworks.nomey.dev',
    scheme: 'nomey-dev',
  },
  staging: {
    displayName: 'Nomey Staging',
    bundleIdentifier: 'es.lcworks.nomey.staging',
    scheme: 'nomey-staging',
  },
  production: {
    displayName: 'Nomey',
    bundleIdentifier: 'es.lcworks.nomey',
    scheme: 'nomey',
  },
} as const;

describe('la tabla de variantes es la de ADR-031 §1', () => {
  it('declara exactamente tres, y ninguna cuarta', () => {
    expect(APP_CONFIG).toMatch(/type VariantName = 'development' \| 'staging' \| 'production';/);
    const declared = APP_CONFIG.match(/^ {2}(development|staging|production): \{$/gm);
    expect(declared).toHaveLength(3);
  });

  for (const [name, identity] of Object.entries(IDENTITY)) {
    it(`da a ${name} su nombre, su identificador y su esquema`, () => {
      const block = variantBlock(name);
      expect(block).toContain(`displayName: '${identity.displayName}'`);
      expect(block).toContain(`bundleIdentifier: '${identity.bundleIdentifier}'`);
      expect(block).toContain(`scheme: '${identity.scheme}'`);
    });
  }

  it('no repite ningún identificador entre variantes', () => {
    const identifiers = Object.values(IDENTITY).map((one) => one.bundleIdentifier);
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it('no repite ningún esquema, porque el enlace profundo lleva el recovery', () => {
    // Con un esquema compartido el sistema elige ganador, y lo que se estaría
    // enrutando es un enlace de recuperación de contraseña - ADR-018.
    const schemes = Object.values(IDENTITY).map((one) => one.scheme);
    expect(new Set(schemes).size).toBe(schemes.length);
  });
});

describe('producción no se selecciona nunca por accidente', () => {
  it('el valor por defecto es development', () => {
    expect(APP_CONFIG).toMatch(/^const DEFAULT_VARIANT: VariantName = 'development';$/m);
  });

  it('y no hay ninguna otra ruta que devuelva production sin pedirlo', () => {
    // El único `return` que puede dar production es el que devuelve lo pedido.
    const returns = APP_CONFIG.match(/return '[a-z]+' as VariantName;|return DEFAULT_VARIANT;/g);
    expect(returns).toEqual(['return DEFAULT_VARIANT;']);
    expect(APP_CONFIG).not.toMatch(/\?\?\s*'production'/);
    expect(APP_CONFIG).not.toMatch(/DEFAULT_VARIANT[^;]*production/);
  });

  it('una variante desconocida lanza, y no cae al valor por defecto', () => {
    expect(APP_CONFIG).toContain('is not a known variant');
    expect(APP_CONFIG).toMatch(/throw new Error\(/);
    // El mensaje enumera las válidas: un error que no dice qué poner obliga a
    // abrir el fichero, y quien lo lee suele estar en mitad de otra cosa.
    expect(APP_CONFIG).toContain('VARIANT_NAMES.join');
  });
});

describe('runtime, contadores y proyecto', () => {
  it('usa la política appVersion, y no fingerprint', () => {
    expect(APP_CONFIG).toMatch(/^ {2}runtimeVersion: \{ policy: 'appVersion' \},$/m);
    expect(APP_CONFIG).not.toMatch(/policy: 'fingerprint'/);
  });

  it('mantiene la versión de aplicación en 1.0.0', () => {
    expect(APP_CONFIG).toMatch(/^ {2}version: '1\.0\.0',$/m);
  });

  it('fija los dos contadores de build explícitamente', () => {
    expect(APP_CONFIG).toMatch(/^ {4}buildNumber: '1',$/m);
    expect(APP_CONFIG).toMatch(/^ {4}versionCode: 1,$/m);
  });

  it('declara el proyecto de EAS una sola vez y lo reutiliza', () => {
    const declared = APP_CONFIG.match(/^const EAS_PROJECT_ID = '[0-9a-f-]{36}';$/m);
    expect(declared, 'app.config.ts debe declarar un único EAS_PROJECT_ID').not.toBeNull();

    // La URL de updates se construye a partir de esa constante. Escribirla a
    // mano permitiría que apuntase a otro proyecto sin que nada lo notase.
    expect(APP_CONFIG).toContain('url: `https://u.expo.dev/${EAS_PROJECT_ID}`');
    expect(APP_CONFIG).toContain('projectId: EAS_PROJECT_ID');
    expect(APP_CONFIG).toMatch(/^ {2}owner: EAS_ACCOUNT,$/m);
  });
});

describe('el canal de actualización', () => {
  it('está apagado en development, que se sirve por Metro', () => {
    const block = variantBlock('development');
    expect(block).toContain('updatesEnabled: false');
    expect(block).toContain('channel: null');
  });

  it('es `staging` en staging, y jamás el de producción', () => {
    const block = variantBlock('staging');
    expect(block).toContain('updatesEnabled: true');
    expect(block).toContain("channel: 'staging'");
    expect(block).not.toContain("channel: 'production'");
  });

  it('es `production` en producción', () => {
    const block = variantBlock('production');
    expect(block).toContain('updatesEnabled: true');
    expect(block).toContain("channel: 'production'");
  });

  it('viaja como cabecera, porque no hay perfil de EAS Build que lo lleve', () => {
    expect(APP_CONFIG).toContain("requestHeaders: { 'expo-channel-name': variant.channel }");
  });

  it('y no se emite ninguna cabecera cuando no hay canal', () => {
    // Un `expo-channel-name` vacío no es "sin canal": es una petición con una
    // cabecera que el servidor tiene que interpretar.
    expect(APP_CONFIG).toMatch(/\.\.\.\(variant\.channel === null\s*\n?\s*\? \{\}/);
  });
});
