import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import LAYOUT from '../../src/app/_layout.tsx?raw';
import TABS from '../../src/app/(tabs)/_layout.tsx?raw';
import SIGN_IN from '../../src/app/(auth)/sign-in.tsx?raw';
import SIGN_UP from '../../src/app/(auth)/sign-up.tsx?raw';
import FORGOT from '../../src/app/(auth)/forgot-password.tsx?raw';
import HOME from '../../src/app/(tabs)/index.tsx?raw';
import GROUPS from '../../src/app/(tabs)/groups.tsx?raw';
import PROFILE from '../../src/app/profile.tsx?raw';
import AUTH_SERVICE from '../../src/features/auth/auth-service.ts?raw';
import AUTH_ERRORS from '../../src/features/auth/auth-errors.ts?raw';
import GUEST_SIGN_UP from '../../src/features/auth/guest-sign-up.tsx?raw';
import FORM from '../../src/features/auth/sign-in-form.tsx?raw';
import DOCK from '../../src/features/shell/nomey-tab-bar.tsx?raw';
import ACTION_BUTTON from '../../src/ui/components/action-button.tsx?raw';
import SHELL_INDEX from '../../src/features/shell/index.ts?raw';
import SESSION_STATE from '../../src/features/session/session-state.ts?raw';
import SESSION_LIFECYCLE from '../../src/features/session/session-lifecycle.ts?raw';
import SESSION_PROVIDER from '../../src/features/session/session-provider.tsx?raw';
import PERSONAL_SCOPE from '../../src/features/personal/use-personal-scope.ts?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import EN from '../../src/lib/i18n/messages/en.ts?raw';
import CONFIG from '../../supabase/config.toml?raw';
import BOUNDARY from '../../scripts/http-boundary-check.sh?raw';
import PACKAGE from '../../package.json?raw';
import ADR from '../../docs/adr/F05/ADR-003-guest-session.md?raw';

/**
 * MODO INVITADO REAL — F05/ADR-003 — con UNA sola via de cuenta.
 *
 * Sin renderer de React, lo estructural se fija aqui; lo que solo la ruta real
 * demuestra —una sesion anonima de GoTrue, un grupo con su JWT, la conversion
 * con el MISMO auth.users.id antes, durante y despues— lo mide la seccion 14
 * de scripts/http-boundary-check.sh contra el stack real, y CI la ejecuta.
 */

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '');

function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = source.indexOf(to, start);
  expect(end, to).toBeGreaterThan(start);
  return source.slice(start, end);
}

const homeGate = () => slice(HOME, '{guest ? (', ') : !personal ? (');
const profileGuest = () =>
  slice(
    PROFILE,
    'if (isGuest(state)) {',
    '  return (\n    <PlaceholderScreen title="nav.profile">\n      <View style={styles.identity}>',
  );

