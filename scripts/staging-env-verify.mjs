#!/usr/bin/env node
/**
 * Staging resolves from the EAS `preview` environment, and from nothing else.
 *
 *   npx eas-cli@latest env:exec preview "node scripts/staging-env-verify.mjs"
 *
 * WHY IT IS RUN THROUGH `env:exec` AND NOT DIRECTLY. That is the whole point:
 * `env:exec` injects the variables EAS holds for `preview` into this process,
 * and nothing else does. Node does not read `.env` on its own, so if the three
 * names are present here they came from EAS. Running this script on its own
 * fails, and failing is the correct answer - it means the environment is not
 * configured.
 *
 * WHY NOT `env:pull`. `env:pull` writes a `.env.local` to the working tree.
 * A verification that leaves credentials on disk is a worse trade than the
 * convenience it buys, and it would also make the next run pass for the wrong
 * reason.
 *
 * WHAT IT DOES NOT DO. It does not export a bundle and it does not publish
 * anything: it resolves the config and validates the values. It never prints a
 * full value.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const EXPO_CLI = createRequire(import.meta.url).resolve('expo/bin/cli');

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`  FALLO: ${message}`);
};
const ok = (message) => console.log(`  ok: ${message}`);

/** Enough to prove a value is there and well formed, never enough to use it. */
function redact(value) {
  if (value.startsWith('sb_publishable_')) return `sb_publishable_…(${value.length} chars)`;
  try {
    const url = new URL(value);
    return `${url.protocol}//<host redactado>${url.port ? `:${url.port}` : ''}`;
  } catch {
    return `…(${value.length} chars)`;
  }
}

console.log('\n=== Las variables llegan de EAS, y de ningun otro sitio ===');

const variant = process.env.APP_VARIANT ?? '';
const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
const publishableKey = (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

if (variant === '' || url === '' || publishableKey === '') {
  console.log('  FALLO: faltan variables. Ejecutalo con:');
  console.log('    npx eas-cli@latest env:exec preview "node scripts/staging-env-verify.mjs"');
  process.exit(1);
}
ok('las tres estan presentes en este proceso, que Node no rellena desde .env');

// Si el `.env` de la maquina declarase APP_VARIANT, la variante podria venir de
// ahi en vez de de EAS y esta comprobacion no demostraria nada.
if (existsSync('.env') && /^\s*APP_VARIANT\s*=/m.test(readFileSync('.env', 'utf8'))) {
  fail('el .env local declara APP_VARIANT: la variante podria no venir de EAS');
} else {
  ok('el .env local no declara APP_VARIANT, asi que "staging" solo puede venir de EAS');
}

console.log('\n=== La variante y la identidad ===');

if (variant === 'staging') ok('APP_VARIANT=staging');
else fail(`APP_VARIANT="${variant}", que no es staging`);

const resolved = spawnSync(process.execPath, [EXPO_CLI, 'config', '--type', 'public', '--json'], {
  encoding: 'utf8',
  env: process.env,
});

let config = null;
if (resolved.status !== 0) {
  fail(`expo config salio con ${resolved.status}\n${(resolved.stderr ?? '').slice(0, 400)}`);
} else {
  try {
    config = JSON.parse(resolved.stdout);
  } catch {
    fail('la salida de expo config no es JSON');
  }
}

if (config !== null) {
  const channel = config.updates?.requestHeaders?.['expo-channel-name'] ?? null;

  const expectations = [
    ['nombre visible', config.name, 'Nomey Staging'],
    ['bundleIdentifier', config.ios?.bundleIdentifier, 'es.lcworks.nomey.staging'],
    ['package', config.android?.package, 'es.lcworks.nomey.staging'],
    ['scheme', config.scheme, 'nomey-staging'],
    ['canal', channel, 'staging'],
    ['updates.enabled', config.updates?.enabled, true],
    ['owner', config.owner, 'lcworks'],
  ];

  for (const [label, actual, expected] of expectations) {
    if (actual === expected) ok(`${label}: ${actual}`);
    else fail(`${label}: ${actual} (se esperaba ${expected})`);
  }

  if (channel === 'production') fail('el canal de Staging es el de PRODUCCION');
}

console.log('\n=== La configuracion de Supabase, validada por la frontera real ===');

// La misma funcion que la app ejecuta al arrancar, importada y no reescrita:
// si cambia de opinion sobre que es una clave valida, esto cambia con ella.
const { readSupabaseEnv } = await import('../src/lib/env/supabase-env.ts');

try {
  const validated = readSupabaseEnv({ url, publishableKey });
  ok(`URL presente y bien formada: ${redact(validated.url)}`);
  ok(`clave aceptada por src/lib/env: ${redact(validated.publishableKey)}`);
} catch (error) {
  fail(`la frontera rechaza la configuracion: ${error.message}`);
}

console.log('\n=== Ninguna credencial de servidor en el entorno inyectado ===');

const SERVER_SHAPES = [
  ['clave secreta de Supabase', /sb_secret_[A-Za-z0-9_-]{8,}/],
  ['JWT heredado', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
  ['clave privada PEM', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

// Solo las tres del contrato: el entorno de EAS trae ademas lo que el propio
// runner tenga puesto, y auditar el PATH de la maquina no es lo que se pide.
const CONTRACT = [
  'APP_VARIANT',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
];

for (const [label, pattern] of SERVER_SHAPES) {
  const offenders = CONTRACT.filter((name) => pattern.test(process.env[name] ?? ''));
  if (offenders.length > 0) fail(`${label} en ${offenders.join(', ')}`);
  else ok(`sin ${label}`);
}

const extras = Object.keys(process.env).filter(
  (name) => name.startsWith('EXPO_PUBLIC_') && !CONTRACT.includes(name),
);
if (extras.length > 0) fail(`variables EXPO_PUBLIC_ fuera del contrato: ${extras.join(', ')}`);
else ok('ninguna EXPO_PUBLIC_ fuera de las dos del contrato');

console.log('');
if (failures === 0) {
  console.log('OK - el entorno EAS "preview" resuelve Staging, y nada mas.');
  process.exit(0);
}
console.log(`${failures} comprobacion/es fallidas.`);
process.exit(1);
