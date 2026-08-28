import { describe, expect, it, vi } from 'vitest';

import SERVICE_RAW from '../../src/features/auth/auth-service.ts?raw';
import CONTROLLER_RAW from '../../src/features/auth/recovery-controller.tsx?raw';
import CLIENT_RAW from '../../src/lib/supabase/recovery-client.ts?raw';
import HOOK_RAW from '../../src/features/auth/use-recovery-link.ts?raw';
import ARRIVAL_RAW from '../../src/features/auth/recovery-arrival.ts?raw';
import SUBMIT_RAW from '../../src/features/auth/use-auth-submit.ts?raw';
import LAYOUT from '../../src/app/_layout.tsx?raw';
import { createExclusiveRunner, SKIPPED } from '../../src/features/auth/submit-guard';
import { readRecoveryLink } from '../../src/features/auth/recovery-link';
import { isRecoveryActive, RECOVERY_IDLE } from '../../src/features/auth/recovery-state';
import { isPublic, isSignedIn, stateFromUser } from '../../src/features/session/session-state';

/**
 * Que la recuperación no toque el acceso ordinario.
 *
 * Se escribe después de una alarma real: en iPhone, Entrar se quedaba en «Un
 * momento…» para siempre. **No era el código** —Kong había muerto con un cierre
 * sucio de Docker y la app, que por deuda conocida no pone timeout propio a las
 * operaciones de auth, esperaba una respuesta que no iba a llegar—. Pero el
 * susto señala algo que sí merece quedar fijado: el cliente efímero de recovery
 * comparte proyecto, entorno y librería con el principal, y **nada de eso puede
 * traducirse en que un login ordinario dependa de él**.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const SERVICE = stripComments(SERVICE_RAW);
const CONTROLLER = stripComments(CONTROLLER_RAW);
const CLIENT = stripComments(CLIENT_RAW);
const HOOK = stripComments(HOOK_RAW);
const SUBMIT = stripComments(SUBMIT_RAW);
const ARRIVAL = stripComments(ARRIVAL_RAW);

describe('el login ordinario usa SOLO el cliente principal', () => {
  it('`signIn` llama al cliente principal y a ningún otro', () => {
    const signIn = SERVICE.slice(
      SERVICE.indexOf('export async function signIn('),
      SERVICE.indexOf('export async function signOut('),
    );
    expect(signIn).toContain('supabase.auth.signInWithPassword');
    expect(signIn).not.toContain('recoveryClient');
  });

  it('y lo mismo el alta y el cierre de sesión', () => {
    for (const name of ['signUp', 'signOut', 'forgetLocalSession', 'updateDisplayName']) {
      const start = SERVICE.indexOf(`export async function ${name}(`);
      const body = SERVICE.slice(start, start + 900);
      expect(body).not.toContain('recoveryClient');
    }
  });

  it('el cliente efímero sólo lo tocan las dos funciones de recovery', () => {
    // Se trocea el fichero por función y se mira dentro de cada una, en vez de
    // barrer con una regex que cruzaría de una a la siguiente.
    const names = [...SERVICE.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    const users = names.filter((name) => {
      const start = SERVICE.indexOf(`export async function ${name}(`);
      const nextAt = names
        .map((other) => SERVICE.indexOf(`export async function ${other}(`))
        .filter((at) => at > start);
      const end = nextAt.length > 0 ? Math.min(...nextAt) : SERVICE.length;
      return SERVICE.slice(start, end).includes('recoveryClient');
    });
    expect(users.sort()).toEqual(['completeRecovery', 'redeemRecovery']);
  });
});

describe('el cliente efímero no existe hasta que hace falta', () => {
  it('no se crea al importar el módulo', () => {
    /*
     * Si se construyera en el scope del módulo, importar `lib/supabase` -que
     * hace cualquier pantalla- levantaría un segundo cliente de auth en cada
     * arranque, para la inmensa mayoría de sesiones que nunca recuperan nada.
     */
    expect(CLIENT).toContain('client ??= createRecoveryClient()');
    expect(CLIENT).not.toMatch(/^const client = createRecoveryClient\(\)/m);
    expect(CLIENT).not.toMatch(/^export const recoveryClient = createClient/m);
  });

  it('y se descarta al terminar', () => {
    expect(CLIENT).toContain('export function disposeRecoveryClient');
    expect(CONTROLLER).toContain('disposeRecoveryClient()');
  });
});

