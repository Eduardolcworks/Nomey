import { describe, expect, it } from 'vitest';

import LAYOUT from '../../src/app/_layout.tsx?raw';
import CLIENT_RAW from '../../src/lib/supabase/recovery-client.ts?raw';
import CONTROLLER_RAW from '../../src/features/auth/recovery-controller.tsx?raw';
import LIFECYCLE_RAW from '../../src/features/session/session-lifecycle.ts?raw';
import SESSION_STATE_RAW from '../../src/features/session/session-state.ts?raw';
import SIGN_IN from '../../src/app/(auth)/sign-in.tsx?raw';
import FORGOT_RAW from '../../src/app/(auth)/forgot-password.tsx?raw';
import NEW_PASSWORD_RAW from '../../src/app/(recovery)/new-password.tsx?raw';
import HOOK_RAW from '../../src/features/auth/use-recovery-link.ts?raw';
import SERVICE_RAW from '../../src/features/auth/auth-service.ts?raw';
import PARSER_RAW from '../../src/features/auth/recovery-link.ts?raw';
import TEMPLATE from '../../supabase/templates/recovery.html?raw';
import CONFIG from '../../supabase/config.toml?raw';
import { esES } from '../../src/lib/i18n/messages/es-ES';
import { en } from '../../src/lib/i18n/messages/en';

/**
 * La recuperación como superficie: qué existe, cuándo, y qué NO viaja.
 *
 * Se lee el fuente porque no hay renderer. Lo que se fija es política, y la
 * política sí está en el fuente: dónde vive el token, qué ruta se monta bajo
 * qué guarda, y que ninguna pantalla navegue a mano.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const FORGOT = stripComments(FORGOT_RAW);
const NEW_PASSWORD = stripComments(NEW_PASSWORD_RAW);
const HOOK = stripComments(HOOK_RAW);
const SERVICE = stripComments(SERVICE_RAW);
const PARSER = stripComments(PARSER_RAW);
const CLIENT = stripComments(CLIENT_RAW);
const CONTROLLER = stripComments(CONTROLLER_RAW);
const LIFECYCLE = stripComments(LIFECYCLE_RAW);
const SESSION_STATE = stripComments(SESSION_STATE_RAW);

describe('la puerta de entrada', () => {
  it('Entrar ofrece recuperar la contraseña', () => {
    expect(SIGN_IN).toContain("t('auth.forgotAction')");
    expect(SIGN_IN).toContain('/(auth)/forgot-password');
  });

  it('y es secundario respecto a entrar y crear cuenta', () => {
    // No usa el acento: es una salida, no una tercera opción a considerar.
    const forgotBlock = SIGN_IN.slice(SIGN_IN.indexOf('forgot-password'));
    expect(forgotBlock).toContain('themeColor="textTertiary"');
  });
});

describe('el token nunca se queda en ningún sitio', () => {
  it('no entra en el estado de navegación ni en params', () => {
    /*
     * expo-router conserva los params mientras vive la ruta. Un hash aparcado
     * ahí sobreviviría a su único uso y acabaría en lo que inspeccione la
     * navegación, que un mal día es un reporte de errores.
     */
    expect(HOOK).not.toContain('useLocalSearchParams');
    expect(HOOK).not.toContain('router.');
    expect(NEW_PASSWORD).not.toContain('token_hash');
    expect(NEW_PASSWORD).not.toContain('useLocalSearchParams');
  });

  it('ni se guarda a mano en ningún almacenamiento', () => {
    // ADR-017 sigue siendo el dueño: `verifyOtp` persiste la sesión por el
    // adaptador ya configurado, y esta feature no nombra ninguna clave.
    for (const source of [HOOK, SERVICE, PARSER]) {
      expect(source).not.toContain('AsyncStorage');
      expect(source).not.toContain('SecureStore');
    }
    expect(HOOK).not.toContain('SESSION_STORAGE_KEY');
    expect(PARSER).not.toContain('SESSION_STORAGE_KEY');
  });

  it('ni se registra en un log', () => {
    for (const source of [HOOK, PARSER, NEW_PASSWORD, FORGOT]) {
      expect(source).not.toMatch(/console\./);
    }
  });

  it('y no se gasta dos veces por un re-render', () => {
    // `useURL` reemite el mismo valor; el hash es de un solo uso, así que un
    // segundo canje convertiría un recovery bueno en un enlace muerto.
    expect(HOOK).toContain('spent');
    expect(HOOK).toContain('useRef');
  });
});

