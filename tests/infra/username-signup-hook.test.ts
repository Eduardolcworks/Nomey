import { describe, expect, it } from 'vitest';

import CONFIG from '../../supabase/config.toml?raw';
import MIGRATION from '../../supabase/migrations/20260924120000_username_signup_hook.sql?raw';
import CHECK from '../../supabase/checks/username.sql?raw';
import BOUNDARY from '../../scripts/http-boundary-check.sh?raw';
import PROBE from '../../scripts/offline-taxonomy-probe.sh?raw';
import RACE from '../../scripts/username-signup-race-evidence.sh?raw';
import WORKFLOW from '../../.github/workflows/ci.yml?raw';
import AUTH_SERVICE from '../../src/features/auth/auth-service.ts?raw';
import AUTH_ERRORS from '../../src/features/auth/auth-errors.ts?raw';
import SIGN_UP from '../../src/app/(auth)/sign-up.tsx?raw';
import GUEST_SIGN_UP from '../../src/features/auth/guest-sign-up.tsx?raw';
import GATE from '../../src/features/auth/username-gate.tsx?raw';
import RELAX from '../../supabase/migrations/20261008120000_signup_without_username.sql?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import EN from '../../src/lib/i18n/messages/en.ts?raw';

/**
 * El username se reserva en el alta CUANDO EL ALTA LO TRAE, y las piezas que
 * lo sostienen tienen que moverse juntas.
 *
 * **F12/ADR-008 cambió quién lo trae.** El alta por correo de Nomey ya no: pide
 * correo y contraseña, el hook la deja pasar sin escribir nada, y el gate pide
 * nombre y username después de confirmar. La rama del hook que SÍ recibe
 * username conserva su contrato intacto, y es la que sigue guardándose aquí.
 *
 * Son cuatro hechos en cuatro ficheros distintos: el hook de GoTrue esta
 * ACTIVADO en `config.toml` y apunta a la funcion de `sec`; la migracion la
 * hace del provisioner y da a `supabase_auth_admin` exactamente eso; el
 * cliente manda `requested_username` en el alta y reserva antes de convertir
 * un invitado; y todo alta por correo de los scripts manda un username, porque
 * si no el hook la rehusa. Quitar cualquiera de los cuatro «arregla» algo y
 * rompe otro sitio con un mensaje que no señala la causa.
 *
 * La direccion peligrosa que se protege: comentar el hook en el toml para que
 * un alta sin username vuelva a pasar. Eso deshace ADR-001 §5 en silencio: la
 * app seguiria mandando el username y nadie lo reservaria.
 *
 * Lo REAL —que GoTrue llama al hook dentro de su transaccion y que el rechazo
 * llega como {"code","error_code":"unknown","msg"}— lo miden
 * `http-boundary-check.sh` §16 y `username-signup-race-evidence.sh` contra el
 * stack vivo. Esto es la capa de texto que corre sin base de datos.
 */

