import { describe, expect, it, vi } from 'vitest';

import { signOutErrorKey } from '../../src/features/auth/auth-errors';
import { buildSignOutConfirmation } from '../../src/features/auth/sign-out-confirmation';
import { createExclusiveRunner, SKIPPED } from '../../src/features/auth/submit-guard';

/**
 * Cerrar sesión: lo que se puede afirmar sin dispositivo.
 *
 * Tres cosas, y ninguna de ellas es «llama a Supabase»: eso sería probar
 * `auth-js`, que ya está probado y cuya semántica exacta se leyó del paquete
 * instalado y quedó escrita en `auth-service.ts`. Lo que se protege aquí es lo
 * que Nomey decide encima: **qué se le cuenta al usuario cuando falla**, **qué
 * forma tiene la confirmación** y **que un doble toque no sale dos veces**.
 */

describe('el error de cerrar sesión', () => {
  it('un fallo de transporte se cuenta como falta de conexión', () => {
    expect(signOutErrorKey({ name: 'AuthRetryableFetchError' })).toBe('authError.network');
  });

  it('y también cuando no llegó respuesta alguna: ni código ni estado', () => {
    expect(signOutErrorKey({})).toBe('authError.network');
  });

  it('el límite de peticiones sí tiene su propia frase', () => {
    expect(signOutErrorKey({ code: 'over_request_rate_limit', status: 429 })).toBe(
      'authError.rateLimited',
    );
  });

  it('cualquier otra cosa cae en la genérica, nunca en el texto de GoTrue', () => {
    expect(signOutErrorKey({ code: 'algo_que_no_conocemos', status: 500 })).toBe(
      'authError.generic',
    );
  });

  it('no distingue casos que la librería ya se traga', () => {
    /*
     * 401, 403, 404 y «no hay sesión» los absorbe `_signOut` y nunca llegan
     * aquí como error. Si alguien añadiera una frase para ellos estaría
     * escribiendo copy para una rama muerta, y peor: sugeriría que el usuario
     * NO ha salido cuando la librería ya lo ha sacado limpiamente.
     */
    expect(signOutErrorKey({ code: 'session_not_found', status: 404 })).toBe('authError.generic');
  });
});

describe('la confirmación previa', () => {
  const labels = {
    title: '¿Cerrar sesión?',
    body: 'Podrás volver a entrar cuando quieras.',
    cancel: 'Cancelar',
    confirm: 'Cerrar sesión',
  };

  it('lleva el título y el cuerpo que se le dan', () => {
    const confirmation = buildSignOutConfirmation(labels, () => {});
    expect(confirmation.title).toBe(labels.title);
    expect(confirmation.body).toBe(labels.body);
  });

  it('cancelar va primero', () => {
    // Es lo que hace que descartar el diálogo por accidente —tocar fuera, el
    // botón atrás— resuelva a quedarse dentro.
    const confirmation = buildSignOutConfirmation(labels, () => {});
    expect(confirmation.buttons[0].role).toBe('cancel');
    expect(confirmation.buttons[0].label).toBe(labels.cancel);
  });

  it('y no hace nada: cancelar no lleva handler', () => {
    const confirmation = buildSignOutConfirmation(labels, () => {});
    expect(confirmation.buttons[0].onPress).toBeUndefined();
  });

  it('el botón que cierra sesión es el destructivo', () => {
    const confirmation = buildSignOutConfirmation(labels, () => {});
    expect(confirmation.buttons[1].role).toBe('destructive');
  });

  it('el rol no es la única señal: la etiqueta dice lo que pasa', () => {
    // El color nunca es la única señal —regla vinculante de la dirección de
    // diseño—. Un botón «OK» en rojo no dice nada a quien no ve el rojo.
    const confirmation = buildSignOutConfirmation(labels, () => {});
    expect(confirmation.buttons[1].label).toBe(labels.confirm);
    expect(confirmation.buttons[1].label).not.toMatch(/^(OK|Aceptar|Sí)$/i);
  });

  it('solo el botón que confirma ejecuta algo, y solo al pulsarlo', () => {
    const onConfirm = vi.fn();
    const confirmation = buildSignOutConfirmation(labels, onConfirm);

    // Construirla no cierra la sesión de nadie.
    expect(onConfirm).not.toHaveBeenCalled();

    confirmation.buttons[1].onPress?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('son exactamente dos botones', () => {
    expect(buildSignOutConfirmation(labels, () => {}).buttons).toHaveLength(2);
  });
});

describe('el doble toque en Cerrar sesión', () => {
  it('una segunda pulsación mientras corre la primera no llama otra vez', async () => {
    const run = createExclusiveRunner();
    const operation = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true } as const;
    });

    const first = run(operation);
    const second = run(operation);

    expect(await second).toBe(SKIPPED);
    expect(await first).toEqual({ ok: true });
    // Lo que importa: UNA llamada, no dos. Deshabilitar el botón es la mitad
    // visible; entre el toque y el re-render hay una ventana, y esta es la
    // mitad que aguanta.
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('y tras fallar se puede reintentar: el fallo no deja el botón trabado', async () => {
    const run = createExclusiveRunner();
    const failing = vi.fn(async () => {
      await Promise.resolve();
      throw new Error('sin red');
    });

    await expect(run(failing)).rejects.toThrow('sin red');

    const after = vi.fn(async () => ({ ok: true }) as const);
    expect(await run(after)).toEqual({ ok: true });
    expect(after).toHaveBeenCalledTimes(1);
  });
});
