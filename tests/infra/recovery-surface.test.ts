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
import ARRIVAL_RAW from '../../src/features/auth/recovery-arrival.ts?raw';
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
/** Sólo `setPassword`: `dismiss` también descarta el cliente, y no es esto. */
const SET_PASSWORD = CONTROLLER.slice(
  CONTROLLER.indexOf('const setPassword'),
  CONTROLLER.indexOf('const dismiss'),
);

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

  it('y no se gasta dos veces', () => {
    // El hash es de un solo uso: un segundo canje convertiría un recovery
    // bueno en un enlace muerto. La guarda vive con la decisión, en el módulo
    // de llegada, y su comportamiento lo ejercita `recovery-arrival.test.ts`.
    expect(stripComments(ARRIVAL_RAW)).toContain('spent.has(proof.tokenHash)');
    expect(HOOK).not.toContain('spent');
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
    expect(LAYOUT).toContain('useRecoveryLink({ sessionStatus: state.status })');
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

describe('el deep link se procesa por llegada, no por valor retenido', () => {
  it('ya NO usa `Linking.useURL()`', () => {
    /*
     * `useURL` retiene la última URL en estado. Leerla desde un efecto que
     * dependía de `signedIn` hacía que cerrar sesión canjeara un enlace que
     * nadie había reabierto - medido. La suscripción cruda no retiene nada.
     */
    expect(HOOK).not.toContain('useURL');
    expect(HOOK).toContain('getInitialURL()');
    expect(HOOK).toContain("addEventListener('url'");
  });

  it('la suscripción se instala UNA vez y no depende de la sesión', () => {
    // Dependencias vacías: ningún cambio de sesión, de estado ni de idioma
    // puede reejecutar el procesamiento.
    expect(HOOK).toMatch(/\}, \[\]\);/);
    expect(HOOK).not.toMatch(/\}, \[[^\]]*signedIn[^\]]*\]\);/);
  });

  it('y el listener se limpia al desmontar', () => {
    expect(HOOK).toContain('subscription.remove()');
    expect(HOOK).toContain('active = false');
  });

  it('nada desbloquea un enlace por cambiar la sesión', () => {
    // La línea que causaba el auto-canje. No debe volver.
    const arrival = stripComments(ARRIVAL_RAW);
    expect(arrival).not.toMatch(/warned[^\n]*=\s*null/);
    expect(arrival).not.toContain('warned.clear()');
  });

  it('con sesión abierta no se canjea ni se gasta el token', () => {
    const arrival = stripComments(ARRIVAL_RAW);
    const settle = arrival.slice(arrival.indexOf('function settle'));
    // La rama de rechazo es todo lo que hay hasta su propio `return;`.
    const refusal = settle.slice(0, settle.indexOf('return;'));
    expect(refusal).toContain('ports.refuse');
    expect(refusal).not.toContain('ports.redeem');
    expect(refusal).not.toContain('spent.add');
  });

  it('y la prueba se gasta DESPUÉS de saber el resultado, nunca antes', () => {
    /*
     * El defecto medido: `spent.add` iba delante de `ports.redeem`, así que un
     * `verifyOtp` que nunca llegó al servidor quemaba el enlace en local.
     * Comprobado contra `auth.one_time_tokens`: el token seguía vivo mientras
     * la app lo daba por muerto.
     */
    const arrival = stripComments(ARRIVAL_RAW);
    const settle = arrival.slice(arrival.indexOf('function settle'));
    expect(settle.indexOf('ports.redeem')).toBeLessThan(settle.indexOf('spent.add'));
    expect(settle).toContain("if (outcome !== 'unresolved') spent.add(tokenHash)");
  });

  it('para lo cual el canje devuelve su resultado a quien decide', () => {
    // Descartar la promesa es exactamente lo que impedía distinguir «gastado»
    // de «no se pudo preguntar».
    expect(HOOK).toContain('redeem: (tokenHash) => live.current.redeem(tokenHash)');
    expect(HOOK).not.toContain('void live.current.redeem');
  });

  it('y sólo un veredicto del servidor puede llamar inválido a un enlace', () => {
    expect(NEW_PASSWORD).toContain('t(state.titleKey)');
    expect(NEW_PASSWORD).not.toContain("t('auth.recoveryFailedTitle')");
  });

  it('durante  no se decide nada: la llegada queda pendiente', () => {
    const arrival = stripComments(ARRIVAL_RAW);
    expect(arrival).toContain("if (status === 'restoring')");
    expect(arrival).toContain('if (pending === null) pending = proof.tokenHash');
  });

  it('y el pendiente se borra ANTES de decidir, para que sea de un solo uso', () => {
    const arrival = stripComments(ARRIVAL_RAW);
    // Desde la IMPLEMENTACIÓN, no desde su declaración en el tipo.
    const resolved = arrival.slice(arrival.indexOf('sessionResolved() {'));
    expect(resolved.indexOf('pending = null')).toBeLessThan(resolved.indexOf('settle(tokenHash'));
  });

  it(' falla cerrado y nunca se promociona a signed-out', () => {
    const arrival = stripComments(ARRIVAL_RAW);
    expect(arrival).toContain("status === 'signed-in' || status === 'unavailable'");
  });

  it('el aviso no dice de qué cuenta es el enlace', () => {
    for (const catalogue of [esES, en]) {
      const copy = `${catalogue['auth.recoveryBlockedTitle']} ${catalogue['auth.recoveryBlockedBody']}`;
      expect(copy).not.toMatch(/\{email\}|\{name\}|\{account\}/);
      expect(copy).not.toContain('@');
    }
  });

  it('y es un aviso, no una superficie que tape la app', () => {
    expect(HOOK).toContain('Alert.alert');
  });
});

