#!/usr/bin/env node
/**
 * Que el Android de Development alcance lo que la `.env` local dice.
 *
 *   node scripts/android-reverse.mjs            # configura y comprueba
 *   node scripts/android-reverse.mjs --check    # sólo comprueba, no toca nada
 *   node scripts/android-reverse.mjs --device emulator-5554
 *
 * **EL PROBLEMA QUE RESUELVE.** Development apuntaba a una IP de la red local,
 * y una IP de red local es propiedad del sitio donde estás: al cambiar de Wi-Fi
 * deja de resolver, la aplicación no falla al compilar sino en el aparato, y el
 * arreglo era editar la `.env` cada vez. Con `adb reverse`, el aparato abre
 * `127.0.0.1:<puerto>` y ADB lo tunela hasta el mismo puerto del ordenador: la
 * dirección deja de depender de la red y la `.env` no vuelve a tocarse.
 *
 * **Por qué loopback y no `10.0.2.2`.** Esa dirección es el alias que el
 * emulador de Android da a su anfitrión, y **sólo existe en el emulador**: un
 * teléfono conectado por cable no la resuelve. `127.0.0.1` con `adb reverse`
 * sirve a los dos con una sola configuración, y no exige abrir ningún puerto al
 * resto de la red ni tocar el cortafuegos.
 *
 * **Sirve también a Staging, con `--no-metro`.** Un artefacto de Staging no
 * depende de Metro pero sí alcanza el mismo stack local por el mismo túnel del
 * 54321, así que la pieza es la misma y sólo cambia qué puertos se piden.
 * Production no pasa por aquí: no habla con esta máquina.
 *
 * **Qué NO hace.** No edita la `.env`, no la lee para escribir nada, no imprime
 * la clave y no sabe nada de Producción. Y no arranca ni para ningún servicio:
 * si el puerto del ordenador no escucha, lo dice.
 *
 * **La comprobación importa tanto como la configuración.** Un `adb reverse` se
 * pierde al reconectar el aparato, al reiniciarlo y al reiniciar el servidor de
 * ADB. Sin `--check` eso reaparece como un fallo de red dentro de la
 * aplicación, muy lejos de su causa.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHECK_ONLY = process.argv.includes('--check');
const deviceFlag = process.argv.indexOf('--device');
const WANTED_DEVICE = deviceFlag === -1 ? null : process.argv[deviceFlag + 1];

/**
 * `--no-metro` deja fuera el túnel de Metro y monta sólo el de la frontera.
 *
 * **Es lo que necesita Staging, y la diferencia importa.** Un artefacto de
 * Staging es independiente de Metro por definición, así que abrirle el 8081
 * sería dejar en pie justo la dependencia que ese artefacto existe para no
 * tener — y una comprobación que la use dejaría de demostrar nada.
 */
const NO_METRO = process.argv.includes('--no-metro');

/** El puerto de Metro. Fijo porque lo fija Expo, no esta configuración. */
const METRO_PORT = 8081;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function fail(message, ...detail) {
  console.error(`\nERROR: ${message}`);
  for (const line of detail) console.error(`       ${line}`);
  process.exit(1);
}

