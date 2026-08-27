import { describe, expect, it } from 'vitest';

import ACCOUNT_RAW from '../../src/app/account.tsx?raw';
import PROFILE from '../../src/app/profile.tsx?raw';
import AUTH_SERVICE from '../../src/features/auth/auth-service.ts?raw';
import { esES } from '../../src/lib/i18n/messages/es-ES';
import { en } from '../../src/lib/i18n/messages/en';

/**
 * De dónde saca Cuenta lo que enseña, y qué NO enseña.
 *
 * Se lee el fuente porque no hay renderer, igual que en las guardas de ruta y
 * en el saludo de Inicio. Lo que se fija aquí es política, y la política sí
 * está en el fuente: qué fuente de datos usa la pantalla, qué campos toca, y
 * que no haya una segunda vía de navegación compitiendo con el evento de auth.
 *
 * Se comprueba sobre el CÓDIGO, con los comentarios fuera. Los comentarios de
 * esta pantalla explican precisamente lo que no hace —«nada de
 * `router.replace`», «ni la metadata entera»— y una aserción por subcadena
 * sobre el fichero crudo se dispararía con la explicación en vez de con el
 * incumplimiento. Un test que falla por su propia documentación enseña a
 * borrar la documentación.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const ACCOUNT = stripComments(ACCOUNT_RAW);

describe('la fila Cuenta de Perfil', () => {
  it('ya no dice «Próximamente»: lleva a algún sitio', () => {
    expect(PROFILE).toContain("router.push('/account')");
  });

  it('y es la única fila de Perfil que lleva a producto', () => {
    // Las de General siguen inertes; su presentación la cubre
    // `profile-surface.test.ts`. Aquí sólo importa que el camino al cierre de
    // sesión sigue existiendo y sigue siendo uno.
    const pushes = [...PROFILE.matchAll(/router\.push\('\/([a-z-]+)'\)/g)].map((m) => m[1]);
    expect(pushes).toContain('account');
    // Diagnóstico, estados y sonda quedan detrás de `__DEV__`.
    expect(PROFILE).toContain('__DEV__');
  });
});

describe('los datos de la cuenta', () => {
  it('salen de la sesión que ya está en memoria', () => {
    expect(ACCOUNT).toContain('useSession');
    expect(ACCOUNT).toContain('session.identity');
  });

  it('y NO de una consulta nueva al backend', () => {
    /*
     * La regresión concreta: pedirle al servidor dos cadenas que ya nos dio.
     * Sería una segunda fuente que puede discrepar de la primera, y una
     * petición que puede fallar en la pantalla cuyo trabajo es funcionar
     * justo cuando las cosas van mal.
     */
    expect(ACCOUNT).not.toContain('supabase');
    expect(ACCOUNT).not.toMatch(/\.from\(/);
    expect(ACCOUNT).not.toMatch(/\.rpc\(/);
    expect(ACCOUNT).not.toContain('getUser');
    expect(ACCOUNT).not.toContain('getSession');
  });

  it('lee exactamente nombre y email, y nada más', () => {
    expect(ACCOUNT).toContain('displayName');
    expect(ACCOUNT).toContain('email');
    // Ni el token ni la metadata entera. El provider expone tres campos y
    // esta pantalla usa dos; `userId` no se pinta.
    expect(ACCOUNT).not.toContain('access_token');
    expect(ACCOUNT).not.toContain('refresh_token');
    expect(ACCOUNT).not.toContain('user_metadata');
  });

  it('sin nombre enseña un fallback neutro', () => {
    expect(ACCOUNT).toContain("t('account.noName')");
    expect(esES['account.noName']).toBeTruthy();
    expect(en['account.noName']).toBeTruthy();
  });

  it('y NUNCA lo deduce del email', () => {
    /*
     * La parte local de una dirección no es un nombre. Presentarla como tal
     * es una mentira pequeña que el usuario no puede corregir desde aquí.
     */
    expect(ACCOUNT).not.toMatch(/email\s*\.\s*split/);
    expect(ACCOUNT).not.toMatch(/split\(\s*'@'\s*\)/);
    expect(ACCOUNT).not.toMatch(/displayName\s*\?\?\s*email/);
    // Y el fallback tampoco es un placeholder que finja conocer a nadie.
    expect(esES['account.noName'].toLowerCase()).not.toContain('tu nombre');
    expect(en['account.noName'].toLowerCase()).not.toContain('your name');
  });
});

