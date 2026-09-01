/**
 * El identificador que hace idempotente un comando monetario.
 *
 * ADR-010 lo define como un UUID que **genera el cliente antes del primer
 * intento** y que el servidor compara por `(actor, client_operation_id)` sobre
 * todas las clases de operación. Aquí sólo se genera; quién lo conserva entre
 * reintentos es de quien construye la intención.
 *
 * **React Native no trae `crypto`.** Ni Hermes ni el runtime de RN 0.86
 * exponen `globalThis.crypto`, así que no hay una fuente criptográfica
 * disponible sin añadir dependencia. Se degrada en tres escalones, del más
 * fuerte al que siempre existe.
 *
 * **Y esto es uniquicidad, no imprevisibilidad** — la distinción importa
 * porque el escalón débil sólo es aceptable bajo la segunda lectura:
 *
 * - la clave **no es una capacidad**. El servidor la compara junto al actor,
 *   que sale del JWT, así que adivinar la de otra persona no da acceso a nada:
 *   el par sería distinto igualmente;
 * - la clave **no es un secreto**. Viaja en el payload y se guarda en claro;
 * - lo único que hace falta es que dos intenciones distintas del **mismo
 *   actor** no colisionen. Con 122 bits, incluso desde una fuente no
 *   criptográfica, la probabilidad de colisión para el volumen de comandos que
 *   una persona genera en su vida es despreciable frente a cualquier otro modo
 *   de fallo del sistema.
 *
 * Lo que **no** se afirma: que el escalón de `Math.random` valga para nada que
 * sí sea un secreto o una capacidad. Para eso haría falta una fuente real, y
 * eso es una dependencia que nadie ha aprobado.
 */

type MaybeCrypto = {
  randomUUID?: () => string;
  getRandomValues?: <T extends Uint8Array>(array: T) => T;
};

/**
 * Los dieciséis bytes del UUID, de la mejor fuente que haya.
 *
 * Se lee `globalThis` en cada llamada y no una vez al importar: en el runtime
 * de la app el polyfill podría llegar después que este módulo, y una constante
 * capturada al cargar habría fijado el escalón más débil para siempre.
 */
function randomBytes(): Uint8Array {
  const source = (globalThis as { crypto?: MaybeCrypto }).crypto;
  const bytes = new Uint8Array(16);

  if (typeof source?.getRandomValues === 'function') {
    return source.getRandomValues(bytes);
  }

  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function hex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

/**
 * Un UUID versión 4, con sus dos campos fijos puestos.
 *
 * La versión y la variante no son decoración: la frontera valida la forma, y
 * un identificador con los bits sueltos se rechazaría como payload inválido en
 * vez de escribir el movimiento.
 */
export function newClientOperationId(): string {
  const direct = (globalThis as { crypto?: MaybeCrypto }).crypto?.randomUUID;
  if (typeof direct === 'function')
    return direct.call((globalThis as { crypto: MaybeCrypto }).crypto);

  const bytes = randomBytes();
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122

  const s = Array.from(bytes, hex).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