describe('el RecoveryProvider no intercepta ni bloquea nada', () => {
  it('no hace trabajo al montar', () => {
    // Sin efectos ni trabajo asíncrono al montar no hay nada que pueda quedar
    // pendiente delante de un login.
    expect(CONTROLLER).not.toContain('useEffect');
  });

  it('no se suscribe a eventos de auth', () => {
    // El provider principal es el único suscriptor, y sigue siéndolo.
    expect(CONTROLLER).not.toContain('onAuthStateChange');
    expect(CLIENT).not.toContain('onAuthStateChange');
  });

  it('no toca el cliente principal', () => {
    // `supabase.auth.…` es la puerta del cliente principal. Importar un helper
    // desde `@/lib/supabase` no lo es, y por eso se mira la llamada y no la
    // ruta del import.
    expect(CONTROLLER).not.toContain('supabase.auth');
    expect(HOOK).not.toContain('supabase.auth');
  });

  it('y el enlace ignora en silencio cualquier URL que no sea de recovery', () => {
    // La URL que Expo Go entrega al arrancar no es un recovery. Debe salir por
    // el camino corto y no disparar nada.
    expect(readRecoveryLink('exp://192.168.8.110:8081')).toBeNull();
    expect(readRecoveryLink('exp://192.168.8.110:8081/--/')).toBeNull();
    expect(readRecoveryLink('nomey-dev://')).toBeNull();
    // La salida corta vive con la decisión, en el módulo de llegada.
    expect(ARRIVAL).toContain('if (proof === null) return');
  });
});

describe('sin recovery en curso, las guardas son las de siempre', () => {
  it('en reposo el recovery no está activo', () => {
    expect(isRecoveryActive(RECOVERY_IDLE)).toBe(false);
  });

  it('así que la rama de producto depende sólo de la sesión', () => {
    // `!recovering` es `true` en reposo: la condición añadida no puede tapar
    // la rama privada de un login normal.
    expect(LAYOUT).toContain('isSignedIn(state) && !recovering');
    expect(LAYOUT).toContain('isPublic(state) && !recovering');
  });

  it('un SIGNED_IN ordinario sigue resolviendo a `signed-in`', () => {
    const state = stateFromUser({ id: 'alice', email: 'alice@example.com' });
    expect(isSignedIn(state)).toBe(true);
    expect(isPublic(state)).toBe(false);
  });
});

describe('el envío se libera pase lo que pase', () => {
  it('tras un éxito', async () => {
    const run = createExclusiveRunner();
    expect(await run(async () => ({ ok: true }) as const)).toEqual({ ok: true });
    // Y el siguiente envío puede correr: el guardián no quedó cerrado.
    expect(await run(async () => ({ ok: true }) as const)).toEqual({ ok: true });
  });

  it('tras un error devuelto', async () => {
    const run = createExclusiveRunner();
    await run(async () => ({ ok: false }) as const);
    expect(await run(async () => ({ ok: true }) as const)).toEqual({ ok: true });
  });

  it('y tras una excepción, que es el caso que dejaría el spinner puesto', async () => {
    const run = createExclusiveRunner();
    await expect(run(async () => Promise.reject(new Error('sin red')))).rejects.toThrow('sin red');
    // `finally` en el runner: un fallo no traba el formulario.
    expect(await run(async () => ({ ok: true }) as const)).toEqual({ ok: true });
  });

  it('el hook sale de `running` en las dos ramas, no sólo en la buena', () => {
    /*
     * El fallo que dejaría «Un momento…» puesto para siempre: un `setState`
     * que sólo ocurriera en el camino de éxito. Aquí es incondicional después
     * del guardián, con el ternario decidiendo a QUÉ estado va, no SI va.
     */
    expect(SUBMIT).toMatch(/setState\(\s*result\.ok \?/);
    expect(SUBMIT).toContain('if (result === SKIPPED) return undefined');
  });

  it('un segundo toque no arranca una segunda operación', async () => {
    const run = createExclusiveRunner();
    const slow = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true } as const;
    });

    const first = run(slow);
    expect(await run(slow)).toBe(SKIPPED);
    await first;
    expect(slow).toHaveBeenCalledTimes(1);
  });
});
