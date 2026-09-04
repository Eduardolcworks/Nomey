#!/usr/bin/env node
/**
 * The generated Android project is the one Development asked for.
 *
 *   node scripts/with-variant.mjs development prebuild --platform android --clean
 *   node scripts/android-project-check.mjs
 *
 * WHY A CHECK AND NOT A GLANCE. `prebuild` turns `app.config.ts` into a native
 * project through a chain of plugins, and the interesting failures are silent:
 * an identifier that resolved to the wrong variant, an update channel left on
 * in a build served by Metro, a backup rule that quietly stopped excluding the
 * session. None of those stops the generation - they produce a project that
 * builds and misbehaves.
 *
 * WHY IT IS NOT IN CI. `android/` is a local artefact of ADR-030: it is never
 * versioned, so there is nothing for CI to check. This runs on the machine that
 * just generated it, which is the only place the question exists.
 *
 * WHAT IT DOES NOT DO. It never edits the project. If something here fails, the
 * fix is in `app.config.ts` or in a config plugin followed by another
 * `prebuild --clean` - never a hand edit, which the next generation would
 * silently discard.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'android';

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`  FALLO: ${message}`);
};
const ok = (message) => console.log(`  ok: ${message}`);

if (!existsSync(ROOT)) {
  console.log('\nNo hay proyecto android/. Generalo primero:');
  console.log('  node scripts/with-variant.mjs development prebuild --platform android --clean\n');
  process.exit(1);
}

const read = (relative) => {
  const file = path.join(ROOT, relative);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

/** Every text file of the project, for the two whole-tree assertions. */
function textFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'build' || entry === '.gradle' || entry === '.cxx') continue;
      found.push(...textFiles(full));
      continue;
    }
    if (/\.(xml|gradle|kt|java|pro|properties|json|cfg|txt)$/.test(entry)) {
      found.push({ path: full, text: readFileSync(full, 'utf8') });
    }
  }
  return found;
}

const files = textFiles(ROOT);

const EXPECTED = {
  name: 'Nomey Dev',
  applicationId: 'es.lcworks.nomey.dev',
  scheme: 'nomey-dev',
  version: '1.0.0',
  versionCode: '1',
  updateUrl: 'https://u.expo.dev/a5640f9f-b248-4fbe-8e9c-94ad9ed338a6',
  background: '#000000',
  iconGround: '#FDC506',
};

console.log('\n=== Identidad: es Development y no otra variante ===');

const strings = read('app/src/main/res/values/strings.xml') ?? '';
const gradle = read('app/build.gradle') ?? '';
const manifest = read('app/src/main/AndroidManifest.xml') ?? '';

const identity = [
  ['nombre visible', strings, `<string name="app_name">${EXPECTED.name}</string>`],
  ['namespace', gradle, `namespace '${EXPECTED.applicationId}'`],
  ['applicationId', gradle, `applicationId '${EXPECTED.applicationId}'`],
  ['versionCode', gradle, `versionCode ${EXPECTED.versionCode}`],
  ['versionName', gradle, `versionName "${EXPECTED.version}"`],
  ['scheme', manifest, `<data android:scheme="${EXPECTED.scheme}"/>`],
];

for (const [label, haystack, needle] of identity) {
  if (haystack.includes(needle)) ok(`${label}: ${needle.trim()}`);
  else fail(`${label}: no se encuentra ${needle.trim()}`);
}

console.log('\n=== Y no hay rastro de Staging ni de Produccion ===');

// `es.lcworks.nomey` sin `.dev` detras es, necesariamente, otra variante:
// produccion tal cual, o `.staging`.
const OTHER_VARIANT = /es\.lcworks\.nomey(?!\.dev)/;
const strays = files.filter((file) => OTHER_VARIANT.test(file.text)).map((file) => file.path);
if (strays.length > 0) fail(`identificador de otra variante en: ${strays.join(', ')}`);
else ok('ningun fichero nombra es.lcworks.nomey ni es.lcworks.nomey.staging');

const otherSchemes = files.filter((file) => /android:scheme="nomey(-staging)?"/.test(file.text));
if (otherSchemes.length > 0)
  fail(`scheme de otra variante en: ${otherSchemes.map((f) => f.path).join(', ')}`);
else ok('ningun intent-filter registra nomey:// ni nomey-staging://');

console.log('\n=== Actualizaciones: apagadas, que es lo que Development pide ===');

const updates = [
  ['ENABLED false', 'expo.modules.updates.ENABLED" android:value="false"'],
  ['runtime por recurso', 'EXPO_RUNTIME_VERSION" android:value="@string/expo_runtime_version"'],
  ['url del proyecto', `EXPO_UPDATE_URL" android:value="${EXPECTED.updateUrl}"`],
];
for (const [label, needle] of updates) {
  if (manifest.includes(needle)) ok(label);
  else fail(`${label}: no se encuentra en el manifiesto`);
}

if (strings.includes(`<string name="expo_runtime_version">${EXPECTED.version}</string>`)) {
  ok(`runtimeVersion resuelto a ${EXPECTED.version} por la politica appVersion`);
} else {
  fail('el recurso expo_runtime_version no vale 1.0.0');
}

