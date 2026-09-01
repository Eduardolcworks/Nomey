import { afterEach, describe, expect, it, vi } from 'vitest';

import { newClientOperationId } from '../../src/lib/id';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const original = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
  vi.restoreAllMocks();
});

function withCrypto(value: unknown) {
  Object.defineProperty(globalThis, 'crypto', { value, configurable: true });
}

describe('la clave de idempotencia', () => {
  /**
   * La versión y la variante no son decoración: la frontera valida la forma, y
   * un identificador con los bits sueltos se rechazaría como payload inválido
   * en vez de escribir el movimiento.
   */
  it('tiene forma de UUID v4 en los tres escalones', () => {
    for (const source of [
      undefined,
      { getRandomValues: (a: Uint8Array) => a.fill(0xab) },
      { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
    ]) {
      withCrypto(source);
      expect(newClientOperationId(), String(source)).toMatch(V4);
    }
  });

  it('usa la fuente fuerte cuando existe', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555');
    withCrypto({ randomUUID });
    expect(newClientOperationId()).toBe('11111111-2222-4333-8444-555555555555');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('cae en `getRandomValues` antes que en `Math.random`', () => {
    const getRandomValues = vi.fn((a: Uint8Array) => a.fill(0x11));
    withCrypto({ getRandomValues });
    const id = newClientOperationId();
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(id).toMatch(V4);
    // Los bits fijos se imponen sobre lo que devuelva la fuente.
    expect(id).toBe('11111111-1111-4111-9111-111111111111');
  });

  /**
   * **Y funciona sin `crypto` ninguno**, que es el caso real del aparato: ni
   * Hermes ni el runtime de React Native exponen `globalThis.crypto`. Sin este
   * escalón la pantalla no podría enviar nada.
   */
  it('funciona sin crypto, que es lo que pasa en el aparato', () => {
    withCrypto(undefined);
    expect(newClientOperationId()).toMatch(V4);
  });

  it('no se lee la fuente una sola vez al importar', () => {
    withCrypto(undefined);
    const sinFuente = newClientOperationId();
    withCrypto({ randomUUID: () => '99999999-9999-4999-8999-999999999999' });
    // Si la fuente se hubiera capturado al cargar el módulo, esto seguiría
    // devolviendo un identificador del escalón débil.
    expect(newClientOperationId()).toBe('99999999-9999-4999-8999-999999999999');
    expect(sinFuente).not.toBe(newClientOperationId());
  });

  it('dos llamadas seguidas no dan la misma clave', () => {
    withCrypto(undefined);
    const ids = new Set(Array.from({ length: 500 }, () => newClientOperationId()));
    expect(ids.size).toBe(500);
  });
});