describe('cerrar sesión desde Cuenta', () => {
  it('pide confirmación antes de hacer nada', () => {
    expect(ACCOUNT).toContain('buildSignOutConfirmation');
    expect(ACCOUNT).toContain('Alert.alert');
  });

  it('el diálogo se puede descartar, y descartarlo es cancelar', () => {
    expect(ACCOUNT).toContain('cancelable: true');
  });

  it('la llamada real va detrás del guardián de envío', () => {
    // `useAuthSubmit` envuelve el runner exclusivo: un segundo toque no
    // dispara una segunda operación.
    expect(ACCOUNT).toContain('useAuthSubmit');
    expect(ACCOUNT).toMatch(/run\(signOut\)/);
  });

  it('y el control queda deshabilitado Y ocupado mientras corre', () => {
    // Deshabilitado a secas se lee como «roto» en un lector de pantalla.
    expect(ACCOUNT).toContain('disabled={running}');
    expect(ACCOUNT).toContain('busy={running}');
  });

  it('el estado ocupado también se dice con texto, no sólo con el botón apagado', () => {
    expect(ACCOUNT).toContain("t('account.signOutBusy')");
  });

  it('NO navega de forma imperativa: el evento de auth mueve el árbol', () => {
    /*
     * Igual que al entrar. Una navegación imperativa sería un segundo
     * mecanismo compitiendo con el primero, y además dejaría historial: el
     * usuario podría volver atrás a Perfil. Al cambiar de rama, la protegida
     * deja de existir en vez de quedar tapada.
     */
    expect(ACCOUNT).not.toContain('router.replace');
    expect(ACCOUNT).not.toContain('router.push');
    expect(ACCOUNT).not.toContain("'/(auth)/sign-in'");
  });
});

describe('el fallo al cerrar sesión', () => {
  it('se cuenta con texto y como alerta accesible, no sólo en rojo', () => {
    expect(ACCOUNT).toContain('accessibilityRole="alert"');
    expect(ACCOUNT).toContain('accessibilityLiveRegion="polite"');
  });

  it('ofrece la salida local como elección explícita, no automática', () => {
    expect(ACCOUNT).toContain('forgetLocalSession');
    expect(ACCOUNT).toContain("t('account.forgetLocal')");
  });

  it('y dice lo que cuesta: la sesión sigue viva en el servidor', () => {
    for (const catalogue of [esES, en]) {
      expect(catalogue['account.forgetLocalHint']).toBeTruthy();
    }
    expect(esES['account.forgetLocalHint'].toLowerCase()).toContain('servidor');
    expect(en['account.forgetLocalHint'].toLowerCase()).toContain('server');
  });
});

describe('el contrato con auth-js', () => {
  it('cierra sesión con alcance local, no con el global por defecto', () => {
    /*
     * El defecto de `signOut()` es `'global'`, que cierra la sesión en TODOS
     * los dispositivos. Un toque en este teléfono no debe echar al usuario de
     * su tablet. `'local'` sigue revocando el refresh token de este
     * dispositivo en el servidor.
     */
    const calls = [...AUTH_SERVICE.matchAll(/auth\.signOut\(([^)]*)\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call[1]).toContain("scope: 'local'");
    }
  });

  it('la purga explícita usa la capa que posee el troceado, nunca un nombre de chunk', () => {
    expect(AUTH_SERVICE).toContain('sessionStorage.removeItem(SESSION_STORAGE_KEY)');
    // Nada que componga `clave.0`, `clave.1`… fuera de `chunked-storage`.
    expect(AUTH_SERVICE).not.toMatch(/\$\{[^}]*\}\.\$\{/);
    expect(AUTH_SERVICE).not.toContain('chunkKey');
  });

  it('y ninguna pantalla nombra el almacenamiento de sesión', () => {
    expect(ACCOUNT).not.toContain('SESSION_STORAGE_KEY');
    expect(ACCOUNT).not.toContain('sessionStorage');
    expect(ACCOUNT).not.toContain('SecureStore');
  });
});