describe('el enlace lo canjea verifyOtp, no setSession', () => {
  it('el servicio usa `verifyOtp` con tipo recovery', () => {
    expect(SERVICE).toContain("type: 'recovery'");
    expect(SERVICE).toContain('verifyOtp');
  });

  it('y NUNCA `setSession`, que es la forma del rebote por navegador', () => {
    expect(SERVICE).not.toContain('setSession');
    expect(HOOK).not.toContain('setSession');
  });

  it('la app no lee sesiones de una URL', () => {
    expect(SERVICE).not.toContain('getSessionFromUrl');
    expect(PARSER).not.toContain('access_token');
    expect(PARSER).not.toContain('refresh_token');
  });
});

describe('el correo', () => {
  it('la plantilla lleva el hash y NINGÚN token', () => {
    expect(TEMPLATE).toContain('{{ .TokenHash }}');
    expect(TEMPLATE).not.toContain('access_token');
    expect(TEMPLATE).not.toContain('refresh_token');
    expect(TEMPLATE).not.toContain('ConfirmationURL');
  });

  it('enlaza a la app y declara el tipo', () => {
    expect(TEMPLATE).toMatch(/href="nomey(-dev)?:\/\/auth\/recovery\?/);
    expect(TEMPLATE).toContain('type=recovery');
  });

  it('y la config la referencia', () => {
    expect(CONFIG).toContain('[auth.email.template.recovery]');
    expect(CONFIG).toContain('./supabase/templates/recovery.html');
  });
});

describe('las guardas de ruta', () => {
  it('recovery es su propia rama, con su propio predicado', () => {
    expect(LAYOUT).toContain('isRecoveryActive(recovery)');
    expect(LAYOUT).toContain('<Stack.Screen name="(recovery)" />');
  });

  it('y NO está ni en la pública ni en la de producto', () => {
    const blocks = [
      ...LAYOUT.matchAll(/<Stack\.Protected\s+guard=\{([^}]*)\}>([\s\S]*?)<\/Stack\.Protected>/g),
    ].map((m) => ({ guard: m[1], screens: m[2] }));

    const publicBlock = blocks.find((b) => b.guard.includes('isPublic'));
    const productBlock = blocks.find(
      (b) => b.guard.includes('isSignedIn') && !b.guard.includes('__DEV__'),
    );

    expect(publicBlock?.screens).not.toContain('(recovery)');
    expect(productBlock?.screens).not.toContain('(recovery)');
  });

  it('el deep link se escucha por encima de las ramas', () => {
    // Un enlace puede llegar en frío, en la pantalla de entrar o con la app
    // abierta. Un listener dentro de una rama se perdería los que su rama no
    // estuviera montada para recibir.
    expect(LAYOUT).toContain('useRecoveryLink()');
  });
});

describe('nadie navega a mano', () => {
  it('ninguna pantalla del flujo hace router.replace', () => {
    for (const source of [FORGOT, NEW_PASSWORD]) {
      expect(source).not.toContain('router.replace');
      expect(source).not.toContain('router.push');
    }
  });

  it('la contraseña nueva no se autoconcede la pantalla', () => {
    // No decide ella si se monta: lo decide el controlador, y el controlador
    // sólo se activa porque `verifyOtp` tuvo éxito contra el servidor.
    expect(NEW_PASSWORD).not.toContain('isRecoveryActive');
    expect(NEW_PASSWORD).not.toContain('redeem(');
  });
});

describe('el cliente de recovery está aislado del principal', () => {
  it('son dos instancias distintas', () => {
    expect(CLIENT).toContain('createClient(');
    expect(CLIENT).not.toContain("from './client'");
    expect(SERVICE).toContain('recoveryClient()');
  });

  it('NO persiste la sesión', () => {
    /*
     * El defecto material que corrige. Con `persistSession: true` la sesión de
     * recovery quedaba en el llavero; matar la app y reabrir la restauraba como
     * INITIAL_SESSION y la app aterrizaba en `signed-in`, con la contraseña sin
     * cambiar. Medido antes de corregirlo.
     */
    expect(CLIENT).toContain('persistSession: false');
  });

  it('ni refresca, ni lee sesiones de una URL', () => {
    expect(CLIENT).toContain('autoRefreshToken: false');
    expect(CLIENT).toContain('detectSessionInUrl: false');
  });

  it('no usa NUESTRO almacenamiento, ni ningún otro', () => {
    // Con `persistSession: false` auth-js ignora `settings.storage` y usa un
    // adaptador en memoria: no hay configuración que llegue al llavero.
    expect(CLIENT).not.toContain('sessionStorage');
    expect(CLIENT).not.toContain('SecureStore');
    expect(CLIENT).not.toContain('AsyncStorage');
    expect(CLIENT).not.toMatch(/storage:/);
  });

  it('tiene su propio namespace, distinto del de la sesión ordinaria', () => {
    expect(CLIENT).toContain('RECOVERY_STORAGE_KEY');
    expect(CLIENT).not.toContain('SESSION_STORAGE_KEY');
  });

  it('y sus eventos no pueden llegar al SessionProvider', () => {
    // El provider principal se suscribe al cliente principal y a ninguno más.
    expect(CONTROLLER).not.toContain('onAuthStateChange');
    expect(CLIENT).not.toContain('onAuthStateChange');
  });
});