describe('el punto de compromiso de la contraseña', () => {
  const complete = SERVICE.slice(SERVICE.indexOf('export async function completeRecovery'));
  const afterCommit = complete.slice(complete.indexOf('signOut'));

  it('antes de confirmar, un fallo SÍ es un fallo del recovery', () => {
    const beforeCommit = complete.slice(0, complete.indexOf('signOut'));
    expect(beforeCommit).toContain('updateUser');
    expect(beforeCommit).toContain('ok: false');
  });

  it('y un throw inesperado antes de confirmar tampoco escapa', () => {
    const beforeCommit = complete.slice(0, complete.indexOf('signOut'));
    expect(beforeCommit).toContain('try {');
    expect(beforeCommit).toContain('} catch {');
  });

  it('después de confirmar, NADA puede devolver fallo', () => {
    /*
     * La contraseña ya cambió: la vieja responde 400 y la nueva 200. Decir que
     * no cambió mandaría a la persona a probar la antigua y a quemar otro
     * enlace.
     */
    expect(afterCommit).not.toContain('ok: false');
    expect(afterCommit).toContain('return { ok: true }');
  });

  it('ni un error devuelto ni una excepción del signOut', () => {
    expect(afterCommit).toContain('reportRevocationUnconfirmed');
    expect(afterCommit).toContain('} catch (thrown) {');
  });

  it('y nunca se reintenta `updateUser` después del compromiso', () => {
    expect(afterCommit).not.toContain('updateUser');
  });

  it('el fallo de revocación se registra sin nada sensible', () => {
    const report = SERVICE.slice(SERVICE.indexOf('function reportRevocationUnconfirmed'));
    expect(report).toContain('error.name');
    for (const forbidden of ['access_token', 'refresh_token', 'token_hash', 'email', 'password']) {
      expect(report).not.toContain(forbidden);
    }
    // El objeto entero jamás: AGENTS.md §8.
    expect(report).not.toMatch(/console\.warn\([^)]*,\s*error\s*[,)]/);
  });
});

describe('el controlador no deja el envío colgado', () => {
  it('`setPassword` no propaga excepciones', () => {
    const setPassword = CONTROLLER.slice(CONTROLLER.indexOf('const setPassword'));
    expect(setPassword).toContain('try {');
    expect(setPassword).toContain('} catch {');
  });

  it('y descarta el cliente efímero al completar', () => {
    const setPassword = CONTROLLER.slice(CONTROLLER.indexOf('const setPassword'));
    expect(setPassword).toContain('disposeRecoveryClient()');
  });

  it('la pantalla libera `busy` pase lo que pase', () => {
    expect(NEW_PASSWORD).toContain('finally');
    expect(NEW_PASSWORD).toContain('setBusy(false)');
  });
});

describe('recovery es una superficie exclusiva', () => {
  it('las rutas DEV tampoco se montan durante un recovery', () => {
    expect(LAYOUT).toContain('isSignedIn(state) && !recovering && __DEV__');
  });

  it('así que ninguna guarda ordinaria coexiste con la de recovery', () => {
    const guards = [...LAYOUT.matchAll(/<Stack\.Protected\s+guard=\{([^}]*)\}>/g)].map((m) => m[1]);
    const others = guards.filter((g) => g.trim() !== 'recovering');
    expect(others.length).toBeGreaterThan(0);
    for (const guard of others) {
      expect(guard).toContain('!recovering');
    }
  });
});