// Un canal en un binario servido por Metro es la puerta por la que una
// actualizacion publicada reemplaza el codigo bajo prueba.
if (/expo-channel-name/i.test(manifest)) fail('Development declara un canal de actualizacion');
else ok('ningun expo-channel-name: Development no escucha ningun canal');

console.log('\n=== Plugins aplicados ===');

const plugins = [
  [
    'expo-secure-store · backup',
    manifest,
    'android:fullBackupContent="@xml/secure_store_backup_rules"',
  ],
  [
    'expo-secure-store · transferencia',
    manifest,
    'android:dataExtractionRules="@xml/secure_store_data_extraction_rules"',
  ],
  [
    'expo-splash-screen · tema',
    read('app/src/main/res/values/styles.xml') ?? '',
    'Theme.App.SplashScreen',
  ],
  [
    'expo-splash-screen · icono',
    read('app/src/main/res/values/styles.xml') ?? '',
    'windowSplashScreenAnimatedIcon">@drawable/splashscreen_logo',
  ],
  [
    'tema oscuro forzado',
    strings,
    'expo_system_ui_user_interface_style" translatable="false">dark',
  ],
];
for (const [label, haystack, needle] of plugins) {
  if (haystack.includes(needle)) ok(label);
  else fail(`${label}: no se encuentra ${needle}`);
}

// Las reglas de backup las aporta el propio modulo, no el proyecto generado:
// si el AAR dejara de traerlas, el manifiesto apuntaria a un recurso ausente.
const RULES = 'node_modules/expo-secure-store/android/src/main/res/xml';
for (const rule of ['secure_store_backup_rules.xml', 'secure_store_data_extraction_rules.xml']) {
  if (existsSync(path.join(RULES, rule))) ok(`el modulo aporta ${rule}`);
  else fail(`${rule} no existe en expo-secure-store: el manifiesto apunta a un recurso ausente`);
}

console.log('\n=== Splash y fondo, con los colores del tema ===');

const colors = read('app/src/main/res/values/colors.xml') ?? '';
const painted = [
  ['fondo del splash', `<color name="splashscreen_background">${EXPECTED.background}</color>`],
  ['fondo de la vista raiz', `<color name="activityBackground">${EXPECTED.background}</color>`],
  ['fondo del icono adaptativo', `<color name="iconBackground">${EXPECTED.iconGround}</color>`],
];
for (const [label, needle] of painted) {
  if (colors.includes(needle)) ok(`${label}: ${needle.match(/#[0-9A-Fa-f]{6}/)?.[0]}`);
  else fail(`${label}: no se encuentra ${needle}`);
}

const adaptive = read('app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml') ?? '';
for (const [label, needle] of [
  ['capa de fondo', '@color/iconBackground'],
  ['primer plano', '@mipmap/ic_launcher_foreground'],
  ['icono monocromo', '@mipmap/ic_launcher_monochrome'],
]) {
  if (adaptive.includes(needle)) ok(`icono adaptativo · ${label}`);
  else fail(`icono adaptativo · ${label}: no se encuentra ${needle}`);
}

console.log('\n=== Ninguna credencial de servidor en el proyecto generado ===');

const CREDENTIALS = [
  ['clave secreta de Supabase', /sb_secret_[A-Za-z0-9_-]{8,}/],
  ['clave publicable', /sb_publishable_[A-Za-z0-9_-]{8,}/],
  ['JWT heredado', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
  ['clave privada PEM', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
for (const [label, pattern] of CREDENTIALS) {
  const offenders = files.filter((file) => pattern.test(file.text)).map((file) => file.path);
  // La publicable SI viaja en el bundle de JavaScript y es correcto, pero el
  // proyecto nativo se genera antes de empaquetar nada: aqui no pinta nada.
  if (offenders.length > 0) fail(`${label} en: ${offenders.join(', ')}`);
  else ok(`sin ${label}`);
}

console.log('\n=== El icono del lanzador, generado para las cinco densidades ===');

const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
const missing = DENSITIES.filter(
  (density) =>
    !existsSync(path.join(ROOT, `app/src/main/res/mipmap-${density}/ic_launcher_foreground.webp`)),
);
if (missing.length > 0) fail(`faltan densidades del primer plano: ${missing.join(', ')}`);
else ok(`primer plano presente en ${DENSITIES.join(', ')}`);

// 432 px es el lienzo completo del icono adaptativo a xxxhdpi -108 dp x 4-, asi
// que es lo que el original de 1024 tiene que haber producido al reducirse.
const largest = path.join(ROOT, 'app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.webp');
if (existsSync(largest)) {
  const bytes = readFileSync(largest);
  const isPng = bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG';
  const side = isPng ? bytes.readUInt32BE(16) : null;
  if (side === 432) ok('el primer plano de xxxhdpi mide 432x432, el lienzo adaptativo completo');
  else fail(`el primer plano de xxxhdpi mide ${side ?? 'un tamano ilegible'}, no 432`);
}

console.log('');
if (failures === 0) {
  console.log(`OK - ${files.length} ficheros revisados. El proyecto es el de Development.`);
  process.exit(0);
}
console.log(`${failures} comprobacion/es fallidas.`);
process.exit(1);