describe('el SessionProvider volvió a representar sólo la sesión ordinaria', () => {
  it('no tiene estado de recovery', () => {
    expect(SESSION_STATE).not.toContain('recovering');
    expect(SESSION_STATE).not.toContain('isRecovering');
  });

  it('ni el lifecycle mira el nombre del evento', () => {
    // El puerto volvió a entregar sólo el usuario, como en F5.B. El evento
    // `PASSWORD_RECOVERY` pertenece al flujo de recovery, no a este ciclo.
    expect(LIFECYCLE).not.toContain('PASSWORD_RECOVERY');
    expect(LIFECYCLE).toContain('onAuthStateChange((user)');
  });

  it('durante un recovery la rama pública queda cedida, no falseada', () => {
    // `isPublic(state)` sigue siendo cierto por debajo; lo único que ocurre es
    // que la superficie de recovery tiene prioridad mientras dura.
    expect(LAYOUT).toContain('isPublic(state) && !recovering');
    expect(LAYOUT).toContain('isSignedIn(state) && !recovering');
  });
});

describe('un recovery interrumpido no se reanuda', () => {
  it('no hay estado de recovery restaurable', () => {
    /*
     * El fail-closed es intencionado: si la persona cerró la app a medias, pide
     * otro enlace. No hay "continuar recuperación", porque no hay nada
     * guardado que continuar.
     */
    expect(CONTROLLER).not.toContain('restoring');
    expect(CONTROLLER).not.toContain('getItem');
    expect(CONTROLLER).not.toContain('setItem');
  });

  it('y el controlador no escribe en ningún sitio', () => {
    expect(CONTROLLER).not.toContain('AsyncStorage');
    expect(CONTROLLER).not.toContain('SecureStore');
    expect(CONTROLLER).not.toContain('sessionStorage');
  });
});

describe('no enumerar cuentas', () => {
  it('la respuesta es la misma haya cuenta o no', () => {
    // Medido: GoTrue responde 200 en ambos casos, así que el mensaje neutral
    // es literalmente cierto y no una ficción del cliente.
    expect(FORGOT).toContain("t('auth.recoverSentBody')");
    for (const catalogue of [esES, en]) {
      expect(catalogue['auth.recoverSentBody']).toMatch(/si existe|if an account exists/i);
    }
  });

  it('y no hay copy que confirme ni niegue una cuenta', () => {
    for (const catalogue of [esES, en]) {
      for (const value of Object.values(catalogue)) {
        expect(value.toLowerCase()).not.toContain('no existe ninguna cuenta');
        expect(value.toLowerCase()).not.toContain('no account with');
        expect(value.toLowerCase()).not.toContain('email no registrado');
      }
    }
  });
});

describe('el final del flujo', () => {
  it('cambiar la contraseña cierra la sesión del enlace', () => {
    /*
     * Medido: tras `PUT /user` la sesión de recovery sigue viva, access y
     * refresh incluidos. Sin este cierre, terminar una recuperación dejaría
     * una sesión ordinaria y duradera nacida de un buzón de correo.
     */
    const complete = SERVICE.slice(SERVICE.indexOf('export async function completeRecovery'));
    expect(complete).toContain('updateUser({ password: rawPassword })');
    expect(complete).toContain("signOut({ scope: 'local' })");
  });

  it('y el cierre va DESPUÉS del cambio, no antes', () => {
    const complete = SERVICE.slice(SERVICE.indexOf('export async function completeRecovery'));
    expect(complete.indexOf('updateUser')).toBeLessThan(complete.indexOf('signOut'));
  });
});
