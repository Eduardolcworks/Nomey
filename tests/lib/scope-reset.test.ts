import { describe, expect, it } from 'vitest';

import SCOPE_CONTEXT from '../../src/features/shell/scope-context.tsx?raw';
import LAYOUT from '../../src/app/_layout.tsx?raw';
import ACCOUNT from '../../src/app/account.tsx?raw';
import { identityKey, stateFromUser } from '../../src/features/session/session-state';
import { INITIAL_SCOPE } from '../../src/features/shell/scope-context';

/**
 * Que el ámbito no sobreviva al cambio de cuenta.
 *
 * El fallo que se previene no da error y no se ve: alguien cierra sesión con
 * Pareja seleccionado, entra otra persona, y la app le abre los libros de
 * Pareja. Personal y Pareja son dos conjuntos de cuentas distintos, no dos
 * filtros, así que heredar la selección apunta el camino más rápido de la app
 * a los libros de otro.
 *
 * Dos mitades. La primera —de quién es la sesión— es pura y se prueba
 * ejecutándola. La segunda —CUÁNDO ocurre el reset— no se puede montar sin
 * renderer, y montar uno sería probar React; se fija sobre el fuente, y la
 * comprobación de verdad es el dispositivo.
 */

describe('la clave de identidad', () => {
  it('con sesión es el id del usuario', () => {
    expect(
      identityKey({
        status: 'signed-in',
        identity: { userId: 'abc-123', email: 'a@example.com', displayName: 'Eduardo' },
      }),
    ).toBe('abc-123');
  });

  it('sin sesión es null: cerrar sesión cambia la clave', () => {
    expect(identityKey({ status: 'signed-out' })).toBeNull();
  });

  it('y también mientras se restaura o si no se sabe', () => {
    /*
     * Los tres se colapsan en `null` a propósito. Para lo que esto sirve son
     * lo mismo: no hay usuario, así que no debe conservarse estado de usuario.
     * Distinguirlos aquí haría que un `unavailable` pasajero NO limpiara.
     */
    expect(identityKey({ status: 'restoring' })).toBeNull();
    expect(identityKey({ status: 'unavailable' })).toBeNull();
  });

  it('dos cuentas distintas dan claves distintas', () => {
    const uno = identityKey({
      status: 'signed-in',
      identity: { userId: 'uno', email: null, displayName: null },
    });
    const dos = identityKey({
      status: 'signed-in',
      identity: { userId: 'dos', email: null, displayName: null },
    });
    expect(uno).not.toBe(dos);
  });
});

describe('la cadena entera, del evento de auth al reset', () => {
  /*
   * Los dos extremos ya están probados por separado —`session-lifecycle` cubre
   * que un evento con usuario nulo resuelve a `signed-out`, y arriba queda que
   * `signed-out` da clave nula—. Lo que falta es el eslabón: que el evento que
   * emite `signOut` produzca una clave DISTINTA de la que había, porque es el
   * cambio de clave, y nada más, lo que dispara el reset.
   */
  it('el usuario nulo que llega al cerrar sesión cambia la clave', () => {
    const dentro = identityKey(
      stateFromUser({ id: 'abc-123', email: 'a@example.com', user_metadata: null }),
    );
    const fuera = identityKey(stateFromUser(null));

    expect(dentro).toBe('abc-123');
    expect(fuera).toBeNull();
    expect(fuera).not.toBe(dentro);
  });

  it('y entrar otra cuenta vuelve a cambiarla', () => {
    // El siguiente usuario parte del valor inicial aunque el anterior no
    // hubiera limpiado: el reset dispara también en null -> id.
    const otra = identityKey(stateFromUser({ id: 'otra-cuenta' }));
    expect(otra).not.toBeNull();
    expect(otra).not.toBe('abc-123');
  });
});

describe('el valor inicial', () => {
  it('es Personal', () => {
    // Pareja es todavía un placeholder: arrancar ahí apuntaría la ruta más
    // rápida a un ámbito que aún no existe.
    expect(INITIAL_SCOPE).toBe('personal');
  });

  it('el mismo literal sirve de arranque y de reset', () => {
    // Si fueran dos literales podrían dejar de coincidir sin que nada falle.
    expect(SCOPE_CONTEXT).toContain('useState<Scope>(INITIAL_SCOPE)');
    expect(SCOPE_CONTEXT).toContain('setScope(INITIAL_SCOPE)');
  });
});

describe('cuándo se resetea', () => {
  it('durante el render, comparando la identidad conocida con la nueva', () => {
    expect(SCOPE_CONTEXT).toMatch(/if\s*\(identityKey !== knownIdentity\)\s*\{/);
  });

  it('NO en un `useEffect`', () => {
    /*
     * Ésta es la prueba que protege el orden entero.
     *
     * Al cerrar sesión, el evento de auth hace que `Stack.Protected` tire la
     * rama protegida en ese mismo commit. Un efecto de limpieza que viviera
     * dentro de esa rama sería una promesa hecha por un componente que se está
     * desmontando. Al hacerlo en el render de un provider que está POR ENCIMA
     * del navegador, los hijos se pintan la primera vez viendo ya el valor
     * inicial, y no queda ningún orden que alguien pueda equivocar.
     */
    // La llamada y el import, no la palabra: el comentario del módulo explica
    // precisamente por qué no lo usa.
    expect(SCOPE_CONTEXT).not.toMatch(/useEffect\s*\(/);
    expect(SCOPE_CONTEXT).not.toMatch(/import\s*\{[^}]*useEffect[^}]*\}\s*from\s*'react'/);
  });

  it('y el reset no lo posee ninguna pantalla', () => {
    // Si Cuenta reseteara el ámbito, el reset moriría con ella.
    expect(ACCOUNT).not.toContain('setScope');
    expect(ACCOUNT).not.toContain('useScope');
    expect(ACCOUNT).not.toContain('INITIAL_SCOPE');
  });
});

describe('quién conecta la sesión con el ámbito', () => {
  it('el layout raíz, que es el único sitio que ve las dos', () => {
    // `features/` no puede importar `features/`: lo impide
    // `import/no-restricted-paths`. La composición ocurre aquí.
    expect(LAYOUT).toContain('identityKey={identityKey(state)}');
  });

  it('el provider de ámbito queda por encima del navegador', () => {
    const scopeAt = LAYOUT.indexOf('<ScopeProvider');
    const navigatorAt = LAYOUT.indexOf('<RootNavigator');
    expect(scopeAt).toBeGreaterThan(-1);
    expect(navigatorAt).toBeGreaterThan(-1);
    // No basta con que exista: si estuviera dentro del navegador se
    // desmontaría con la rama, que es justo lo que se quiere evitar.
    expect(LAYOUT).toMatch(/<ScopeBinding>[\s\S]*<RootNavigator\s*\/>[\s\S]*<\/ScopeBinding>/);
  });

  it('y `ScopeBinding` vive dentro de `SessionProvider`, que es donde se puede leer', () => {
    expect(LAYOUT).toMatch(/<SessionProvider>[\s\S]*<ScopeBinding>/);
  });

  it('no se resetea remontando con `key`, que tiraría también el navegador', () => {
    expect(LAYOUT).not.toMatch(/<ScopeProvider[^>]*\skey=/);
  });
});