describe('11 · signed-out: Entrar sigue igual, con «Entrar como invitado» y el nombre', () => {
  it('la pantalla real muestra email, contraseña, Entrar, Crear cuenta, recuperar y el enlace gris de invitado', () => {
    expect(SIGN_IN).toContain('<SignInForm');
    expect(SIGN_IN).toContain("onCreateAccount={() => router.push('/(auth)/sign-up')}");
    expect(SIGN_IN).toContain("onForgotPassword={() => router.push('/(auth)/forgot-password')}");
    expect(SIGN_IN).toMatch(/onGuest=\{\(\) => \{\s*clearError\(\);\s*setNaming\(true\);/);
    expect(SIGN_IN).toContain("{t('auth.guestNameTitle')}");
    expect(SIGN_IN).toContain('await submit(() => signInAnonymously(guestName));');
    const guest = slice(FORM, 'onGuest === undefined ? null', "t('auth.guestAction')");
    expect(guest).toContain('themeColor="textTertiary"');
    expect(ES).toContain("'auth.guestAction': 'Entrar como invitado',");
    expect(EN).toContain("'auth.guestAction': 'Continue as guest',");
    // Las pantallas publicas de alta y recuperacion no saben nada del invitado.
    expect(SIGN_UP).not.toMatch(/isGuest|convertGuest/);
    expect(FORGOT).not.toMatch(/isGuest|guest/);
  });

  it('el alta anonima es real, por la capa de Auth, y lleva el nombre en user_metadata', () => {
    expect(AUTH_SERVICE).toContain(
      'export async function signInAnonymously(rawDisplayName: string): Promise<AuthResult> {',
    );
    expect(AUTH_SERVICE).toMatch(
      /await supabase\.auth\.signInAnonymously\(\{\s*options: \{ data: \{ display_name: displayName \} \},\s*\}\);/,
    );
    expect(SIGN_IN).not.toContain('supabase.auth');
    expect(HOME).not.toContain('supabase.auth');
    expect(PROFILE).not.toContain('supabase.auth');
    expect(AUTH_ERRORS).toContain(
      "if (code === 'anonymous_provider_disabled') return 'authError.guestUnavailable';",
    );
    // Y aterriza en Grupos por la ruta inicial de las pestañas: sin pantalla intermedia.
    expect(TABS).toContain("initialRouteName={isGuest(state) ? 'groups' : 'index'}");
    expect(strip(SIGN_IN)).not.toMatch(/router\.replace|router\.push\('\/\(tabs\)/);
  });
});

describe('la sesion de invitado es un estado real, reconocido por lo que dice Supabase', () => {
  it('se reconoce por `is_anonymous`, con el mismo auth.users.id; invitado ES signed-in', () => {
    expect(SESSION_STATE).toContain('readonly isAnonymous: boolean;');
    expect(SESSION_STATE).toContain('isAnonymous: user.is_anonymous === true,');
    expect(SESSION_STATE).toContain(
      "export function isGuest(state: SessionState): boolean {\n  return state.status === 'signed-in' && state.identity.isAnonymous;\n}",
    );
    // Desde F12.A3 la rama con sesion se abre en dos: las pestañas o el gate de
    // username (solo cuentas normales sin username definitivo, dicho por el
    // servidor); el invitado sigue siendo signed-in y nunca ve el gate
    // (isAnonymous → el ciclo no pregunta), con o sin red.
    expect(LAYOUT).toContain('<Stack.Protected guard={isSignedIn(state) && !recovering && !gate}>');
    expect(LAYOUT).toContain(
      "isAnonymous={state.status === 'signed-in' && state.identity.isAnonymous}",
    );
    expect(LAYOUT).not.toMatch(/name="register"|name="recover"/);
    /*
     * Y el invitado NO tiene una rama propia. Desde F12.E.B hay exactamente
     * UN `isGuest` en el layout —la puerta de Amigos—, y es una exclusión
     * puntual, no un modo: una amistad exige una cuenta normal con username
     * definitivo en las DOS partes, y `sec.assert_friend_actor` rehúsa una
     * sesión anónima con `NOT_AUTHORIZED`. Enseñar esa pantalla a un invitado
     * sería ofrecerle algo que el servidor le va a negar entero. Todo lo
     * demás del producto —tabs, ventanas, Perfil, Cuenta— lo alcanza igual.
     */
    expect(strip(LAYOUT).match(/isGuest\(state\)/g) ?? []).toHaveLength(1);
    expect(LAYOUT).toContain(
      'guard={isSignedIn(state) && !recovering && !gate && !isGuest(state)}',
    );
    expect(SESSION_STATE).not.toMatch(/guestMode|GUEST_BIT|simulad/i);
  });

  it('se persiste y refresca como cualquier otra; una conversion pendiente se descubre preguntando al SERVIDOR', () => {
    expect(SESSION_PROVIDER).toContain('callback(session?.user ?? null);');
    expect(SESSION_PROVIDER).not.toMatch(/is_anonymous|isAnonymous|guest/i);
    // La copia guardada no es autoridad: getUser (autoritativo) y, solo si ya hay cuenta, refreshSession.
    expect(SESSION_PROVIDER).toContain('const { data, error } = await supabase.auth.getUser();');
    expect(SESSION_PROVIDER).toContain('await supabase.auth.refreshSession();');
    expect(SESSION_LIFECYCLE).toContain(
      "user?.is_anonymous === true && typeof user.new_email === 'string' && user.new_email !== '';",
    );
    expect(SESSION_LIFECYCLE).toContain(
      'if (stopped || fresh === null || fresh.is_anonymous !== false) return;',
    );
    expect(SESSION_LIFECYCLE).toContain('await auth.refreshSession();');
    // Tres disparadores: al restaurar (arranque en frio), al volver al primer plano, y un sondeo SOLO mientras siga pendiente.
    expect(SESSION_LIFECYCLE).toMatch(
      /if \(pendingConversion\) \{\s*void probeConversion\(\);\s*schedulePoll\(\);/,
    );
    expect(SESSION_LIFECYCLE).toContain('if (stopped || !pendingConversion || !active) return;');
    expect(SESSION_LIFECYCLE).toContain('export const DEFAULT_CONVERSION_POLL_MS = 15_000;');
  });
});

describe('1–5 · Inicio de invitado es «Crea tu cuenta», y nada mas', () => {
  it('ve solo Crear cuenta: nombre precargado, email, contraseña y el boton amarillo', () => {
    const gate = homeGate();
    expect(gate).toContain(
      '<GuestSignUp initialName={guestName} pendingEmail={guestPendingEmail} />',
    );
    expect(HOME).toContain(
      "const guestName = state.status === 'signed-in' ? state.identity.displayName : null;",
    );
    expect(GUEST_SIGN_UP).toContain("useState(initialName ?? '')");
    expect(GUEST_SIGN_UP).toContain("{t('auth.guestSignUpTitle')}");
    for (const field of ["t('auth.name')", "t('auth.email')", "t('auth.password')"]) {
      expect(GUEST_SIGN_UP).toContain(field);
    }
    expect(GUEST_SIGN_UP).toMatch(
      /label=\{running \? t\('auth\.working'\) : t\('auth\.signUpAction'\)\}\s*onPress=\{\(\) => void onSubmit\(\)\}\s*tone="brand"/,
    );
    expect(ES).toContain("'auth.guestSignUpTitle': 'Crea tu cuenta',");
    expect(ES).toContain("'auth.signUpAction': 'Crear cuenta',");
    // El subtitulo, inmediatamente bajo el titulo, con la pareja tipografica de Entrar.
    const heading = slice(
      GUEST_SIGN_UP,
      "{t('auth.guestSignUpTitle')}",
      '<View style={styles.form}>',
    );
    expect(heading).toContain("{t('auth.guestSignUpSubtitle')}");
    expect(heading).toMatch(/variant="body" themeColor="textSecondary"/);
    expect(ES).toContain("'auth.guestSignUpSubtitle': 'para disfrutar del Modo Personal',");
    expect(EN).toContain("'auth.guestSignUpSubtitle': 'to enjoy Personal mode',");
  });

  it('el boton dice si el formulario se puede enviar: gris hasta que nombre, username, email y contraseña valen; amarillo entonces', () => {
    // `ready` = campos presentes + username con la sintaxis compartida (F12/ADR-001 §3)
    // + contraseña al minimo REAL del servidor (credentials.ts, atado al toml).
    expect(GUEST_SIGN_UP).toContain(
      'const ready = registrationReady({ displayName, username, email, password });',
    );
    expect(GUEST_SIGN_UP).toContain('disabled={running || !ready}');
    expect(GUEST_SIGN_UP).toContain('if (!ready) return;');
    // La ayuda del campo dice el minimo real, como texto discreto, no como alerta.
    expect(GUEST_SIGN_UP).toContain(
      "hint={t('auth.passwordMinimum', { count: PASSWORD_MIN_LENGTH })}",
    );
    expect(ES).toContain("'auth.passwordMinimum': 'Mínimo {count} caracteres',");
    expect(EN).toContain("'auth.passwordMinimum': 'At least {count} characters',");
    // Gris apagado o amarillo lo decide action-button-style, que se prueba ejecutandolo
    // con los tokens reales (tests/lib/action-button-style.test.ts). Aqui: el componente
    // lee esa decision para el fondo Y para el texto, sin otra copia.
    expect(ACTION_BUTTON).toContain(
      'const surface = actionSurface({ tone, disabled, pressed, neutral: neutro, theme });',
    );
    expect(ACTION_BUTTON).toContain('backgroundColor: surface.backgroundColor,');
    expect(ACTION_BUTTON).toContain('.textColor');
    expect(strip(ACTION_BUTTON)).not.toMatch(/opacity: disabled \?|theme\.accent\b/);
  });

  it('no ve «Entrar», ni recuperar contraseña, ni «Entrar como invitado», ni Apple/Google', () => {
    const code = strip(GUEST_SIGN_UP);
    expect(code).not.toMatch(
      /SignInForm|signIn\(|signInAction|forgotAction|onForgotPassword|guestAction|onGuest/,
    );
    expect(code).not.toMatch(/Apple|Google|providers|OAuth/);
    expect(code).not.toMatch(/signUp\(/);
    expect(homeGate()).not.toMatch(/SignInForm|GuestGate|signIn|forgot|guestAction/);
    expect(existsSync(resolve(process.cwd(), 'src/features/auth/guest-gate.tsx'))).toBe(false);
    // El + del dock no se ofrece en Inicio a un invitado: no hay Modo Personal al que añadir.
    expect(TABS).toContain("canAdd={!(isGuest(state) && activeRoute === 'index')}");
    expect(DOCK).toContain('{canAdd ? <AddButton activeRoute={activeRoute} /> : null}');
  });
});

describe('6–8 · Perfil de invitado: Crear cuenta → Inicio, ajustes permitidos, Cerrar sesion', () => {
  it('muestra «Crear cuenta» arriba, en amarillo y con el mismo rotulo que Inicio, y navega a la pestaña Inicio (ni modal ni ruta)', () => {
    const guest = profileGuest();
    expect(guest).toMatch(
      /<ActionButton\s+label=\{t\('auth\.signUpAction'\)\}\s+tone="brand"\s+onPress=\{\(\) => \{\s*router\.navigate\('\/'\);/,
    );
    // Siempre habilitado: solo navega. Y `brand` es el amarillo (primary es la superficie neutra).
    expect(guest).not.toMatch(/tone="primary"|disabled=/);
    expect(guest).toMatch(/tone="brand"/);
    expect(ES).toContain("'auth.signUpAction': 'Crear cuenta',");
    expect(ES).not.toContain('guestCreateAccount');
    expect(guest).not.toMatch(/router\.push|Modal|\/register|GuestGate|SignInForm|GuestSignUp/);
  });

  it('conserva la estructura de perfil: ajustes generales si, nombre/planes/cuenta no', () => {
    const guest = profileGuest();
    expect(guest).toContain("<Section title={t('profile.general')}>");
    expect(guest).toContain('{general.map((option, index) => (');
    expect(guest).not.toMatch(
      /AccountAvatar|DisplayNameEditor|PlansCard|profile\.account|profile\.plans/,
    );
  });

  it('mantiene «Cerrar sesion» al final: texto en rojo, no un boton, con su aviso de sesion no recuperable', () => {
    const guest = profileGuest();
    // Texto con rol de enlace, en rojo (`negative`): ni ActionButton ni oblongo.
    const signOut = guest.slice(
      guest.indexOf('style={styles.signOut}>') - 400,
      guest.indexOf('style={styles.signOut}>'),
    );
    expect(signOut).toContain('<ThemedText');
    expect(signOut).toContain('themeColor="negative"');
    expect(signOut).toContain('accessibilityRole="link"');
    expect(signOut).not.toMatch(/ActionButton|Pressable|GlassSurface/);
    expect(guest).toContain("t('account.signOut')");
    expect(guest).toContain("body: t('account.guestSignOutConfirmBody'),");
    expect(guest).toContain('void leave(signOut);');
    expect(ES).toContain("'account.guestSignOutConfirmBody':");
    // Y el sign out va despues del CTA y de los ajustes.
    expect(guest.indexOf("t('auth.signUpAction')")).toBeLessThan(
      guest.indexOf("t('profile.general')"),
    );
    expect(guest.indexOf("t('profile.general')")).toBeLessThan(
      guest.indexOf('style={styles.signOut}>'),
    );
  });
});

describe('9–10 · la conversion sigue siendo updateUser sobre el mismo usuario', () => {
  it('convertGuest es updateUser (email, contraseña, nombre), nunca signUp, y es lo que Inicio envia', () => {
    const convert = slice(AUTH_SERVICE, 'export async function convertGuest(', '\n}\n');
    expect(convert).toContain('await supabase.auth.updateUser({');
    expect(convert).toContain('email,\n    password,\n    data: { display_name: displayName },');
    expect(convert).not.toContain('signUp');
    // F12/ADR-001 §8: el username se reserva ANTES, con la sesion aun anonima, y
    // sin reserva no se envia nada a Auth. Reclamarlo es de F12.A3, no de aqui.
    expect(convert.indexOf('await reserveUsername(username, displayName)')).toBeLessThan(
      convert.indexOf('await supabase.auth.updateUser({'),
    );
    expect(convert).toContain('if (!reservation.ok) return reservation;');
    expect(convert).not.toContain('claim_username');
    expect(GUEST_SIGN_UP).toContain(
      'await submit(() => convertGuest({ displayName, username, email, password }));',
    );
    expect(GUEST_SIGN_UP).toContain("{t('auth.guestCheckEmailStep')}");
    // «Revisa tu correo» sobrevive a un reload mientras el servidor espere (presentacion: new_email);
    // y desaparece con el estado, que es quien manda.
    expect(GUEST_SIGN_UP).toContain('useState<string | null>(pendingEmail)');
    expect(HOME).toContain(
      '<GuestSignUp initialName={guestName} pendingEmail={guestPendingEmail} />',
    );
    // Antes de reenviar, el servicio pregunta al servidor: una conversion ya confirmada refresca y no reenvia.
    expect(convert).toContain(
      'const { data: fresh, error: freshError } = await supabase.auth.getUser();',
    );
    expect(convert).toContain('if (freshError === null && fresh.user.is_anonymous === false) {');
    expect(AUTH_ERRORS).toContain(
      "if (code === 'same_password') return 'authError.guestAlreadyConverted';",
    );
    expect(BOUNDARY).toContain('reenviar la conversion con la copia vieja: 422 same_password');
    expect(BOUNDARY).toContain('GET /user con el token anonimo guardado ya responde la cuenta');
    expect(AUTH_ERRORS).toContain(
      "if (code === 'email_exists' || code === 'user_already_exists') return 'authError.guestEmailTaken';",
    );
  });

  it('el mismo uid antes y despues, con la huella intacta: medido por HTTP (seccion 14)', () => {
    expect(BOUNDARY).toContain(
      '== 14 · el modo Invitado es una sesion anonima REAL (F05), y convertirla conserva el id ==',
    );
    expect(BOUNDARY).toContain('ok "PUT /user responde el MISMO id (${GUEST_UID})"');
    expect(BOUNDARY).toContain(
      'ok "el refresh token del invitado devuelve la cuenta: mismo sub, is_anonymous false"',
    );
    expect(BOUNDARY).toContain('ok "password grant con el correo nuevo: el mismo id"');
    expect(BOUNDARY).toContain(
      "select 'memb='||(select count(*) from core.membership where user_id='${GUEST_UID}')",
    );
    expect(BOUNDARY).toContain('ok "huella identica antes y despues de convertir: ${despues}"');
    // El Personal interno se sigue provisionando para cualquier sesion autenticada.
    expect(PERSONAL_SCOPE).toContain('ensurePersonalScope(');
    expect(PERSONAL_SCOPE).not.toMatch(/isGuest|isAnonymous/);
    expect(BOUNDARY).toContain('ok "ensure_personal_scope como invitado');
  });
});

describe('12 · entrar en una cuenta existente desde un invitado sigue fallando cerrado', () => {
  it('signIn comprueba la sesion anonima ANTES de signInWithPassword y no la sustituye', () => {
    const signIn = slice(AUTH_SERVICE, 'export async function signIn(', '\n}\n');
    const order = [
      'const { data: current } = await supabase.auth.getSession();',
      "if (current.session?.user.is_anonymous === true) {\n    return { ok: false, messageKey: 'authError.guestSignInBlocked' };",
      'await supabase.auth.signInWithPassword({ email, password });',
    ].map((s) => signIn.indexOf(s));
    expect(order.every((p) => p > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(ES).toContain("'authError.guestSignInBlocked':");
    expect(BOUNDARY).toContain('medido: entrar por contrasena desde un invitado seria OTRO sub');
    expect(ADR).toContain(
      '### §5 · Lo que NO se decide: fusionar un invitado con una cuenta existente',
    );
    // Y ninguna UI del estado invitado lo ofrece: solo Entrar, signed-out.
    expect(homeGate()).not.toContain('signIn');
    expect(profileGuest()).not.toMatch(/signIn\(|forgot|SignInForm/);
  });
});

describe('sin Apple/Google, sin simulacion, configuracion dicha tal cual', () => {
  it('Grupos no cambia; no quedan Apple ni Google; la simulacion se retiro', () => {
    expect(GROUPS).not.toMatch(/isGuest|isAnonymous|guest|invitado/i);
    expect(PACKAGE).not.toMatch(/expo-apple-authentication|google-signin/);
    expect(strip(FORM)).not.toMatch(/providers|Apple|Google|readonly heading/);
    expect(ES).not.toMatch(/continueApple|continueGoogle|guestHomeTitle|guestProfileTitle/);
    for (const gone of [
      'src/app/guest-preview.tsx',
      'src/app/register.tsx',
      'src/app/recover.tsx',
      'src/features/shell/guest-preview.ts',
      'src/features/auth/provider-buttons.tsx',
      'tests/infra/guest-preview-surface.test.ts',
    ]) {
      expect(existsSync(resolve(process.cwd(), gone)), gone).toBe(false);
    }
    expect(SHELL_INDEX).not.toContain('guest-preview');
    expect(PROFILE).not.toMatch(/guestPreview|stopGuestPreview/);
  });

  it('anonymous sign-ins esta activo en local, y el toml dice que el proyecto alojado hay que activarlo aparte', () => {
    expect(CONFIG).toMatch(/\nenable_anonymous_sign_ins = true\n/);
    expect(CONFIG).toContain('A hosted project must switch the');
    expect(ADR).toContain('**Proyecto alojado: NO queda activado por este repositorio.**');
  });
});
