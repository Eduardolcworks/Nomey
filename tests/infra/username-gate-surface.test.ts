import { describe, expect, it } from 'vitest';

import LAYOUT from '../../src/app/_layout.tsx?raw';
import GATE_ROUTE from '../../src/app/username-gate.tsx?raw';
import CACHE from '../../src/features/auth/identity-cache.ts?raw';
import PROFILE from '../../src/app/profile.tsx?raw';
import PROVIDER from '../../src/features/auth/use-account-identity.tsx?raw';
import SERVICE from '../../src/features/auth/identity-service.ts?raw';
import STATE from '../../src/features/auth/identity-state.ts?raw';
import GATE from '../../src/features/auth/username-gate.tsx?raw';
import EDITOR from '../../src/features/auth/username-editor.tsx?raw';
import NAME_EDITOR from '../../src/features/auth/display-name-editor.tsx?raw';
import AUTH_INDEX from '../../src/features/auth/index.ts?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import EN from '../../src/lib/i18n/messages/en.ts?raw';

/**
 * F12.A3: el ciclo de claim, el gate y Perfil, como superficie versionada.
 *
 * Lo que aqui se fija es la FORMA del contrato en el cliente; que el servidor
 * reclame una reserva viva, rehuse sin reserva con USERNAME_REQUIRED y frene
 * el cambio con USERNAME_CHANGE_COOLDOWN lo mide `supabase/checks/username.sql`
 * (C2, C3, D2) y la frontera HTTP §17 (B reclama por claim_username; C sin
 * reserva → USERNAME_REQUIRED). Juntas cubren el flujo entero:
 *
 *   alta con username (A2) → confirmar → entrar → claim automático → app
 *   cuenta anterior a F12 → entrar → USERNAME_REQUIRED → gate → elegir → app
 *   invitado → nunca pregunta, nunca gate → convertirse → claim → app
 */
const slice = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`no encontrado: ${from}`);
  const b = src.indexOf(to, a);
  return b < 0 ? src.slice(a) : src.slice(a, b);
};

describe('1 · el ciclo: una llamada, solo para cuentas normales', () => {
  it('el proveedor pregunta con claim_username, una vez por actor, y nunca a un invitado', () => {
    expect(PROVIDER).toContain("const asks = actorId !== '' && !isAnonymous;");
    expect(PROVIDER).toContain('if (!asks) return;');
    expect(PROVIDER).toContain('void claimUsername().then(');
    expect(PROVIDER).toMatch(/\}, \[asks, actorId, wake\]\);/);
    // Ni lee la vista primero ni reserva desde el ciclo.
    expect(PROVIDER).not.toContain('reserve_username');
    expect(PROVIDER).not.toContain('my_account_handle');
    expect(SERVICE).toContain("return rpcIdentity('claim_username');");
  });

  it('las tres respuestas del servidor son las tres ramas: listo (app), required (gate) y unavailable (app, offline)', () => {
    expect(PROVIDER).toContain(
      "if (result.ok) settle({ status: 'ready', identity: result.identity });",
    );
    expect(PROVIDER).toContain('else if (result.required === true) settle(IDENTITY_REQUIRED);');
    expect(PROVIDER).toContain('else settle(IDENTITY_UNAVAILABLE);');
    expect(SERVICE).toContain(
      "if (code === 'USERNAME_REQUIRED') return { ok: false, required: true };",
    );
    // Solo un veredicto del servidor abre el gate; sin red la app entra (F07).
    expect(STATE).toContain("return state.status === 'required';");
    expect(STATE).toContain(
      "return !asks || state.status === 'ready' || state.status === 'unavailable';",
    );
    expect(STATE).toContain("return asks && state.status === 'idle';");
  });

  it('nada se escribe en el cuerpo del efecto: la respuesta va por actor y se deriva', () => {
    expect(PROVIDER).toContain(
      'const state: IdentityState = asks && answer.for === actorId ? answer.state : IDENTITY_IDLE;',
    );
    expect(PROVIDER).not.toMatch(/useEffect\(\(\) => \{\s*\n\s*setAnswer/);
  });
});

