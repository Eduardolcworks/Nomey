#!/usr/bin/env node
/**
 * Compila el APK de release de Android, y se niega si no lleva configuración.
 *
 *   npm run staging:build            # la vía normal: prebuild, guarda y esto
 *   node scripts/gradle-release.mjs  # sólo la compilación
 *
 * **Por qué existe en vez de una línea de `package.json`.** Por la guarda. Un
 * artefacto de Staging inlinea `EXPO_PUBLIC_*` **en el momento de compilar**, y
 * si esas variables no están el APK sale con la configuración vacía: no falla
 * al compilar, no falla al instalar, y falla en el aparato como si fuera un
 * problema de red. Aquí se comprueba antes de gastar los minutos de Gradle.
 *
 * La forma correcta de invocarlo es a través de `eas env:exec preview`, que es
 * quien inyecta esas variables. Ejecutarlo a pelo aborta y lo dice.
 *
 * **No elige variante.** La variante ya está fijada en el proyecto generado por
 * el `prebuild` anterior; esto sólo compila lo que hay. Por eso `staging:build`
 * encadena las tres cosas en orden y la guarda del proyecto va en medio.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { platform } from 'node:process';

/** Sólo `x86_64`: es lo que corre el emulador, y una ABI compila en un cuarto del tiempo. */
const ABI = process.env.NOMEY_RELEASE_ABI ?? 'x86_64';

const REQUIRED = [
  'APP_VARIANT',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
];

const missing = REQUIRED.filter((name) => (process.env[name] ?? '').trim() === '');
if (missing.length > 0) {
  console.error(`\nABORTADO: faltan ${missing.join(', ')}.`);
  console.error('          Un APK compilado sin ellas sale con la configuracion vacia y');
  console.error('          falla en el aparato, no aqui. Ejecutalo cargando el entorno:');
  console.error('            npm run staging:build');
  process.exit(1);
}

if (!existsSync('android')) {
  console.error('\nABORTADO: no hay proyecto android/. Generalo antes:  npm run staging:prebuild');
  process.exit(1);
}

console.log(`\n=== Compilando release para ${ABI} · variante ${process.env.APP_VARIANT} ===`);

/*
 * Ruta absoluta, y no `gradlew.bat` a secas: con `shell` en Windows el comando
 * se resuelve contra el PATH y no contra `cwd`, así que el relativo no existe
 * para quien lo va a ejecutar. Medido: «no se reconoce como un comando».
 */
const gradle = resolve('android', platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const result = spawnSync(gradle, [':app:assembleRelease', `-PreactNativeArchitectures=${ABI}`], {
  cwd: 'android',
  stdio: 'inherit',
  shell: platform === 'win32',
});

if (result.status !== 0) {
  console.error('\nLa compilacion no termino.');
  process.exit(result.status ?? 1);
}

console.log('\nOK - android/app/build/outputs/apk/release/app-release.apk\n');
