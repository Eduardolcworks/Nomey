import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceLocale } from '../../src/lib/i18n/locales';

const device = vi.hoisted(() => ({ locales: [] as DeviceLocale[] }));

/**
 * `expo-localization` es un módulo nativo y bajo Vitest no existe. Se sustituye
 * por los cuatro campos de los que depende la resolución.
 */
vi.mock('expo-localization', () => ({
  getLocales: () => device.locales,
}));

import {
  deviceFormatTag,
  getFormatLocale,
  getLanguagePreference,
  getMessageLocale,
  resetLocaleState,
  setLanguagePreference,
} from '../../src/lib/i18n/active-locale';
import { composeFormatTag } from '../../src/lib/i18n/locales';

/**
 * Idioma e **idioma con región** son dos preguntas distintas, y el dispositivo
 * las responde con campos distintos.
 *
 * `expo-localization` expone dos regiones: `languageRegionCode`, que es la del
 * idioma preferido, y `regionCode`, que es el ajuste **Región** de iOS. Su
 * propia documentación dice que para internacionalización se use la segunda, y
 * `languageTag` lleva la primera. Un iPhone en español de España con la Región
 * en México sigue diciendo `languageTag: 'es-ES'`.
 *
 * Por eso el locale de formato se **compone** —idioma + script + región— en vez
 * de leerse de la etiqueta. Estos tests son los que distinguen una cosa de la
 * otra; con solo `languageTag` todos habrían pasado igual y el bug seguiría ahí.
 */

function locale(partial: Partial<DeviceLocale> & { languageTag: string }): DeviceLocale {
  return {
    languageCode: null,
    languageScriptCode: null,
    regionCode: null,
    ...partial,
  };
}

function withDevice(...locales: DeviceLocale[]) {
  device.locales = locales;
  resetLocaleState();
}

/** Un iPhone: idioma preferido por un lado, ajuste Región por otro. */
function iphone(languageTag: string, languageCode: string, regionCode: string | null) {
  return locale({ languageTag, languageCode, regionCode });
}

beforeEach(() => {
  withDevice(iphone('es-ES', 'es', 'ES'));
});

afterEach(() => {
  resetLocaleState();
});

describe('idioma y región se combinan para el formato', () => {
  it('1 · español de España, región ES', () => {
    withDevice(iphone('es-ES', 'es', 'ES'));
    expect(getMessageLocale()).toBe('es-ES');
    expect(getFormatLocale()).toBe('es-ES');
  });

  it('2 · español de España, región MX', () => {
    // El caso que motivó la corrección: `languageTag` sigue diciendo es-ES.
    withDevice(iphone('es-ES', 'es', 'MX'));
    expect(getMessageLocale()).toBe('es-ES');
    expect(getFormatLocale()).toBe('es-MX');
    expect(getFormatLocale()).not.toBe('es-ES');
  });

  it('3 · inglés británico, región GB', () => {
    withDevice(iphone('en-GB', 'en', 'GB'));
    expect(getMessageLocale()).toBe('en');
    expect(getFormatLocale()).toBe('en-GB');
  });

  it('4 · inglés británico, región US', () => {
    withDevice(iphone('en-GB', 'en', 'US'));
    expect(getMessageLocale()).toBe('en');
    expect(getFormatLocale()).toBe('en-US');
  });

  it('5 · alemán, región DE: catálogo español, formato alemán', () => {
    // Que Nomey no tenga catálogo alemán no dice nada de dónde vive quien lo usa.
    withDevice(iphone('de-DE', 'de', 'DE'));
    expect(getMessageLocale()).toBe('es-ES');
    expect(getFormatLocale()).toBe('de-DE');
  });
});

describe('el override de idioma no toca la región', () => {
  it('6 · inglés GB + override Español', () => {
    withDevice(iphone('en-GB', 'en', 'GB'));
    setLanguagePreference('es-ES');

    expect(getLanguagePreference()).toBe('es-ES');
    expect(getMessageLocale()).toBe('es-ES');
    expect(getFormatLocale()).toBe('en-GB');
  });

  it('7 · español ES + región MX + override English', () => {
    withDevice(iphone('es-ES', 'es', 'MX'));
    setLanguagePreference('en');

    expect(getMessageLocale()).toBe('en');
    expect(getFormatLocale()).toBe('es-MX');
  });

  it('la región aguanta las tres preferencias en cualquier dispositivo', () => {
    const devices = [
      iphone('es-ES', 'es', 'MX'),
      iphone('en-GB', 'en', 'US'),
      iphone('de-DE', 'de', 'DE'),
      iphone('fr-FR', 'fr', 'CA'),
    ];

    for (const entry of devices) {
      const expected = composeFormatTag(entry);
      for (const preference of ['system', 'es-ES', 'en'] as const) {
        withDevice(entry);
        setLanguagePreference(preference);
        expect(getFormatLocale(), `${entry.languageTag} · ${preference}`).toBe(expected);
      }
    }
  });

  it('volver a Automático devuelve el catálogo al dispositivo', () => {
    withDevice(iphone('en-GB', 'en', 'GB'));
    setLanguagePreference('es-ES');
    expect(getMessageLocale()).toBe('es-ES');

    setLanguagePreference('system');
    expect(getMessageLocale()).toBe('en');
    expect(getFormatLocale()).toBe('en-GB');
  });
});

describe('región ausente', () => {
  it('8 · sin regionCode, se conserva el languageTag del dispositivo', () => {
    // No se inventa una región: se usa la que el dispositivo sí supo dar.
    withDevice(iphone('pt-BR', 'pt', null));
    expect(getFormatLocale()).toBe('pt-BR');
    expect(deviceFormatTag()).toBe('pt-BR');
  });

  it('sin languageCode tampoco se compone nada', () => {
    withDevice(locale({ languageTag: 'es-419' }));
    expect(getFormatLocale()).toBe('es-419');
  });

  it('una región vacía cuenta como ausente', () => {
    withDevice(iphone('en-AU', 'en', '   '));
    expect(getFormatLocale()).toBe('en-AU');
  });

  it('sin dispositivo, cae a es-ES en ambos', () => {
    withDevice();
    expect(getMessageLocale()).toBe('es-ES');
    expect(getFormatLocale()).toBe('es-ES');
  });
});

describe('script', () => {
  it('9 · conserva el script cuando el dispositivo lo declara', () => {
    // Perderlo convierte zh-Hant-TW en zh-TW y elige la escritura equivocada.
    withDevice(
      locale({
        languageTag: 'zh-Hant-TW',
        languageCode: 'zh',
        languageScriptCode: 'Hant',
        regionCode: 'TW',
      }),
    );
    expect(getFormatLocale()).toBe('zh-Hant-TW');
  });

  it('el script sobrevive a un cambio de región', () => {
    withDevice(
      locale({
        languageTag: 'zh-Hans-CN',
        languageCode: 'zh',
        languageScriptCode: 'Hans',
        regionCode: 'SG',
      }),
    );
    expect(getFormatLocale()).toBe('zh-Hans-SG');
  });

  it('normaliza la forma del tag', () => {
    expect(
      composeFormatTag(
        locale({
          languageTag: 'ZH-hant-tw',
          languageCode: 'ZH',
          languageScriptCode: 'hANT',
          regionCode: 'tw',
        }),
      ),
    ).toBe('zh-Hant-TW');
  });
});