describe('2 · el gate, antes de las pestañas y sin salida lateral', () => {
  it('la raiz registra el gate en lugar de las pestañas mientras la identidad diga required, y espera a saberlo', () => {
    expect(LAYOUT).toContain('<IdentityBinding>');
    expect(LAYOUT).toContain("actorId={state.status === 'signed-in' ? state.identity.userId : ''}");
    expect(LAYOUT).toContain(
      "isAnonymous={state.status === 'signed-in' && state.identity.isAnonymous}",
    );
    expect(LAYOUT).toContain('const resolved = isResolved(state) && !identityPending;');
    expect(LAYOUT).toContain('const gate = needsUsernameGate(identity);');
    expect(LAYOUT).toContain('<Stack.Protected guard={isSignedIn(state) && !recovering && gate}>');
    expect(LAYOUT).toContain('<Stack.Screen name="username-gate" />');
    // Las tabs con todo lo que no sea el gate: unavailable ENTRA (offline first).
    expect(LAYOUT).toContain('<Stack.Protected guard={isSignedIn(state) && !recovering && !gate}>');
    expect(LAYOUT).not.toMatch(/identity-unavailable|guard={[^}]*unavailable/);
    // La rama publica y la de recuperacion no cambian.
    expect(LAYOUT).toContain('<Stack.Protected guard={isPublic(state) && !recovering}>');
    expect(GATE_ROUTE).toContain('<UsernameGate initialName={initialName} />');
  });

  it('el gate pide nombre publico (precargado con el de la sesion) y username, reserva+reclama, y no ofrece saltar', () => {
    expect(GATE).toContain("const [publicName, setPublicName] = useState(initialName ?? '');");
    expect(GATE).toContain('<UsernameField');
    expect(GATE).toContain('await chooseUsername(username, publicName)');
    expect(GATE).toContain('apply(outcome.identity);');
    // Un solo boton, y ninguna clave de «saltar» o «mas tarde» en la pantalla ni en el catalogo.
    expect(GATE.match(/<ActionButton/g)).toHaveLength(1);
    expect(GATE).not.toMatch(/t\('identity\.(skip|later)/);
    expect(ES).not.toMatch(/'identity\.(skip|later)'/);
    expect(GATE).not.toMatch(/router\./);
    // Ni del correo ni inventado: el nombre viene de la sesion o lo escribe la persona.
    expect(GATE).not.toMatch(/email/);
    expect(GATE_ROUTE).toContain('state.identity.displayName : null');
    // reserve_username reclama en el acto para una cuenta normal; si no, claim.
    const choose = slice(SERVICE, 'export async function chooseUsername(', '\nexport ');
    expect(choose).toContain("rpcIdentity('reserve_username'");
    expect(choose).toContain(
      "if (!reserved.ok || reserved.identity.state === 'claimed') return reserved;",
    );
    expect(choose).toContain("return rpcIdentity('claim_username');");
  });
});

describe('2b · sin red: la cuenta entra, el gate no se abre, y se vuelve a preguntar al volver', () => {
  it('un fallo de transporte es unavailable y nunca pisa una respuesta mejor; el respaldo se lee a la vez', () => {
    expect(PROVIDER).toContain('else settle(IDENTITY_UNAVAILABLE);');
    expect(PROVIDER).toContain("next.status === 'unavailable' &&");
    expect(PROVIDER).toContain("current.state.status !== 'idle'");
    expect(PROVIDER).toContain('const cached = await recall(actorId);');
    expect(PROVIDER).toContain("source: 'cache'");
    // Y el respaldo se escribe solo desde una respuesta del servidor (o un comando propio).
    expect(PROVIDER).toContain(
      "if (next.status === 'ready') void remember(actorId, next.identity);",
    );
    expect(CACHE).toContain(
      "if (identity.state !== 'claimed' || identity.handle === null) return null;",
    );
    expect(CACHE).toContain("export const IDENTITY_CACHE_KEY = 'account-identity';");
    // El mismo almacen offline por actor que el resto de la app, no un segundo sistema.
    expect(PROVIDER).toContain("import { offlineCatalogueCache } from '@/lib/offline';");
  });

  it('el reloj de guarda deja entrar aunque fetch no se rinda, y una respuesta tardia sigue valiendo', () => {
    expect(PROVIDER).toContain('export const IDENTITY_WATCHDOG_MS = 10_000;');
    expect(PROVIDER).toContain(
      'const watchdog = setTimeout(() => settle(IDENTITY_UNAVAILABLE), IDENTITY_WATCHDOG_MS);',
    );
    expect(PROVIDER).toContain('clearTimeout(watchdog);');
  });

  it('la reconexion es el unico AppState de la app: wakeIdentity desde onForeground, solo si sigue sin resolver', () => {
    expect(LAYOUT).toContain('<SessionProvider onForeground={wakeOnForeground}>');
    expect(LAYOUT).toContain('wakeQueue();\n  wakeIdentity();');
    expect(PROVIDER).toContain('onIdentityWake(() => {');
    expect(PROVIDER).toContain('if (unresolved.current) setWake((value) => value + 1);');
    expect(PROVIDER).toContain(
      "const stillUnresolved = asks && (state.status === 'unavailable' || answer.source === 'cache');",
    );
    // Sin polling ni temporizadores de reintento.
    expect(PROVIDER).not.toMatch(/setInterval|retryBusy|setRetrying/);
  });

  it('no queda pantalla bloqueante ni copy de «no puedes entrar», y Perfil no trata unavailable', () => {
    expect(PROFILE).not.toContain("identity.status === 'unavailable'");
    expect(ES).not.toMatch(/identity\.unavailable/);
    expect(EN).not.toMatch(/identity\.unavailable/);
    expect(AUTH_INDEX).not.toContain('IdentityUnavailable');
  });
});

describe('3 · Perfil: nombre publico y @username, core como autoridad', () => {
  it('enseña el nombre publico de core cuando existe y edita core PRIMERO, metadata despues, sin deshacer', () => {
    expect(PROFILE).toContain(
      "identity.status === 'ready' ? (identity.identity.publicName ?? displayName) : displayName",
    );
    expect(PROFILE).toContain(
      '<DisplayNameEditor name={publicName} onSave={savePublicName} notice={nameNotice} />',
    );
    const update = slice(SERVICE, 'export async function updatePublicName(', '\n}\n');
    expect(update.indexOf("rpcIdentity('set_public_name'")).toBeLessThan(
      update.indexOf('supabase.auth.updateUser({ data: { display_name: publicName } })'),
    );
    expect(update).toContain('metadataStale: error !== null');
    expect(update).not.toMatch(/revert|rollback/i);
    expect(PROFILE).toContain("t('identity.nameSyncPending')");
    expect(NAME_EDITOR).toContain('onSave = updateDisplayName');
    expect(NAME_EDITOR).toContain('const result = await submit(() => onSave(draft));');
  });

  it('el username se cambia con change_username; el lapiz respeta el cooldown y la fecha se enseña', () => {
    expect(PROFILE).toContain('<UsernameEditor identity={identity.identity} />');
    expect(EDITOR).toContain('await changeUsername(draft)');
    expect(EDITOR).toContain('const canChange = canChangeUsername(identity, new Date());');
    expect(EDITOR).toContain('{canChange ? (');
    expect(EDITOR).toContain("t('identity.cooldownUntil', { date: date(shownCooldown, 'long') })");
    expect(SERVICE).toContain("if (code === 'USERNAME_CHANGE_COOLDOWN') {");
    expect(SERVICE).toContain('detailsOf(error).available_at');
  });

  it('ni historial, ni handles retenidos, ni uid: solo las cinco columnas de la vista', () => {
    for (const src of [STATE, SERVICE, PROVIDER, EDITOR, GATE, PROFILE]) {
      expect(src).not.toMatch(
        /held_until|released_at|account_handle_event|user_id|held handles list/,
      );
    }
    expect(STATE).toContain('readonly can_change_at: string | null;');
    expect(STATE).toMatch(/handle: text\(row\?\.handle\)/);
    // Ningun boton ni clave para listar usernames anteriores.
    expect(EDITOR).not.toMatch(/t\('identity\.(history|previous|held)/);
    expect(ES).not.toMatch(/'identity\.(history|previous|held)/);
  });
});

describe('4 · i18n, exports y backend', () => {
  it('las frases de A3 existen en ES y EN, y ninguna enseña un codigo tecnico', () => {
    for (const key of [
      'identity.gateTitle',
      'identity.gateBody',
      'identity.gateAction',
      'identity.publicName',
      'identity.publicNameHint',
      'identity.noUsername',
      'identity.editUsername',
      'identity.changeHint',
      'identity.cooldownUntil',
      'identity.nameSyncPending',
      'authError.usernameCooldown',
    ]) {
      expect(ES).toContain(`'${key}':`);
      expect(EN).toContain(`'${key}':`);
    }
    expect(ES).toContain("'identity.cooldownUntil': 'Podrás cambiarlo a partir del {date}.'");
    for (const cat of [ES, EN]) expect(cat).not.toMatch(/USERNAME_[A-Z_]+/);
  });

  it('la feature exporta el proveedor, el gate y el editor; la raiz los compone', () => {
    for (const name of [
      'AccountIdentityProvider',
      'useAccountIdentity',
      'UsernameGate',
      'UsernameEditor',
      'wakeIdentity',
      'updatePublicName',
      'chooseUsername',
      'claimUsername',
      'changeUsername',
    ]) {
      expect(AUTH_INDEX).toContain(name);
    }
  });

  it('A3 no trae SQL: las migraciones de username son las de A1 y A2', () => {
    const migrations = Object.keys(
      import.meta.glob('../../supabase/migrations/*.sql', {
        query: '?raw',
        import: 'default',
        eager: true,
      }),
    ).map((path) => path.replace('../../supabase/migrations/', ''));
    expect(migrations.filter((f) => /username|account_identity/.test(f))).toEqual([
      '20260921120000_account_identity.sql',
      '20260924120000_username_signup_hook.sql',
    ]);
  });
});
