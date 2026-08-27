import { describe, expect, it } from 'vitest';

import { CATALOGUES } from '../../src/lib/i18n/messages';
import { esES } from '../../src/lib/i18n/messages/es-ES';
import { FALLBACK_LOCALE, resolveLocale, SUPPORTED_LOCALES } from '../../src/lib/i18n/locales';
import { translate } from '../../src/lib/i18n/translate';

/**
 * i18n puro: catálogos, resolución de locale e interpolación.
 *
 * No toca `active-locale.ts`, que lee el módulo nativo de `expo-localization` y
 * no tiene runtime bajo Vitest. Esa parte se mide en el dispositivo.
 */

describe('resolución de locale', () => {
  it('usa el idioma del dispositivo cuando está soportado', () => {
    expect(resolveLocale(['es-ES'])).toBe('es-ES');
    expect(resolveLocale(['en'])).toBe('en');
  });

  it('resuelve por subetiqueta de idioma, no por coincidencia exacta', () => {
    expect(resolveLocale(['es-MX'])).toBe('es-ES');
    expect(resolveLocale(['es-419'])).toBe('es-ES');
    expect(resolveLocale(['en-GB'])).toBe('en');
    expect(resolveLocale(['en-US'])).toBe('en');
  });

  it('ignora mayúsculas y espacios', () => {
    expect(resolveLocale(['  EN-us '])).toBe('en');
    expect(resolveLocale(['ES'])).toBe('es-ES');
  });

  it('cae al fallback cuando el idioma no está soportado', () => {
    expect(resolveLocale(['de-DE'])).toBe(FALLBACK_LOCALE);
    expect(resolveLocale(['ja-JP', 'ko-KR'])).toBe(FALLBACK_LOCALE);
    expect(resolveLocale([])).toBe(FALLBACK_LOCALE);
    expect(resolveLocale([''])).toBe(FALLBACK_LOCALE);
  });

  it('respeta el orden de preferencia del dispositivo', () => {
    // Un dispositivo en catalán con inglés de segunda debe dar inglés, no el
    // fallback —que también es español y taparía el error—.
    expect(resolveLocale(['ca-ES', 'en-GB'])).toBe('en');
    expect(resolveLocale(['de-DE', 'es-AR'])).toBe('es-ES');
  });

  it('el fallback es un locale soportado', () => {
    expect(SUPPORTED_LOCALES).toContain(FALLBACK_LOCALE);
  });
});

describe('catálogos', () => {
  const keys = Object.keys(esES) as (keyof typeof esES)[];

  it.each(SUPPORTED_LOCALES)('%s traduce todas las claves y ninguna queda vacía', (locale) => {
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
      for (const locale of SUPPORTED_LOCALES) {
        expect(placeholders(CATALOGUES[locale][key]), `${locale} · ${key}`).toEqual(expected);
      }
    }
  });

  it('ningún catálogo lleva un símbolo monetario ni un formato de fecha', () => {
    // AGENTS.md section 6: ni el símbolo ni el formato se codifican. Si un día
    // hacen falta, entran por interpolación desde `lib/format`.
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of keys) {
        expect(CATALOGUES[locale][key], `${locale} · ${key}`).not.toMatch(/[€$£¥]/);
        expect(CATALOGUES[locale][key], `${locale} · ${key}`).not.toMatch(/\bDD?\/MM\b|\bMM\/DD\b/);
      }
    }
  });
});

describe('interpolación', () => {
  it('sustituye los parámetros presentes', () => {
    expect(translate('es-ES', 'locale.device', { tag: 'es-CL' })).toBe('Idioma del sistema: es-CL');
    expect(translate('en', 'locale.device', { tag: 'en-GB' })).toBe('System language: en-GB');
  });

  it('acepta números sin convertirlos en el llamante', () => {
    expect(translate('en', 'runtime.exactPath', { path: 2 })).toBe('Exact path: 2');
  });

  it('deja el placeholder visible si falta el parámetro', () => {
    // Un `{tag}` en pantalla es un informe de bug; un hueco vacío es un misterio.
    expect(translate('es-ES', 'locale.device', {})).toBe('Idioma del sistema: {tag}');
    expect(translate('es-ES', 'locale.device')).toBe('Idioma del sistema: {tag}');
  });

  it('devuelve el texto tal cual cuando no hay placeholders', () => {
    expect(translate('es-ES', 'foundation.palette')).toBe('Paleta');
    expect(translate('en', 'foundation.palette')).toBe('Palette');
  });
});
