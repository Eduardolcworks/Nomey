import { describe, expect, it } from 'vitest';

import HOME from '../../src/app/(tabs)/index.tsx?raw';
import HEADER from '../../src/features/shell/home-greeting.tsx?raw';
import { esES } from '../../src/lib/i18n/messages/es-ES';
import { en } from '../../src/lib/i18n/messages/en';

/**
 * De dónde sale el nombre del saludo.
 *
 * Inicio enseñaba «Hola, tu nombre» —un literal de la Fase 4, escrito cuando
 * no existía ninguna sesión— y siguió enseñándolo después de un login real,
 * porque nunca estuvo conectado a nada. El fallo no era visible para ningún
 * test: la cadena estaba en el catálogo, así que la higiene de i18n pasaba
 * tranquilamente.
 *
 * Aquí se fija lo que impide que vuelva: **el placeholder no existe** y el
 * nombre **llega desde la sesión** en vez de estar escrito en el componente.
 *
 * Se lee el fuente porque no hay renderer, y montar uno para esto sería
 * probar React. La comprobación de verdad es el dispositivo.
 */

describe('el saludo de Inicio', () => {
  it('el catálogo ya no tiene ningún placeholder de nombre', () => {
    expect(Object.keys(esES)).not.toContain('home.namePlaceholder');
    expect(Object.keys(en)).not.toContain('home.namePlaceholder');
  });

  it('y ninguna cadena del catálogo dice «tu nombre»', () => {
    // La regresión exacta: un saludo que finge conocer al usuario.
    for (const value of Object.values(esES)) {
      expect(value.toLowerCase()).not.toContain('tu nombre');
    }
    for (const value of Object.values(en)) {
      expect(value.toLowerCase()).not.toContain('your name');
    }
  });

  it('hay un saludo sin nombre para cuando no lo haya', () => {
    expect(esES['home.greetingPlain']).toBeTruthy();
    expect(en['home.greetingPlain']).toBeTruthy();
    // Neutro: saluda y no inventa.
    expect(esES['home.greetingPlain']).not.toMatch(/\{/);
  });

  describe('la cabecera', () => {
    it('recibe el nombre, no lo busca', () => {
      expect(HEADER).toContain('name?: string | null');
    });

    it('no importa la sesión: `features/shell` no puede ver `features/session`', () => {
      // Lo impide ESLint; aquí queda dicho por qué el nombre viaja como prop.
      expect(HEADER).not.toContain('@/features/session');
    });

    it('cae al saludo sin nombre cuando llega vacío o ausente', () => {
      expect(HEADER).toContain("t('home.greetingPlain')");
      expect(HEADER).toMatch(/name === null[\s\S]{0,80}=== ''/);
    });
  });

  describe('Inicio', () => {
    it('toma el nombre de la sesión', () => {
      expect(HOME).toContain('useSession');
      expect(HOME).toMatch(/state\.identity\.displayName/);
    });

    it('se lo pasa a la cabecera', () => {
      expect(HOME).toMatch(/<HomeGreeting name=\{greetingName\}/);
    });

    it('lo deriva en cada render, sin copiarlo a un estado aparte', () => {
      // Copiarlo a `useState` congelaría el saludo hasta un reload; derivarlo
      // hace que un USER_UPDATED lo mueva solo.
      expect(HOME).not.toMatch(/useState[^\n]*[Nn]ame/);
    });
  });
});