function tomlSection(section: string): string {
  const parts = CONFIG.split(`\n[${section}]\n`);
  if (parts.length !== 2) throw new Error(`[${section}] debe aparecer exactamente una vez, activa`);
  return parts[1].split(/^\[/m)[0];
}

describe('el hook before_user_created (config.toml)', () => {
  it('esta ACTIVADO, no comentado, y apunta a sec.before_user_created en la base postgres', () => {
    const body = tomlSection('auth.hook.before_user_created');
    expect(body).toMatch(/^enabled = true$/m);
    expect(body).toMatch(/^uri = "pg-functions:\/\/postgres\/sec\/before_user_created"$/m);
    // La plantilla comentada de la CLI ya no esta: seria una segunda verdad.
    expect(CONFIG).not.toContain('# [auth.hook.before_user_created]');
    expect(CONFIG).not.toContain('before-user-created-hook');
  });

  it('dice que el alojado lo activa por su cuenta y que un cambio exige stop + start', () => {
    const idx = CONFIG.indexOf('[auth.hook.before_user_created]');
    const around = CONFIG.slice(Math.max(0, idx - 900), idx);
    expect(around.replace(/\n#\s*/g, ' ')).toMatch(/hosted project must enable this hook itself/);
    expect(around).toMatch(/stop.*start/);
  });
});

describe('la migracion 20260924120000', () => {
  it('crea sec.before_user_created(event jsonb) definer del provisioner con search_path vacio', () => {
    expect(MIGRATION).toContain('create function sec.before_user_created(event jsonb)');
    expect(MIGRATION).toContain('security definer');
    expect(MIGRATION).toContain("set search_path = ''");
    expect(MIGRATION).toContain(
      'alter function sec.before_user_created(jsonb) owner to nomey_provisioner;',
    );
    expect(MIGRATION).not.toMatch(/owner to postgres/);
    expect(MIGRATION).not.toMatch(/alter role|bypassrls true/i);
  });

  it('da a supabase_auth_admin USAGE en sec y EXECUTE en el hook, y nada mas', () => {
    expect(MIGRATION).toContain('grant usage on schema sec to supabase_auth_admin;');
    expect(MIGRATION).toContain(
      'grant execute on function sec.before_user_created(jsonb) to supabase_auth_admin;',
    );
    expect(MIGRATION).toContain(
      'revoke execute on function sec.before_user_created(jsonb) from public;',
    );
    const grants = MIGRATION.match(/^grant .*supabase_auth_admin;$/gm) ?? [];
    expect(grants).toHaveLength(2);
    expect(MIGRATION).not.toMatch(/grant .* on schema (core|api) to supabase_auth_admin/);
  });

  it('rehusa DEVOLVIENDO el error del hook con los codigos del contrato, y solo actua sobre email/password', () => {
    for (const code of ['USERNAME_REQUIRED', 'USERNAME_TAKEN']) {
      expect(MIGRATION).toContain(`'message', '${code}'`);
    }
    // INVALID y RESERVED viajan desde sec.assert_handle_valid, capturados como PGRST.
    expect(MIGRATION).toContain("when sqlstate 'PGRST' then");
    expect(MIGRATION).toContain('when unique_violation then');
    expect(MIGRATION).toContain("if v_anon or v_provider is distinct from 'email' then");
    // Reserva provisional: nunca claim en el alta.
    expect(MIGRATION).toContain(
      "reserved_until) values (v_handle, v_uid, now() + interval '7 days')",
    );
    expect(MIGRATION).not.toMatch(/claimed_at\s*=\s*now\(\)/);
    // El uid es el del evento, fijado como actor para las politicas de A1.
    expect(MIGRATION).toContain("json_build_object('sub', v_uid::text)::text, true");
    // Y nunca lee auth.users.
    expect(MIGRATION).not.toMatch(/auth\.users/);
  });

  it('username.sql guarda que auth_admin ejecuta EXACTAMENTE una funcion de sec y ejerce el hook (H)', () => {
    expect(CHECK).toContain(
      "if v_n <> 1 then raise exception 'A: supabase_auth_admin ejecuta % funciones de sec",
    );
    expect(CHECK).toContain('sec.before_user_created(p_event)');
    for (const label of ['H1', 'H2', 'H3', 'H4', 'H5']) expect(CHECK).toContain(`OK · ${label}`);
  });
});

describe('el alta sin username (F12/ADR-008)', () => {
  /*
   * La rama que cambió, y las que NO. El hook recrea la misma función con una
   * sola diferencia: sin `requested_username` devuelve `{}` en vez de
   * `USERNAME_REQUIRED`. Si alguien volviera a poner el rechazo, el alta de
   * F12/ADR-008 dejaría de crear cuentas — y sin esta guarda el síntoma sería
   * un 400 opaco en el formulario.
   */
  it('recrea sec.before_user_created y deja pasar el alta sin username', () => {
    expect(RELAX).toContain('create or replace function sec.before_user_created(event jsonb)');
    expect(RELAX).toContain('security definer');
    expect(RELAX).toContain("set search_path = ''");

    const rama = RELAX.slice(
      RELAX.indexOf("v_raw := v_user -> 'user_metadata' ->> 'requested_username';"),
      RELAX.indexOf("perform set_config('request.jwt.claims'"),
    );
    expect(rama).toContain("return '{}'::jsonb;");
    expect(rama).not.toContain('USERNAME_REQUIRED');
  });

  it('y no escribe NADA en esa rama: ni identidad, ni handle, ni diario', () => {
    const rama = RELAX.slice(
      RELAX.indexOf("v_raw := v_user -> 'user_metadata' ->> 'requested_username';"),
      RELAX.indexOf("perform set_config('request.jwt.claims'"),
    );
    for (const tabla of ['account_identity', 'account_handle', 'account_handle_event']) {
      expect(rama, tabla).not.toContain(tabla);
    }
  });

  /* La rama CON username se conserva palabra por palabra. */
  it('conserva intacta la rama que sí trae username, con sus cuatro rechazos', () => {
    expect(RELAX).toContain('v_handle := sec.assert_handle_valid(v_raw);');
    expect(RELAX).toContain('insert into core.account_identity (user_id, public_name)');
    expect(RELAX).toContain("now() + interval '7 days'");
    expect(RELAX).toContain("'USERNAME_TAKEN'");
    expect(RELAX).toContain("'PAYLOAD_INVALID'");
  });

  /*
   * NI UN GRANT NUEVO. `create or replace` conserva owner y privilegios, así
   * que la migración no vuelve a concederlos — y no puede conceder otros.
   */
  it('no concede ni revoca nada, ni crea relaciones', () => {
    const sql = RELAX.toLowerCase();
    for (const verbo of [
      'grant ',
      'revoke ',
      'create table',
      'create view',
      'create policy',
      'create index',
      'alter table',
      'alter function',
    ]) {
      expect(sql, verbo).not.toContain(verbo);
    }
  });

  /* El hook sigue ACTIVADO: esto no lo desactiva por la puerta de atrás. */
  it('el hook sigue activado en config.toml', () => {
    expect(CONFIG).toContain('[auth.hook.before_user_created]');
    expect(CONFIG).toContain('[auth.hook.before_user_created]' + '\n' + 'enabled = true');
  });
});

describe('el cliente (F12.A2)', () => {
  /*
   * F12/ADR-008 invierte esta guarda. El alta por correo dejó de llevar
   * identidad: ni `display_name` ni `requested_username`, y por tanto ningún
   * `options.data`. Lo que se afirma ahora es lo contrario de lo que se
   * afirmaba, y con la misma exigencia: que NO viaje nada de eso.
   */
  it('signUp manda SOLO correo y contraseña: ningún options.data', () => {
    const fn = AUTH_SERVICE.slice(
      AUTH_SERVICE.indexOf('export async function signUp('),
      AUTH_SERVICE.indexOf('export async function signIn('),
    );
    expect(fn).toContain('await supabase.auth.signUp({ email, password });');
    expect(fn).not.toContain('options');
    expect(fn).not.toContain('requested_username');
    expect(fn).not.toContain('display_name');
  });

  it('convertGuest reserva por api.reserve_username ANTES de updateUser y nunca reclama', () => {
    const convert = AUTH_SERVICE.slice(AUTH_SERVICE.indexOf('export async function convertGuest('));
    expect(convert.indexOf('await reserveUsername(username, displayName)')).toBeGreaterThan(0);
    expect(convert.indexOf('await reserveUsername(username, displayName)')).toBeLessThan(
      convert.indexOf('await supabase.auth.updateUser({'),
    );
    expect(AUTH_SERVICE).not.toContain('claim_username');
  });

  /*
   * Queda UNA pantalla de alta que pide el username: la del invitado, cuyo
   * contrato no cambia (F12/ADR-001 §8, reserva antes de `updateUser`). El
   * alta por correo ya no lo pide ni lo manda, y eso se afirma aquí para que
   * volver a ponerlo sea un fallo y no un descuido.
   */
  it('el alta por correo ya NO pide username ni nombre; la del invitado sigue pidiéndolos', () => {
    expect(SIGN_UP).not.toContain('<UsernameField');
    expect(SIGN_UP).not.toContain('usernameProblem');
    expect(SIGN_UP).not.toContain('displayName');
    expect(SIGN_UP).toContain('signUp({ email, password })');

    expect(GUEST_SIGN_UP).toContain('<UsernameField');
    expect(GUEST_SIGN_UP).toContain('convertGuest({ displayName, username, email, password })');
  });

  /* Y el nombre y el username los sigue pidiendo el gate, que no cambia. */
  it('el gate sigue siendo quien pide nombre y username, y la única puerta a las pestañas', () => {
    expect(GATE).toContain('<UsernameField');
    expect(GATE).toContain('normaliseDisplayName(publicName)');
    expect(GATE).toContain('chooseUsername(username, publicName)');
  });

  it('el rechazo del hook se mapea por igualdad exacta del mensaje, solo con code "unknown" (medido)', () => {
    expect(AUTH_ERRORS).toContain(
      "if (failure.code !== 'unknown' || failure.message === undefined) return undefined;",
    );
    for (const code of [
      'USERNAME_REQUIRED',
      'USERNAME_INVALID',
      'USERNAME_RESERVED',
      'USERNAME_TAKEN',
    ]) {
      expect(AUTH_ERRORS).toContain(`${code}: 'authError.`);
    }
    for (const key of [
      'authError.usernameRequired',
      'authError.usernameInvalid',
      'authError.usernameReserved',
      'authError.usernameTaken',
      'auth.username',
      'auth.usernamePlaceholder',
      'auth.usernameHint',
    ]) {
      expect(ES).toContain(`'${key}':`);
      expect(EN).toContain(`'${key}':`);
    }
  });
});

describe('toda alta por correo de los scripts manda un username', () => {
  it('http-boundary-check.sh y offline-taxonomy-probe.sh: alta(email, username) con requested_username', () => {
    for (const script of [BOUNDARY, PROBE]) {
      expect(script).toMatch(/alta\(\) \{ # \$1 email, \$2 username/);
      expect(script).toContain('\\"requested_username\\":\\"$2\\"');
      // Ninguna llamada a alta sin el segundo argumento.
      const calls = script.match(/\balta "\$\{EMAIL_[A-Z]\}"[^\n]*/g) ?? [];
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(call).toMatch(/alta "\$\{EMAIL_[A-Z]\}" \w+/);
    }
  });

  it('la carrera de altas reales existe y CI la ejecuta tras las carreras de username', () => {
    expect(RACE).toContain('/auth/v1/signup');
    expect(RACE).toContain('USERNAME_TAKEN');
    expect(WORKFLOW).toContain('run: bash scripts/username-signup-race-evidence.sh');
    expect(WORKFLOW.indexOf('scripts/username-race-evidence.sh')).toBeLessThan(
      WORKFLOW.indexOf('scripts/username-signup-race-evidence.sh'),
    );
    // Y la frontera HTTP mide el hook real (§16) antes del ciclo A1 (§17).
    expect(BOUNDARY.indexOf('== 16 · el alta reserva el username')).toBeLessThan(
      BOUNDARY.indexOf('== 17 · el username por HTTP'),
    );
  });
});
