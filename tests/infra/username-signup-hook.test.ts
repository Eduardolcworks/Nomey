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
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import EN from '../../src/lib/i18n/messages/en.ts?raw';

/**
 * El username se reserva EN EL ALTA (F12/ADR-001 §5, F12.A2), y las piezas que
 * lo sostienen tienen que moverse juntas.
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

describe('el cliente (F12.A2)', () => {
  it('signUp manda display_name y requested_username en options.data', () => {
    expect(AUTH_SERVICE).toContain(
      'options: { data: { display_name: displayName, requested_username: username } },',
    );
  });

  it('convertGuest reserva por api.reserve_username ANTES de updateUser y nunca reclama', () => {
    const convert = AUTH_SERVICE.slice(AUTH_SERVICE.indexOf('export async function convertGuest('));
    expect(convert.indexOf('await reserveUsername(username, displayName)')).toBeGreaterThan(0);
    expect(convert.indexOf('await reserveUsername(username, displayName)')).toBeLessThan(
      convert.indexOf('await supabase.auth.updateUser({'),
    );
    expect(AUTH_SERVICE).not.toContain('claim_username');
  });

  it('las dos pantallas de alta piden el username con el campo compartido y lo envian', () => {
    expect(SIGN_UP).toContain('<UsernameField');
    expect(SIGN_UP).toContain('signUp({ displayName, username, email, password })');
    expect(GUEST_SIGN_UP).toContain('<UsernameField');
    expect(GUEST_SIGN_UP).toContain('convertGuest({ displayName, username, email, password })');
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
