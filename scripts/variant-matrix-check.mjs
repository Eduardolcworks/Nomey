#!/usr/bin/env node
/**
 * The three variants resolve, and they differ ONLY in identity and environment.
 *
 *   node scripts/variant-matrix-check.mjs
 *
 * WHY THIS IS NOT A VITEST TEST. It resolves the real config by running
 * `expo config --type public` three times, which is what a build actually
 * does - Expo's own normalisation included. Each run costs a few seconds, and
 * the unit suite is 2400 tests in under six seconds; putting four subprocesses
 * inside it would triple its wall time on every PR to assert something that
 * changes about once a phase. It runs in CI as its own step instead, next to
 * the other real checks in `scripts/`.
 *
 * WHAT IT PROVES, and why each one matters:
 *
 *  1. The three variants resolve at all, with the exact identity ADR-031 §1
 *     fixes. A typo in a bundle identifier is invisible until an install
 *     collides or a deep link opens the wrong app.
 *  2. They differ in NOTHING beyond that identity and the update channel.
 *     This is ADR-031 §2 made mechanical: the moment a variant starts changing
 *     a plugin, a permission or a flag, staging stops being a rehearsal of
 *     production and starts being a different app.
 *  3. An absent APP_VARIANT resolves to development, never to production.
 *  4. An unknown APP_VARIANT fails loudly instead of falling back.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const EXPO_CLI = createRequire(import.meta.url).resolve('expo/bin/cli');

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`  FALLO: ${message}`);
};
const ok = (message) => console.log(`  ok: ${message}`);

/**
 * Everything a variant is allowed to change, as paths into the resolved config.
 *
 * This list IS the contract. Adding a path to it widens what a variant may do,
 * so it is the line a reviewer should stop at.
 */
const MAY_DIFFER = [
  ['name'],
  ['scheme'],
  ['ios', 'bundleIdentifier'],
  ['android', 'package'],
  ['updates', 'enabled'],
  ['updates', 'requestHeaders'],
  // La lista de plugins, y SOLO por el de HTTP local. Se compara aparte, abajo,
  // en vez de quedar exenta: dejarla fuera sin mas admitiria cualquier
  // divergencia futura de plugins, que es justo lo que esta guarda existe para
  // no permitir.
  ['plugins'],
];

/**
 * El unico plugin que puede estar en unas variantes y no en otras, y donde.
 *
 * F8.A5 anadio un eje de diferencia real: Staging necesita hablar HTTP sin
 * cifrar contra `127.0.0.1` porque su backend es el stack local, y una build de
 * release no lo hace por defecto. Development no lo necesita —Metro ya trae el
 * permiso de la plantilla— y **Production no debe tenerlo nunca**.
 */
const VARIANT_ONLY_PLUGIN = './plugins/with-local-http.js';
const PLUGIN_EXPECTED_IN = new Set(['staging']);

/** Identity fixed by ADR-031 §1, restated here so the check has an oracle. */
const EXPECTED = {
  development: {
    name: 'Nomey Dev',
    id: 'es.lcworks.nomey.dev',
    scheme: 'nomey-dev',
    updatesEnabled: false,
    channel: null,
  },
  staging: {
    name: 'Nomey Staging',
    id: 'es.lcworks.nomey.staging',
    scheme: 'nomey-staging',
    updatesEnabled: true,
    channel: 'staging',
  },
  production: {
    name: 'Nomey',
    id: 'es.lcworks.nomey',
    scheme: 'nomey',
    updatesEnabled: true,
    channel: 'production',
  },
};

const SHARED = {
  owner: 'lcworks',
  version: '1.0.0',
  projectId: 'a5640f9f-b248-4fbe-8e9c-94ad9ed338a6',
  versionCode: 1,
  buildNumber: '1',
};

function resolveConfig(variant) {
  const env = { ...process.env };
  if (variant === undefined) {
    delete env.APP_VARIANT;
  } else {
    env.APP_VARIANT = variant;
  }

  const result = spawnSync(process.execPath, [EXPO_CLI, 'config', '--type', 'public', '--json'], {
    encoding: 'utf8',
    env,
  });

  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function parseOrFail(label, result) {
  if (result.status !== 0) {
    fail(`${label}: expo config salio con ${result.status}\n${result.stderr.slice(0, 400)}`);
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`${label}: la salida de expo config no es JSON`);
    return null;
  }
}

/** Deletes a path in place, so the remainder can be compared. */
function omit(object, path) {
  let node = object;
  for (const key of path.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return;
    node = node[key];
  }
  if (node !== null && typeof node === 'object') delete node[path[path.length - 1]];
}

