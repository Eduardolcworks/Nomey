import { describe, expect, it } from 'vitest';

import FIELD from '../../src/features/auth/auth-field.tsx?raw';
import ICON_BUTTON from '../../src/ui/components/icon-button.tsx?raw';
import SIGN_IN from '../../src/app/(auth)/sign-in.tsx?raw';
import SIGN_UP from '../../src/app/(auth)/sign-up.tsx?raw';
import FORGOT from '../../src/app/(auth)/forgot-password.tsx?raw';
import NEW_PASSWORD from '../../src/app/(recovery)/new-password.tsx?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import EN from '../../src/lib/i18n/messages/en.ts?raw';

/**
 * El cableado del ojo, que no cabe en una función pura.
 *
 * **Lo que se prueba en otro sitio.** La lógica —oculto de partida, alternar,
 * nombre y estado accesibles, quién manda sobre `secureTextEntry`— vive en
 * `field-appearance.ts` y se interroga por comportamiento en
 * `tests/lib/auth-field-appearance.test.ts`. Aquí queda sólo lo que es
 * estructura y no cálculo: dónde se monta el botón, qué alcance tiene y qué
 * hueco reserva. Sin renderer de React no hay forma de preguntárselo a un árbol
 * montado, y añadir uno era una dependencia que no se ha aprobado.
 */

describe('el ojo está en Entrar y en ningún otro formulario', () => {
  it('revisa de verdad lo que dice revisar', () => {
    expect(FIELD).toContain('revealable');
    expect(SIGN_IN).toContain('AuthField');
  });

  it('sólo la contraseña de Entrar lo pide', () => {
    // El alcance se acordó acotado: el alta, la recuperación y la contraseña
    // nueva se quedan exactamente como estaban.
    expect(SIGN_IN).toMatch(/^\s*revealable$/m);
    for (const [name, source] of [
      ['sign-up', SIGN_UP],
      ['forgot-password', FORGOT],
      ['new-password', NEW_PASSWORD],
    ] as const) {
      expect(source, `${name} no debe pedir el ojo`).not.toContain('revealable');
    }
  });

  it('y el campo lo deja apagado por defecto, así que nadie lo hereda sin pedirlo', () => {
    expect(FIELD).toContain('revealable = false');
  });
});

describe('el botón reserva su sitio y no envía nada', () => {
  it('el texto no puede quedar debajo del icono', () => {
    // Sin este relleno el valor pasa por debajo del ojo y se lee a medias.
    expect(FIELD).toContain('paddingRight: REVEAL_WIDTH');
    expect(FIELD).toContain('revealable && styles.inputWithReveal');
  });

  it('su única acción es alternar: no llama a enviar ni a nada del formulario', () => {
    const button = FIELD.slice(
      FIELD.indexOf('<IconButton'),
      FIELD.indexOf('</View>', FIELD.indexOf('<IconButton')),
    );
    expect(button).toContain('onPress={() => setRevealed(nextRevealed)}');
    expect(button).not.toMatch(/onSubmit|submit|signIn/i);
  });

  it('el blanco es de 44 y el glifo se queda pequeño', () => {
    // El área táctil la pone `IconButton`; el icono va a 20 para no engordar
    // visualmente dentro del campo.
    expect(ICON_BUTTON).toContain('width: 44');
    expect(ICON_BUTTON).toContain('height: 44');
    expect(FIELD).toContain('size={20}');
  });

  it('anuncia rol de botón y un estado, no sólo un nombre', () => {
    expect(ICON_BUTTON).toContain('accessibilityRole="button"');
    expect(ICON_BUTTON).toContain('selected');
    expect(FIELD).toContain('selected={reveal.selected}');
  });

  it('las dos etiquetas existen en los dos idiomas', () => {
    for (const [name, catalogue] of [
      ['es-ES', ES],
      ['en', EN],
    ] as const) {
      expect(catalogue, name).toContain("'auth.showPassword'");
      expect(catalogue, name).toContain("'auth.hidePassword'");
    }
    expect(ES).toContain("'auth.showPassword': 'Mostrar contraseña'");
    expect(ES).toContain("'auth.hidePassword': 'Ocultar contraseña'");
  });
});

describe('el error de Entrar conserva su prioridad', () => {
  it('sigue anunciándose como región viva, y ni el ojo ni el contorno la tocan', () => {
    /*
     * El aviso se pinta DESPUÉS del formulario y se anuncia solo: su prioridad
     * no viene del orden en el fuente sino de ser una región viva, así que eso
     * es lo que se vigila. Y el campo no sabe nada del error —lo dice la
     * pantalla—, de modo que ni el contorno ni el ojo pueden pisarlo: ninguno
     * de los dos aparece dentro del bloque que lo renderiza.
     */
    expect(SIGN_IN).toContain('accessibilityLiveRegion="polite"');

    const aviso = SIGN_IN.slice(SIGN_IN.indexOf('{error === undefined'));
    expect(aviso).not.toContain('revealable');
    expect(aviso).not.toContain('AuthField');
  });
});