/** `adb` del SDK si `ANDROID_HOME` está puesto; si no, el del PATH. */
function adbBinary() {
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (home) {
    for (const name of ['adb.exe', 'adb']) {
      const candidate = join(home, 'platform-tools', name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return 'adb';
}

const ADB = adbBinary();

function adb(args) {
  const result = spawnSync(ADB, args, { encoding: 'utf8' });
  if (result.error) {
    fail(
      `no se pudo ejecutar adb (${ADB}).`,
      'Comprueba ANDROID_HOME y que platform-tools esté en el PATH.',
      'Ver docs/runbooks/android-build.md §3.',
    );
  }
  return { status: result.status ?? 1, out: (result.stdout ?? '').trim() };
}

/**
 * El puerto que la `.env` local exige tunelar, o `null` si no exige ninguno.
 *
 * Se lee la `.env` **sólo para saber a dónde apunta**: nada de lo que hay
 * dentro se imprime, y la clave publicable ni siquiera se mira.
 */
function supabasePortFromEnv() {
  if (!existsSync('.env')) return null;

  const line = readFileSync('.env', 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith('EXPO_PUBLIC_SUPABASE_URL='));
  if (!line) return null;

  let parsed;
  try {
    parsed = new URL(line.slice('EXPO_PUBLIC_SUPABASE_URL='.length).trim());
  } catch {
    return null;
  }

  if (!LOOPBACK.has(parsed.hostname)) {
    console.log(
      `  aviso: EXPO_PUBLIC_SUPABASE_URL apunta a "${parsed.hostname}", que no es\n` +
        '         loopback. Funciona, pero queda atado a esta red: al cambiar de Wi-Fi\n' +
        '         habrá que editar la .env otra vez. La forma estable es\n' +
        '         http://127.0.0.1:54321 con el túnel que este script configura.',
    );
    return null;
  }

  return Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
}

/** Un solo aparato, o el que se pidió. Cero o varios sin elegir es un error. */
function resolveDevice() {
  const { status, out } = adb(['devices']);
  if (status !== 0) fail('`adb devices` falló.', out);

  const devices = out
    .split('\n')
    .slice(1)
    .map((line) => line.split('\t'))
    .filter((parts) => parts[1] === 'device')
    .map((parts) => parts[0]);

  if (WANTED_DEVICE) {
    if (!devices.includes(WANTED_DEVICE)) {
      fail(
        `el aparato "${WANTED_DEVICE}" no está conectado.`,
        `Conectados: ${devices.join(', ') || 'ninguno'}`,
      );
    }
    return WANTED_DEVICE;
  }

  if (devices.length === 0) {
    fail(
      'no hay ningún Android conectado.',
      'Arranca el emulador, o conecta el teléfono con depuración USB autorizada.',
    );
  }
  if (devices.length > 1) {
    fail(
      `hay ${devices.length} aparatos conectados y ninguno elegido.`,
      `Usa --device <serie>. Conectados: ${devices.join(', ')}`,
    );
  }
  return devices[0];
}

/** Los túneles vigentes de ese aparato, como puertos del propio aparato. */
function activeReverses(device) {
  const { status, out } = adb(['-s', device, 'reverse', '--list']);
  if (status !== 0) return new Set();

  const ports = new Set();
  for (const line of out.split('\n')) {
    const match = /tcp:(\d+)\s+tcp:(\d+)/.exec(line);
    if (match) ports.add(Number(match[1]));
  }
  return ports;
}

const device = resolveDevice();
console.log(`\n=== Túneles de Android Development · ${device} ===`);

const supabasePort = supabasePortFromEnv();
const wanted = [
  ...(NO_METRO ? [] : [{ port: METRO_PORT, what: 'Metro' }]),
  ...(supabasePort === null ? [] : [{ port: supabasePort, what: 'Supabase (frontera local)' }]),
];

if (NO_METRO) {
  console.log('  (--no-metro: sólo la frontera. Un artefacto de Staging no depende de Metro.)');
}

let missing = 0;
for (const { port, what } of wanted) {
  const present = activeReverses(device).has(port);

  if (present) {
    console.log(`  ok: ${what} — el aparato alcanza 127.0.0.1:${port}`);
    continue;
  }

  if (CHECK_ONLY) {
    missing += 1;
    console.log(`  FALTA: ${what} — no hay túnel para 127.0.0.1:${port}`);
    continue;
  }

  const { status, out } = adb(['-s', device, 'reverse', `tcp:${port}`, `tcp:${port}`]);
  if (status !== 0) {
    missing += 1;
    console.log(`  FALLO: no se pudo abrir el túnel de ${what} (${port}): ${out}`);
  } else {
    console.log(`  puesto: ${what} — el aparato ya alcanza 127.0.0.1:${port}`);
  }
}

if (missing > 0) {
  console.error(
    `\nFaltan ${missing} túnel/es. Sin ellos la aplicación no alcanza nada en 127.0.0.1\n` +
      'desde el aparato, y el síntoma aparece dentro de la app como un fallo de red.\n' +
      `Arréglalo con:  node scripts/android-reverse.mjs --device ${device}\n` +
      'Un túnel se pierde al reconectar el aparato, al reiniciarlo y al reiniciar adb.',
  );
  process.exit(1);
}

console.log('\nOK - el aparato alcanza el ordenador por 127.0.0.1, sin depender de la red.\n');