/** Stable stringify, so key order never decides whether two configs match. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

console.log('\n=== Las tres variantes resuelven, con su identidad ===');

const resolved = {};
for (const variant of Object.keys(EXPECTED)) {
  const config = parseOrFail(variant, resolveConfig(variant));
  if (config === null) continue;
  resolved[variant] = config;

  const expected = EXPECTED[variant];
  const channel = config.updates?.requestHeaders?.['expo-channel-name'] ?? null;

  const wrong = [];
  if (config.name !== expected.name) wrong.push(`name=${config.name}`);
  if (config.scheme !== expected.scheme) wrong.push(`scheme=${config.scheme}`);
  if (config.ios?.bundleIdentifier !== expected.id)
    wrong.push(`ios=${config.ios?.bundleIdentifier}`);
  if (config.android?.package !== expected.id) wrong.push(`android=${config.android?.package}`);
  if (config.updates?.enabled !== expected.updatesEnabled)
    wrong.push(`updates=${config.updates?.enabled}`);
  if (channel !== expected.channel) wrong.push(`channel=${channel}`);

  if (wrong.length > 0) fail(`${variant}: ${wrong.join(' · ')}`);
  else
    ok(`${variant} -> ${expected.name} · ${expected.id} · canal ${expected.channel ?? 'ninguno'}`);
}

console.log('\n=== Lo compartido es realmente compartido ===');

for (const [variant, config] of Object.entries(resolved)) {
  const wrong = [];
  if (config.owner !== SHARED.owner) wrong.push(`owner=${config.owner}`);
  if (config.version !== SHARED.version) wrong.push(`version=${config.version}`);
  if (config.runtimeVersion?.policy !== 'appVersion')
    wrong.push(`runtimeVersion=${canonical(config.runtimeVersion)}`);
  if (config.android?.versionCode !== SHARED.versionCode)
    wrong.push(`versionCode=${config.android?.versionCode}`);
  if (config.ios?.buildNumber !== SHARED.buildNumber)
    wrong.push(`buildNumber=${config.ios?.buildNumber}`);
  if (config.extra?.eas?.projectId !== SHARED.projectId)
    wrong.push(`projectId=${config.extra?.eas?.projectId}`);
  if (config.updates?.url !== `https://u.expo.dev/${SHARED.projectId}`)
    wrong.push(`url=${config.updates?.url}`);

  if (wrong.length > 0) fail(`${variant}: ${wrong.join(' · ')}`);
  else ok(`${variant} comparte owner, version, runtime, contadores y proyecto`);
}

console.log('\n=== Y no difieren en NADA mas ===');

const remainders = {};
for (const [variant, config] of Object.entries(resolved)) {
  const copy = JSON.parse(JSON.stringify(config));
  for (const path of MAY_DIFFER) omit(copy, path);
  remainders[variant] = canonical(copy);
}

const names = Object.keys(remainders);
if (names.length < 3) {
  fail('no se resolvieron las tres variantes: la comparacion no demuestra nada');
} else {
  const [reference, ...rest] = names;
  for (const variant of rest) {
    if (remainders[variant] !== remainders[reference]) {
      fail(`${variant} difiere de ${reference} fuera de identidad y canal`);
    } else {
      ok(`${variant} es identica a ${reference} salvo identidad y canal`);
    }
  }
}

console.log('\n=== Los plugins son los mismos, salvo el de HTTP local ===');

for (const [variant, config] of Object.entries(resolved)) {
  const plugins = (config.plugins ?? []).map((entry) =>
    Array.isArray(entry) ? String(entry[0]) : String(entry),
  );
  const hasLocalHttp = plugins.includes(VARIANT_ONLY_PLUGIN);
  const shouldHave = PLUGIN_EXPECTED_IN.has(variant);

  if (hasLocalHttp !== shouldHave) {
    fail(
      hasLocalHttp
        ? `${variant} lleva ${VARIANT_ONLY_PLUGIN} y NO debe: abriria HTTP sin cifrar`
        : `${variant} deberia llevar ${VARIANT_ONLY_PLUGIN} y no lo lleva`,
    );
  } else {
    ok(`${variant}: ${hasLocalHttp ? 'con' : 'sin'} el plugin de HTTP local, como toca`);
  }

  // El RESTO de la lista tiene que ser identica en las tres. Sin esto, la
  // exencion de `plugins` habria abierto la puerta a cualquier divergencia.
  const others = canonical(plugins.filter((name) => name !== VARIANT_ONLY_PLUGIN));
  if (variant === 'development') {
    globalThis.__pluginBaseline = others;
  } else if (others !== globalThis.__pluginBaseline) {
    fail(`${variant} tiene otros plugins distintos de los de development`);
  } else {
    ok(`${variant} comparte el resto de plugins con development`);
  }
}

console.log('\n=== Produccion nunca se selecciona sola ===');

const implicit = parseOrFail('sin APP_VARIANT', resolveConfig(undefined));
if (implicit !== null) {
  if (implicit.name === EXPECTED.development.name) {
    ok('sin APP_VARIANT resuelve development');
  } else {
    fail(`sin APP_VARIANT resuelve "${implicit.name}", que no es development`);
  }
  if (implicit.ios?.bundleIdentifier === EXPECTED.production.id) {
    fail('sin APP_VARIANT se obtiene la identidad de PRODUCCION');
  } else {
    ok('sin APP_VARIANT no se obtiene la identidad de produccion');
  }
}

const empty = resolveConfig('');
const emptyConfig = parseOrFail('APP_VARIANT vacia', empty);
if (emptyConfig !== null) {
  if (emptyConfig.name === EXPECTED.development.name) ok('APP_VARIANT="" resuelve development');
  else fail(`APP_VARIANT="" resuelve "${emptyConfig.name}"`);
}

console.log('\n=== Una variante desconocida falla, no cae a ninguna ===');

for (const unknown of ['stagin', 'prod', 'PRODUCTION']) {
  const result = resolveConfig(unknown);
  if (result.status === 0) {
    fail(`APP_VARIANT="${unknown}" resolvio en vez de fallar`);
  } else if (!`${result.stderr}${result.stdout}`.includes('is not a known variant')) {
    fail(`APP_VARIANT="${unknown}" fallo, pero sin decir por que`);
  } else {
    ok(`APP_VARIANT="${unknown}" falla nombrando las variantes validas`);
  }
}

console.log('');
if (failures === 0) {
  console.log('OK - las tres variantes difieren solo en identidad y canal.');
  process.exit(0);
}
console.log(`${failures} comprobacion/es fallidas.`);
process.exit(1);
