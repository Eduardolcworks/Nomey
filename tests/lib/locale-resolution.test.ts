import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const device = vi.hoisted(() => ({ tags: ['es-ES'] }));

/**
 * `expo-localization` es un módulo nativo y bajo Vitest no existe. Se sustituye
 * por el único dato que la resolución necesita, que es la lista ordenada de
 * etiquetas del dispositivo.
 */
vi.mock('expo-localization', () => ({
  getLocales: () => device.tags.map((languageTag) => ({ languageTag })),
}));

import {
  getFormatLocale,
  getLanguagePreference,
  getMessageLocale,
  resetLocaleState,
  setLanguagePreference,
} from '../../src/lib/i18n/active-locale';

/**
 * Idioma de interfaz y formato regional son cosas distintas.
 *
 * El catálogo dice **en qué idioma se lee** Nomey; el locale de formato dice
 * **cómo se escriben** los importes y las fechas. Un mexicano leyendo español
 * debe ver convenciones mexicanas, y un británico que fuerce el español debe
 * seguir viendo las suyas: ha cambiado de idioma, no de país.
 *
 * Colapsar el segundo en el primero es el fallo que estos tests impiden, y era
 * invisible en un teléfono español, que es donde se probó.
 */

function withDevice(...tags: string[]) {
  device.tags = tags;
  resetLocaleState();
}

beforeEach(() => {
  withDevice('es-ES');
});

afterEach(() => {
  resetLocaleState();
});

describe('Automático', () => {
  it('es-ES: catálogo español y formato español', () => {
    withDevice('es-ES');
    expect(getLanguagePreference()).toBe('system');
    expect(getMessageLocale()).toBe('es-ES');
    expect(getFormatLocale()).toBe('es-ES');
  });

  it('es-MX: catálogo español, formato es-MX', () => {
    withDevice('es-MX');
    expect(getMessageLocale()).toBe('es-ES');
    // Lo que NO debe pasar: que el formato se reduzca al catálogo.
    expect(getFormatLocale()).toBe('es-MX');
    expect(getFormatLocale()).not.toBe('es-ES');
  });

  it('en-GB: catálogo inglés, formato en-GB', () => {
    withDevice('en-GB');
    expect(getMessageLocale()).toBe('en');
    expect(getFormatLocale()).toBe('en-GB');
    expect(getFormatLocale()).not.toBe('en');
  });

  it('de-DE: catálogo de fallback español, pero formato alemán', () => {
    // Que Nomey no tenga catálogo alemán no convierte a este usuario en
    // español: sus importes y sus fechas siguen siendo alemanes.
    withDevice('de-DE');
    expect(getMessageLocale()).toBe('es-ES');
    expect(getFormatLocale()).toBe('de-DE');
  });

  it('respeta el orden de preferencia para el catálogo', () => {
    withDevice('ca-ES', 'en-GB');
    expect(getMessageLocale()).toBe('en');
    // El formato se queda con la primera etiqueta usable, sea cual sea su idioma.
    expect(getFormatLocale()).toBe('ca-ES');
  });
});

describe('override manual', () => {
  it('dispositivo en-GB forzado a español: catálogo es-ES, formato en-GB', () => {
    withDevice('en-GB');
    setLanguagePreference('es-ES');

    expect(getLanguagePreference()).toBe('es-ES');
    expect(getMessageLocale()).toBe('es-ES');
    expect(getFormatLocale()).toBe('en-GB');
  });

  it('dispositivo es-ES forzado a inglés: catálogo en, formato es-ES', () => {
    withDevice('es-ES');
    setLanguagePreference('en');

    expect(getMessageLocale()).toBe('en');
    expect(getFormatLocale()).toBe('es-ES');
  });

  it('el override nunca toca el formato, en ningún dispositivo', () => {
    for (const tag of ['es-MX', 'en-GB', 'de-DE', 'fr-CA']) {
      withDevice(tag);
      for (const preference of ['system', 'es-ES', 'en'] as const) {
        setLanguagePreference(preference);
        expect(getFormatLocale(), `${tag} · ${preference}`).toBe(tag);
      }
    }
  });

  it('volver a Automático devuelve el catálogo al dispositivo', () => {
    withDevice('en-GB');
    setLanguagePreference('es-ES');
    expect(getMessageLocale()).toBe('es-ES');

    setLanguagePreference('system');
    expect(getLanguagePreference()).toBe('system');
    expect(getMessageLocale()).toBe('en');
    expect(getFormatLocale()).toBe('en-GB');
  });
});

describe('dispositivo sin etiquetas usables', () => {
  it('cae a es-ES en ambos', () => {
    withDevice();
    expect(getMessageLocale()).toBe('es-ES');
    expect(getFormatLocale()).toBe('es-ES');
  });

  it('ignora una etiqueta vacía', () => {
    withDevice('', 'en-GB');
    expect(getMessageLocale()).toBe('en');
    expect(getFormatLocale()).toBe('en-GB');
  });
});
