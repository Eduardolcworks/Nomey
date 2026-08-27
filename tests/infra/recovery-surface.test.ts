import { describe, expect, it } from 'vitest';

import LAYOUT from '../../src/app/_layout.tsx?raw';
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
    expect(SERVICE).toContain("verifyOtp({ token_hash: tokenHash, type: 'recovery' })");
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
    expect(LAYOUT).toContain('isRecovering(state)');
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
    // No hay bandera local que la monte: existe porque el estado de sesión es
    // `recovering`, y eso lo produjo el servidor.
    expect(NEW_PASSWORD).not.toContain('isRecovering');
    expect(NEW_PASSWORD).not.toContain('setRecovering');
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