describe('cada error dice de qué está hablando', () => {
  it('el canje del enlace usa los títulos del enlace', () => {
    const redeem = CONTROLLER.slice(
      CONTROLLER.indexOf('const redeem'),
      CONTROLLER.indexOf('const setPassword'),
    );
    expect(redeem).toContain('titleKey: result.titleKey');
  });

  it('y guardar la contraseña no produce estado alguno cuando se puede reintentar', () => {
    /*
     * Cuando esto falla, `verifyOtp` ya tuvo éxito y la sesión efímera sigue
     * ahí. Pasar a `error` mandaba a una pantalla terminal cuya única salida
     * descartaba esa sesión: una contraseña rechazada costaba el recovery
     * entero y un enlace nuevo que nadie necesitaba.
     */
    const retryable = SET_PASSWORD.slice(
      SET_PASSWORD.indexOf('if (!result.ok) {'),
      SET_PASSWORD.lastIndexOf('disposeRecoveryClient'),
    );

    expect(retryable).not.toContain('setState');
    expect(retryable).not.toContain('titleKey');
    expect(retryable).not.toContain('authError.recoveryLinkDead');
    expect(retryable).toContain('return result.messageKey');
  });

  it('salvo que el servidor establezca que la sesión efímera ya no sirve', () => {
    /*
     * El único fallo de guardado que termina la transacción, y por eso va
     * ANTES del reintentable: la prueba ya se gastó, así que reintentar no
     * puede devolver la sesión. Se descarta el cliente y no se afirma nada
     * nuevo sobre el enlace.
     */
    const lost = SET_PASSWORD.slice(
      SET_PASSWORD.indexOf("result.outcome === 'session-lost'"),
      SET_PASSWORD.indexOf('if (!result.ok) {'),
    );

    expect(lost).toContain('disposeRecoveryClient()');
    expect(lost).toContain("status: 'error'");
    expect(lost).toContain('titleKey: result.titleKey');
    expect(lost).not.toContain('authError.recoveryLinkDead');
  });

  it('y el éxito conserva su cierre: descartar y `completed`', () => {
    const success = SET_PASSWORD.slice(SET_PASSWORD.lastIndexOf('disposeRecoveryClient'));

    expect(success).toContain('disposeRecoveryClient()');
    expect(success).toContain("setState({ status: 'completed' })");
  });

  it('el formulario enseña ese fallo en su propia ranura, sin marcharse', () => {
    // La misma ranura que las comprobaciones locales, y sin `return` propio:
    // el formulario sigue montado, con lo que la persona escribió.
    expect(NEW_PASSWORD).toContain('t(saveError)');
    expect(NEW_PASSWORD).not.toMatch(/saveError[^\n]*\?[^\n]*return/);
  });

  it('y tiene una salida explícita, porque ahora es la única', () => {
    const form = NEW_PASSWORD.slice(NEW_PASSWORD.indexOf('auth.newPasswordAction'));
    expect(form).toContain("t('auth.checkEmailBack')");
    expect(form).toContain('onPress={dismiss}');
  });

  it('el guardado sigue siendo exclusivo: un envío a la vez', () => {
    expect(NEW_PASSWORD).toContain('createExclusiveRunner()');
    expect(NEW_PASSWORD).toContain('SKIPPED');
  });

  it('la pantalla no inventa texto: título y cuerpo salen del estado', () => {
    expect(NEW_PASSWORD).toContain('t(state.titleKey)');
    expect(NEW_PASSWORD).toContain('t(state.messageKey)');
  });

  it('y todas las frases existen en los dos idiomas', () => {
    for (const catalogue of [esES, en]) {
      for (const key of [
        'auth.recoveryFailedTitle',
        'auth.recoveryUnresolvedTitle',
        'auth.recoveryExpiredTitle',
        'authError.recoveryLinkDead',
        'authError.recoveryLinkUnchecked',
        'authError.passwordChangeFailed',
        'authError.recoverySessionLost',
      ] as const) {
        expect(catalogue[key]).toBeTruthy();
      }
    }
  });

  it('ninguna de ellas expone vocabulario de GoTrue', () => {
    for (const catalogue of [esES, en]) {
      for (const key of [
        'authError.recoveryLinkUnchecked',
        'authError.passwordChangeFailed',
        'authError.recoverySessionLost',
      ] as const) {
        const copy = catalogue[key].toLowerCase();
        for (const leak of ['otp', 'token', '403', '429', '500', 'gotrue', 'supabase']) {
          expect(copy).not.toContain(leak);
        }
      }
    }
  });
});
