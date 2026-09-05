import { describe, expect, it } from 'vitest';

import { chooseDevice, parseDevices } from '../../scripts/android-reverse.mjs';

/** Lo que `parseDevices` devuelve. El helper es `.mjs` y no lleva tipos. */
type Device = { readonly serial: string; readonly state: string };

/**
 * Leer `adb devices` sin equivocarse de aparato.
 *
 * **El defecto que fija, encontrado con el POCO y el emulador conectados a la
 * vez.** El parseo comparaba el estado contra `"device"`, pero en Windows cada
 * línea termina en CRLF y llega `"device\r"`. Como la salida se recortaba
 * entera y no línea a línea, sólo la ÚLTIMA perdía el `\r`: con un aparato el
 * script acertaba por casualidad y con dos reconocía sólo el último, dando por
 * «no conectado» a uno que estaba enchufado y listo.
 *
 * Peor que un fallo: parecía una respuesta. De ahí que estas pruebas usen
 * salidas literales de `adb`, con sus finales de línea, en vez de comprobar que
 * el fuente contiene un `.trim()`.
 */

const LF = 'List of devices attached\n96afa2bdf3bb\tdevice\nemulator-5554\tdevice\n\n';
const CRLF = 'List of devices attached\r\n96afa2bdf3bb\tdevice\r\nemulator-5554\tdevice\r\n\r\n';
const CRLF_INVERTIDO =
  'List of devices attached\r\nemulator-5554\tdevice\r\n96afa2bdf3bb\tdevice\r\n\r\n';
const UNO = 'List of devices attached\r\n96afa2bdf3bb\tdevice\r\n\r\n';
const OFFLINE =
  'List of devices attached\r\n96afa2bdf3bb\toffline\r\nemulator-5554\tdevice\r\n\r\n';
const SIN_AUTORIZAR =
  'List of devices attached\r\n96afa2bdf3bb\tunauthorized\r\nemulator-5554\tdevice\r\n\r\n';
const VACIO = 'List of devices attached\r\n\r\n';

const POCO = '96afa2bdf3bb';

describe('parsear la lista de aparatos', () => {
  it('con finales de línea de Unix', () => {
    expect(parseDevices(LF)).toEqual([
      { serial: POCO, state: 'device' },
      { serial: 'emulator-5554', state: 'device' },
    ]);
  });

  it('y con CRLF, que es lo que da Windows', () => {
    // La prueba que faltaba: aquí es donde el estado llegaba como `device\r`.
    expect(parseDevices(CRLF)).toEqual([
      { serial: POCO, state: 'device' },
      { serial: 'emulator-5554', state: 'device' },
    ]);
  });

  it('no depende del orden: los dos se ven, estén como estén', () => {
    const directo = parseDevices(CRLF)
      .map((d: Device) => d.serial)
      .sort();
    const invertido = parseDevices(CRLF_INVERTIDO)
      .map((d: Device) => d.serial)
      .sort();
    expect(directo).toEqual(invertido);
    expect(directo).toEqual([POCO, 'emulator-5554'].sort());
  });

  it('distingue device, offline y unauthorized en vez de tratarlos igual', () => {
    expect(parseDevices(OFFLINE)).toContainEqual({ serial: POCO, state: 'offline' });
    expect(parseDevices(SIN_AUTORIZAR)).toContainEqual({ serial: POCO, state: 'unauthorized' });
  });

  it('la cabecera y las líneas en blanco no son aparatos', () => {
    expect(parseDevices(VACIO)).toEqual([]);
    expect(parseDevices(CRLF).some((d: Device) => d.serial.startsWith('List'))).toBe(false);
  });
});

describe('elegir el aparato', () => {
  it('con uno solo y sin selector, lo coge', () => {
    expect(chooseDevice(parseDevices(UNO), null)).toEqual({ device: POCO });
  });

  it('con dos y un serial explícito, coge EXACTAMENTE ése', () => {
    // El caso que fallaba: el POCO no era el último de la lista.
    expect(chooseDevice(parseDevices(CRLF), POCO)).toEqual({ device: POCO });
    expect(chooseDevice(parseDevices(CRLF), 'emulator-5554')).toEqual({
      device: 'emulator-5554',
    });
    // Y da igual el orden en que adb los liste.
    expect(chooseDevice(parseDevices(CRLF_INVERTIDO), POCO)).toEqual({ device: POCO });
  });

  it('con dos y sin selector, se niega en vez de elegir por su cuenta', () => {
    /*
     * Crear el túnel en el aparato equivocado es indistinguible de no crearlo
     * hasta mucho después, dentro de la aplicación. Más vale parar.
     */
    const resultado = chooseDevice(parseDevices(CRLF), null);
    expect(resultado.device).toBeUndefined();
    expect(resultado.error).toMatch(/ninguno elegido/);
    expect(resultado.detail).toContain('--device');
    expect(resultado.detail).toContain(POCO);
  });

  it('un serial que no está conectado se dice, con lo que sí hay', () => {
    const resultado = chooseDevice(parseDevices(CRLF), 'no-existe');
    expect(resultado.device).toBeUndefined();
    expect(resultado.error).toContain('no-existe');
    expect(resultado.detail).toContain(POCO);
  });

  it('un aparato offline NO se usa, y se nombra su estado', () => {
    const resultado = chooseDevice(parseDevices(OFFLINE), POCO);
    expect(resultado.device).toBeUndefined();
    expect(resultado.error).toContain('offline');
  });

  it('uno sin autorizar tampoco, y dice qué hay que hacer', () => {
    const resultado = chooseDevice(parseDevices(SIN_AUTORIZAR), POCO);
    expect(resultado.device).toBeUndefined();
    expect(resultado.error).toContain('unauthorized');
    expect(resultado.detail).toMatch(/depuración USB/);
  });

  it('sin ninguno listo, lo dice — y menciona los que hay a medias', () => {
    expect(chooseDevice(parseDevices(VACIO), null).error).toMatch(/ningún Android listo/);

    const soloOffline = parseDevices('List of devices attached\r\n96afa2bdf3bb\toffline\r\n\r\n');
    const resultado = chooseDevice(soloOffline, null);
    expect(resultado.device).toBeUndefined();
    expect(resultado.detail).toContain('offline');
  });

  it('un offline junto a uno listo no cuenta como ambigüedad', () => {
    // Sólo hay un aparato que acepte un reverse, así que no hay nada que elegir.
    expect(chooseDevice(parseDevices(OFFLINE), null)).toEqual({ device: 'emulator-5554' });
  });
});
