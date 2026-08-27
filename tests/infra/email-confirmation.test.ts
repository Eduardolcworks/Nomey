import { describe, expect, it } from 'vitest';

import CONFIG from '../../supabase/config.toml?raw';
import BOUNDARY_CHECK from '../../scripts/http-boundary-check.sh?raw';
import WORKFLOW from '../../.github/workflows/ci.yml?raw';

/**
 * La confirmación de correo es obligatoria, y el check de la Fase 3 lo sabe.
 *
 * Son dos hechos que **tienen que moverse juntos**, y por eso se comprueban en
 * el mismo sitio. `scripts/http-boundary-check.sh` daba de alta un usuario y
 * tomaba el `access_token` de la respuesta del alta; con confirmación
 * obligatoria GoTrue ya no la devuelve, así que el check habría empezado a
 * fallar en CI con un mensaje que no señala la causa.
 *
 * Lo que se protege es la dirección peligrosa: **que alguien apague las
 * confirmaciones para que el check vuelva a pasar.** Eso «arregla» CI y
 * deshace una decisión de producto.
 *
 * El comportamiento real —que el alta no emite sesión y que tras confirmar sí
 * hay JWT— lo comprueba el propio script contra el stack vivo. Esto es la capa
 * de texto que se puede correr en CI sin base de datos, igual que
 * `exposed-schemas`.
 */

/** Lee una clave TOML dentro de una sección concreta. */
function tomlValue(section: string, key: string): string {
  const sectionBody = CONFIG.split(`[${section}]`)[1];
  if (sectionBody === undefined) throw new Error(`No existe la sección [${section}]`);
  // Hasta la siguiente cabecera de sección.
  const body = sectionBody.split(/^\[/m)[0];
  const match = body.match(new RegExp(`^${key}\\s*=\\s*(\\S+)`, 'm'));
  if (match === null) throw new Error(`No se encontró "${key}" en [${section}]`);
  return match[1];
}

describe('confirmación de correo obligatoria', () => {
  it('está activada para el correo', () => {
    expect(tomlValue('auth.email', 'enable_confirmations')).toBe('true');
  });

  it('el alta por correo sigue permitida: obligatoria no es cerrada', () => {
    expect(tomlValue('auth.email', 'enable_signup')).toBe('true');
  });

  it('no se ha abierto el alta por SMS de rebote', () => {
    // Las dos claves se llaman igual en dos secciones distintas, y confundirlas
    // activaría un método de autenticación que el producto no tiene.
    expect(tomlValue('auth.sms', 'enable_signup')).toBe('false');
  });

  it('sigue sin haber acceso anónimo', () => {
    expect(tomlValue('auth', 'enable_anonymous_sign_ins')).toBe('false');
  });

  it('hay captura de correo local, que es como se prueba el flujo sin SMTP', () => {
    expect(tomlValue('local_smtp', 'enabled')).toBe('true');
  });
});

describe('el check HTTP de la Fase 3 sobrevive a la confirmación obligatoria', () => {
  it('ya NO toma el token de la respuesta del alta', () => {
    // El patrón viejo: `RA=$(alta ...)` y acto seguido `jget access_token`
    // sobre esa misma respuesta.
    expect(BOUNDARY_CHECK).not.toMatch(/RA=\$\(alta[\s\S]{0,120}?RA\}" \| jget access_token/);
  });

  it('comprueba explícitamente que el alta NO emite sesión', () => {
    expect(BOUNDARY_CHECK).toContain('el alta no emite sesion');
  });

  it('confirma el usuario antes de pedirle sesión', () => {
    expect(BOUNDARY_CHECK).toMatch(/confirmar\(\)/);
    expect(BOUNDARY_CHECK).toContain('email_confirmed_at = now()');
  });

  it('escribe la columna escribible, no la generada', () => {
    // `confirmed_at` es GENERATED ALWAYS: escribirla es un error de Postgres.
    expect(BOUNDARY_CHECK).not.toMatch(/set\s+confirmed_at\s*=/);
  });

  it('obtiene el JWT por contraseña, que es la vía que usa la app', () => {
    expect(BOUNDARY_CHECK).toContain('grant_type=password');
  });

  it('NO desactiva las confirmaciones para que el test pase', () => {
    expect(BOUNDARY_CHECK).not.toMatch(/enable_confirmations\s*=\s*false/);
    expect(BOUNDARY_CHECK).not.toMatch(/GOTRUE_MAILER_AUTOCONFIRM/i);
  });

  it('no mete claves secretas: la publicable se sigue leyendo del Kong vivo', () => {
    expect(BOUNDARY_CHECK).not.toMatch(/sb_secret_[A-Za-z0-9_-]{8,}/);
    expect(BOUNDARY_CHECK).not.toMatch(/service_role/);
    expect(BOUNDARY_CHECK).toContain("grep -o 'sb_publishable_");
  });
});

describe('CI arranca el servicio de correo que la confirmación obligatoria necesita', () => {
  /**
   * El fallo que esto evita, y que ya ocurrió una vez.
   *
   * El workflow arranca un Supabase reducido con `-x` y excluía el servicio de
   * correo. Con confirmación obligatoria eso no es una optimización: **GoTrue
   * envía el correo durante el propio alta**, y sin destino responde
   * `500 unexpected_failure: Error sending confirmation email` sin llegar a
   * crear al usuario. Confirmar después por SQL no ayuda — el alta ya falló.
   *
   * Es sutil precisamente porque el check NO lee el buzón. Es fácil concluir
   * que el correo no hace falta, excluirlo, y romper CI con un error que no
   * menciona la lista de exclusión por ningún sitio.
   *
   * `[auth.email.smtp]` está comentado entero, así que `[local_smtp]` es el
   * único destino que GoTrue tiene.
   */
  const exclusions = WORKFLOW.match(/-x\s+([a-z0-9,-]+)/i)?.[1].split(',') ?? [];

  it('el workflow sigue arrancando un stack reducido con `-x`', () => {
    // Si esto deja de encontrarse, la aserción de abajo pasaría sin mirar nada.
    expect(exclusions.length).toBeGreaterThan(3);
  });

  it('y NO excluye el servicio de correo', () => {
    expect(exclusions).not.toContain('mailpit');
    expect(exclusions).not.toContain('inbucket');
  });

  it('tampoco excluye lo que el boundary check necesita de verdad', () => {
    // GoTrue emite el JWT, Kong es la puerta, PostgREST la superficie `api` y
    // la base lo sostiene todo. Ninguno es opcional para este check.
    for (const required of ['auth', 'gotrue', 'kong', 'rest', 'db']) {
      expect(exclusions).not.toContain(required);
    }
  });

  it('el único destino de correo configurado sigue siendo el local', () => {
    expect(CONFIG).toMatch(/^#\s*\[auth\.email\.smtp\]/m);
  });
});
