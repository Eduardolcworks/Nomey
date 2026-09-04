#!/usr/bin/env node
/**
 * Push Staging's client configuration to the EAS `preview` environment.
 *
 *   node scripts/eas-preview-sync.mjs            # reads .env
 *   node scripts/eas-preview-sync.mjs --dry-run  # validates and prints, sets nothing
 *
 * WHY THIS EXISTS. Staging is an installed APK with no Metro, so its
 * configuration has to come from somewhere that is not this machine's `.env`.
 * That somewhere is the standard EAS environment `preview`, which is what
 * `eas update --environment preview` reads. Without these three variables an
 * update could not be built honestly, so "nothing left to configure" would be
 * false.
 *
 * RERUN IT WHEN THE LAN URL CHANGES. Staging points provisionally at the local
 * Supabase stack over the LAN, so its URL is the address of this machine on
 * this network. Change network, change router, change machine, and the value in
 * EAS is stale. Publishing an update without refreshing it would ship a Staging
 * that cannot reach a backend.
 *
 * WHAT IT REFUSES TO DO. It validates through
 * `src/lib/env/supabase-env.ts` - the same boundary the app uses at startup, not
 * a second copy of the rules - so a `sb_secret_` value, a legacy JWT or a
 * malformed URL is rejected here before it ever reaches EAS. It pushes exactly
 * three names and never invents a fourth, never touches `production`, and never
 * prints a full value.
 *
 * VISIBILITY IS `plaintext`, AND THAT IS THE HONEST CLASSIFICATION. The URL and
 * the publishable key are public client configuration: they are inlined into
 * every binary and readable by anyone who downloads it. Marking them `secret`
 * would be a lie that makes the real secrets harder to take seriously.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * `npx eas-cli@latest`, run without a shell.
 *
 * The CLI is deliberately NOT a dependency of this project - `AGENTS.md` asks
 * for approval before adding one, and a build tool that is used a handful of
 * times a phase does not earn a place in the lockfile. So it is invoked through
 * npx, and npx is reached through its JavaScript entry rather than the
 * `npx.cmd` shim, because Node refuses to spawn a `.cmd` without a shell and a
 * shell is exactly what should not see these values.
 */
const NPX_CLI = path.join(
  path.dirname(process.execPath),
  'node_modules',
  'npm',
  'bin',
  'npx-cli.js',
);

const ENVIRONMENT = 'preview';
const VARIANT = 'staging';
const ENV_FILE = '.env';

const dryRun = process.argv.includes('--dry-run');

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

process.loadEnvFile(ENV_FILE);

const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
const publishableKey = (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

// The real boundary, imported rather than reimplemented. If it ever changes its
// mind about what a valid key looks like, this changes with it.
const { readSupabaseEnv } = await import('../src/lib/env/supabase-env.ts');

let validated;
try {
  validated = readSupabaseEnv({ url, publishableKey });
} catch (error) {
  console.error(`\nRECHAZADO antes de tocar EAS:\n${error.message}\n`);
  process.exit(1);
}

console.log(`\n=== Lo que se va a poner en el entorno EAS "${ENVIRONMENT}" ===`);
console.log(`  APP_VARIANT                          = ${VARIANT}`);
console.log(`  EXPO_PUBLIC_SUPABASE_URL             = ${redact(validated.url)}`);
console.log(`  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = ${redact(validated.publishableKey)}`);
console.log('  visibilidad: plaintext · ambito: project · configuracion PUBLICA de cliente');

if (dryRun) {
  console.log('\n--dry-run: validado y no se ha enviado nada.\n');
  process.exit(0);
}

const variables = [
  ['APP_VARIANT', VARIANT],
  ['EXPO_PUBLIC_SUPABASE_URL', validated.url],
  ['EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', validated.publishableKey],
];

if (!existsSync(NPX_CLI)) {
  console.error(`\nNo se encuentra npx en ${NPX_CLI}. Ejecuta el env:set a mano.\n`);
  process.exit(1);
}

for (const [name, value] of variables) {
  const result = spawnSync(
    process.execPath,
    [
      NPX_CLI,
      '--yes',
      'eas-cli@latest',
      'env:set',
      '--environment',
      ENVIRONMENT,
      '--name',
      name,
      '--value',
      value,
      '--type',
      'string',
      '--visibility',
      'plaintext',
      '--scope',
      'project',
      '--non-interactive',
    ],
    { stdio: 'inherit' },
  );

  if (result.status !== 0) {
    console.error(`\nFALLO al escribir ${name} en ${ENVIRONMENT}.\n`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nOK - las tres variables de ${VARIANT} estan en el entorno EAS "${ENVIRONMENT}".`);
console.log(
  `Verificalo con: npx eas-cli@latest env:exec ${ENVIRONMENT} "node scripts/staging-env-verify.mjs"\n`,
);
