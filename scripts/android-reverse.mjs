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
import { pathToFileURL } from 'node:url';

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

/**
 * LO QUE `adb devices` DICE, LEÍDO SIN CONFIAR EN LOS FINALES DE LÍNEA.
 *
 * **El defecto que corrige, encontrado con el POCO y el emulador a la vez.** En
 * Windows cada línea termina en CRLF, así que el estado llega como `"device\r"`
 * y una comparación contra `"device"` no casa nunca. Como la salida se
 * recortaba **entera** y no línea a línea, el `\r` sólo desaparecía de la
 * ÚLTIMA: con un solo aparato el script funcionaba por casualidad y con dos
 * reconocía sólo el último, dando por «no conectado» al que sí lo estaba. Peor
 * que fallar, porque parecía una respuesta.
 *
 * Se exporta para poder probarlo con salidas de verdad —LF, CRLF, uno, dos,
 * invertidos, `offline`, `unauthorized`— sin necesitar un `adb` de mentira.
 */
export function parseDevices(out) {
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('List of devices'))
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
    })
    .filter((entry) => entry.serial !== undefined && entry.state !== undefined);
}

/**
 * Elige el aparato, o se niega.
 *
 * **`device` no es lo mismo que estar conectado.** Un `offline` o un
 * `unauthorized` aparecen en la lista y no aceptan un `reverse`; decirlo por su
 * nombre ahorra el rato de mirar por qué «no funciona» un teléfono que está
 * enchufado y esperando que alguien acepte la depuración en su pantalla.
 *
 * Y con varios conectados **nunca elige por su cuenta**: crear el túnel en el
 * aparato equivocado es indistinguible de no crearlo hasta mucho después.
 */
export function chooseDevice(entries, wanted) {
  const ready = entries.filter((entry) => entry.state === 'device');

  if (wanted !== null && wanted !== undefined) {
    const found = entries.find((entry) => entry.serial === wanted);
    if (found === undefined) {
      return {
        error: `el aparato "${wanted}" no está conectado.`,
        detail: `Conectados: ${entries.map((e) => `${e.serial} (${e.state})`).join(', ') || 'ninguno'}`,
      };
    }
    if (found.state !== 'device') {
      return {
        error: `el aparato "${wanted}" está en estado "${found.state}", no "device".`,
        detail:
          found.state === 'unauthorized'
            ? 'Acepta la depuración USB en la pantalla del aparato.'
            : 'Reconecta el cable o reinicia adb: en ese estado no acepta un reverse.',
      };
    }
    return { device: found.serial };
  }

  if (ready.length === 0) {
    const pending = entries.filter((entry) => entry.state !== 'device');
    return {
      error: 'no hay ningún Android listo.',
      detail:
        pending.length > 0
          ? `Hay ${pending.map((e) => `${e.serial} (${e.state})`).join(', ')}, que no aceptan un reverse.`
          : 'Arranca el emulador, o conecta el teléfono con depuración USB autorizada.',
    };
  }

  if (ready.length > 1) {
    return {
      error: `hay ${ready.length} aparatos listos y ninguno elegido.`,
      detail: `Usa --device <serie>. Listos: ${ready.map((e) => e.serial).join(', ')}`,
    };
  }

  return { device: ready[0].serial };
}

function resolveDevice() {
  const { status, out } = adb(['devices']);
  if (status !== 0) fail('`adb devices` falló.', out);

  const chosen = chooseDevice(parseDevices(out), WANTED_DEVICE);
  if (chosen.error !== undefined) fail(chosen.error, chosen.detail);
  return chosen.device;
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

/**
 * El programa, separado de sus piezas.
 *
 * Sin esta guarda, importar el fichero para probar `parseDevices` y
 * `chooseDevice` lanzaria adb y podria crear tuneles: una prueba que cambia el
 * aparato de quien la ejecuta no es una prueba.
 */
function main() {
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
}

// Sólo cuando se ejecuta, nunca al importarlo.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
