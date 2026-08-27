import { describe, expect, it } from 'vitest';

import { CATALOGUES } from '../../src/lib/i18n/messages';
import { esES } from '../../src/lib/i18n/messages/es-ES';
import {
  FALLBACK_MESSAGE_LOCALE,
  MESSAGE_LOCALES,
  resolveMessageLocale,
} from '../../src/lib/i18n/locales';
import { translate } from '../../src/lib/i18n/translate';

/**
 * i18n puro: catálogos, resolución de locale e interpolación.
 *
 * No toca `active-locale.ts`, que lee el módulo nativo de `expo-localization` y
 * no tiene runtime bajo Vitest. Esa parte se mide en el dispositivo.
 */

describe('resolución del catálogo', () => {
  it('usa el idioma del dispositivo cuando está soportado', () => {
    expect(resolveMessageLocale(['es-ES'])).toBe('es-ES');
    expect(resolveMessageLocale(['en'])).toBe('en');
  });

  it('resuelve por subetiqueta de idioma, no por coincidencia exacta', () => {
    expect(resolveMessageLocale(['es-MX'])).toBe('es-ES');
    expect(resolveMessageLocale(['es-419'])).toBe('es-ES');
    expect(resolveMessageLocale(['en-GB'])).toBe('en');
    expect(resolveMessageLocale(['en-US'])).toBe('en');
  });

  it('ignora mayúsculas y espacios', () => {
    expect(resolveMessageLocale(['  EN-us '])).toBe('en');
    expect(resolveMessageLocale(['ES'])).toBe('es-ES');
  });

  it('cae al fallback cuando el idioma no está soportado', () => {
    expect(resolveMessageLocale(['de-DE'])).toBe(FALLBACK_MESSAGE_LOCALE);
    expect(resolveMessageLocale(['ja-JP', 'ko-KR'])).toBe(FALLBACK_MESSAGE_LOCALE);
    expect(resolveMessageLocale([])).toBe(FALLBACK_MESSAGE_LOCALE);
    expect(resolveMessageLocale([''])).toBe(FALLBACK_MESSAGE_LOCALE);
  });

  it('respeta el orden de preferencia del dispositivo', () => {
    // Un dispositivo en catalán con inglés de segunda debe dar inglés, no el
    // fallback —que también es español y taparía el error—.
    expect(resolveMessageLocale(['ca-ES', 'en-GB'])).toBe('en');
    expect(resolveMessageLocale(['de-DE', 'es-AR'])).toBe('es-ES');
  });

  it('el fallback es un locale soportado', () => {
    expect(MESSAGE_LOCALES).toContain(FALLBACK_MESSAGE_LOCALE);
  });
});

describe('catálogos', () => {
  const keys = Object.keys(esES) as (keyof typeof esES)[];

  it.each(MESSAGE_LOCALES)('%s traduce todas las claves y ninguna queda vacía', (locale) => {
    const catalogue = CATALOGUES[locale];
    expect(Object.keys(catalogue).sort()).toEqual(keys.slice().sort());
    for (const key of keys) {
      expect(catalogue[key].trim().length, `${locale} · ${key}`).toBeGreaterThan(0);
    }
  });

  it('ningún catálogo deja un placeholder sin su pareja en el resto', () => {
    const placeholders = (text: string) => (text.match(/\{(\w+)\}/g) ?? []).sort();

    for (const key of keys) {
      const expected = placeholders(esES[key]);
      for (const locale of MESSAGE_LOCALES) {
        expect(placeholders(CATALOGUES[locale][key]), `${locale} · ${key}`).toEqual(expected);
      }
    }
  });

  it('ningún catálogo lleva un símbolo monetario ni un formato de fecha', () => {
    // AGENTS.md section 6: ni el símbolo ni el formato se codifican. Si un día
    // hacen falta, entran por interpolación desde `lib/format`.
    for (const locale of MESSAGE_LOCALES) {
      for (const key of keys) {
        expect(CATALOGUES[locale][key], `${locale} · ${key}`).not.toMatch(/[€$£¥]/);
        expect(CATALOGUES[locale][key], `${locale} · ${key}`).not.toMatch(/\bDD?\/MM\b|\bMM\/DD\b/);
      }
    }
  });
});

describe('interpolación', () => {
  it('sustituye los parámetros presentes', () => {
    expect(translate('es-ES', 'runtime.exactPath', { path: '50,00' })).toBe('Ruta exacta: 50,00');
    expect(translate('en', 'runtime.exactPath', { path: '50.00' })).toBe('Exact path: 50.00');
  });

  it('acepta números sin convertirlos en el llamante', () => {
    expect(translate('en', 'runtime.exactPath', { path: 2 })).toBe('Exact path: 2');
  });

  it('deja el placeholder visible si falta el parámetro', () => {
    // Un `{tag}` en pantalla es un informe de bug; un hueco vacío es un misterio.
    expect(translate('es-ES', 'runtime.exactPath', {})).toBe('Ruta exacta: {path}');
    expect(translate('es-ES', 'runtime.exactPath')).toBe('Ruta exacta: {path}');
  });

  it('devuelve el texto tal cual cuando no hay placeholders', () => {
    expect(translate('es-ES', 'foundation.palette')).toBe('Paleta');
    expect(translate('en', 'foundation.palette')).toBe('Palette');
  });
});
