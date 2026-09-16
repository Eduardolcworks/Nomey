import { describe, expect, it } from 'vitest';

import MIGRATION from '../../supabase/migrations/20260919120000_personal_start.sql?raw';
import CHECK from '../../supabase/checks/personal-start.sql?raw';
import RACE from '../../scripts/personal-start-race-evidence.sh?raw';
import HTTP from '../../scripts/http-boundary-check.sh?raw';
import CI from '../../.github/workflows/ci.yml?raw';
import ADR from '../../docs/adr/F10/ADR-005-personal-start.md?raw';
import HOME from '../../src/app/(tabs)/index.tsx?raw';
import SCREEN from '../../src/features/personal/personal-start.tsx?raw';
import PRESSABLE from '../../src/ui/components/glass-pressable.tsx?raw';
import HOOK from '../../src/features/personal/use-personal-start.ts?raw';
import SCOPE_HOOK from '../../src/features/personal/use-personal-scope.ts?raw';
import SERVICE from '../../src/features/personal/personal-service.ts?raw';
import SCOPE from '../../src/features/personal/personal-scope.ts?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import EN from '../../src/lib/i18n/messages/en.ts?raw';

/**
 * EL PUNTO DE INICIO DEL MODO PERSONAL TRAS EL INVITADO (F10/ADR-005): lo
 * estructural. Lo económico —el corte en el saldo, el historial, las
 * estadísticas y las cuotas; la deuda intacta; derive_balance = vista; lo
 * posterior dentro; lo anterior editado fuera; la caja incorporada fuera— lo
 * miden `personal-start.sql`, la frontera HTTP §15 y la carrera de dos
 * sesiones. Aquí se vigila que existan, que CI los ejecute y que el cliente
 * esté cableado como el ADR dice.
 */

const sql = (text: string) => text.replace(/--.*$/gm, '');

describe('el servidor', () => {
  it('la marca nace del claim del JWT al crear el ámbito, y nunca se pone a false', () => {
    expect(MIGRATION).toContain('add column provisioned_as_guest boolean not null default false');
    expect(sql(MIGRATION)).toContain("::jsonb ->> 'is_anonymous')::boolean, false)");
    expect(sql(MIGRATION)).not.toMatch(/set provisioned_as_guest\s*=\s*false/);
  });

  it('la decisión es un hecho por ámbito, insert-only, con un solo escritor del provisioner', () => {
    expect(sql(MIGRATION)).toContain('create table core.personal_start');
    expect(sql(MIGRATION)).toContain("check (mode in ('include', 'fresh'))");
    expect(sql(MIGRATION)).toContain('grant insert on core.personal_start to nomey_provisioner');
    expect(sql(MIGRATION)).not.toMatch(/grant (update|delete)[^;]*on core\.personal_start/);
    expect(sql(MIGRATION)).toContain(
      'alter function api.start_personal_scope(jsonb) owner to nomey_provisioner',
    );
    // Bajo el cerrojo del ámbito, el mismo que toma el writer para la caja.
    expect(sql(MIGRATION)).toContain('perform sec.lock_scopes(array[v_scope])');
  });

  it('el corte es por operación y hora de servidor, nunca por effective_date ni por versión', () => {
    expect(sql(MIGRATION)).toContain(
      'create function sec.counts_in_personal(p_scope uuid, p_operation uuid)',
    );
    expect(sql(MIGRATION)).toContain('else o.created_at >= ps.started_at');
    const predicate = sql(MIGRATION).slice(
      sql(MIGRATION).indexOf('create function sec.counts_in_personal('),
      sql(MIGRATION).indexOf('create function api.start_personal_scope('),
    );
    expect(predicate).not.toContain('effective_date');
    expect(predicate).not.toContain('ov.created_at');
  });

  it('el predicado va en la cifra del writer y en TODAS las lecturas del Personal; no en la atribución', () => {
    for (const marker of [
      'create or replace function sec.derive_balance(p_scope uuid, p_exclude_version uuid)',
      'create or replace view api.personal_balance',
      'create or replace view api.personal_effect',
      'create or replace view api.personal_operation',
      'create or replace function sec.my_shared_expense_shares(',
    ]) {
      expect(sql(MIGRATION)).toContain(marker);
    }
    expect(
      (sql(MIGRATION).match(/sec\.counts_in_personal\(/g) ?? []).length,
    ).toBeGreaterThanOrEqual(6);
    expect(sql(MIGRATION)).not.toContain('claimed_dimension');
    expect(sql(MIGRATION)).not.toContain('group_summary');
    expect(sql(MIGRATION)).not.toContain('group_pending_pair');
  });

  it('los códigos de frontera: decidido, decisión requerida, no aplicable', () => {
    for (const code of [
      'PERSONAL_START_DECIDED',
      'PERSONAL_START_DECISION_REQUIRED',
      'PERSONAL_START_NOT_APPLICABLE',
      'PERSONAL_SCOPE_MISSING',
      'IDEMPOTENCY_KEY_REUSED',
    ]) {
      expect(sql(MIGRATION)).toContain(`'${code}'`);
    }
  });

  it('el check cubre lo pedido, y CI lo ejecuta junto con la carrera', () => {
    for (const marker of [
      // primer acceso sin historia → include automático persistido
      'G1: el include automatico fallo',
      'G2: no quedo marcado como automatico',
      // actividad de grupos posterior NO reabre el onboarding
      'G5: la actividad posterior reabrio la pregunta',
      // primer acceso con historia → sí pregunta
      'B3: con historia y sin decision, la cuenta convertida deberia pedir la decision',
      // fresh + asociación posterior de historia pre-corte → sigue fuera
      'F2: la historia anterior de Ana reaparecio en el Personal por asociarla despues del corte',
      'F4: counts_in_personal deja pasar E0',
      // fresh + operaciones nuevas → entran
      'E1b: el pago posterior no entro como debe',
      'E2b: el gasto posterior no entro entero',
      // deuda pre-corte visible pero no en el saldo inicial
      'D2: la historia anterior sigue en el Personal',
      'D3: la deuda pendiente cambio o no es la esperada',
      // mismo derive_balance que personal_balance
      'D5: el writer y la vista no ven la misma cifra',
      'E5b: tras el ajuste',
      'A9: sec.derive_balance no aplica el predicado',
      // lo anterior editado o anulado sigue fuera
      'E3b: corregir una operacion anterior la resucito',
      'E4b: anular una operacion anterior toco el Personal',
      // effective_date no manda
      'E6b: un gasto posterior fechado antes del corte quedo fuera',
      // la atribución no cambia
      'D4: claimed_dimension cambio con el corte',
    ]) {
      expect(CHECK).toContain(marker);
    }
    expect(CHECK.trim().endsWith('rollback;')).toBe(true);
    expect(CI).toContain('supabase/checks/personal-start.sql');
    expect(CI).toContain('bash scripts/personal-start-race-evidence.sh');
    expect(RACE).toContain('PERSONAL_START_DECIDED');
    expect(RACE).toContain('exigir_base_local');
    expect(RACE).toContain('sec.derive_balance');
    expect(HTTP).toContain(
      '== 15 · el punto de inicio del Modo Personal tras el Invitado (F10/ADR-005) ==',
    );
    expect(HTTP).toContain('delete from core.personal_start where scope_id in (${MIOS});');
  });
});

describe('el cliente', () => {
  it('la pantalla dice exactamente lo acordado, en los dos idiomas, y nunca «migrar»', () => {
    for (const [name, catalogue] of [
      ['es-ES', ES],
      ['en', EN],
    ] as const) {
      for (const key of [
        'personalStart.title',
        'personalStart.body',
        'personalStart.includeTitle',
        'personalStart.includeBody',
        'personalStart.freshTitle',
        'personalStart.freshBody',
        'personalStart.continue',
        'personalStart.failed',
      ]) {
        expect(catalogue, `${name} ${key}`).toContain(`'${key}'`);
      }
    }
    expect(ES).toContain("'personalStart.title': '¿Cómo quieres empezar tu Modo Personal?'");
    expect(ES).toContain(
      'Ya tienes movimientos de tus grupos. Puedes incluirlos en tu Modo Personal o empezar desde cero. Tus deudas pendientes seguirán disponibles en ambos casos.',
    );
    expect(ES).toContain("'personalStart.includeTitle': 'Incluir mis movimientos de grupos'");
    expect(ES).toContain("'personalStart.freshTitle': 'Empezar desde cero'");
    expect(ES).toContain("'personalStart.continue': 'Continuar'");
    const personalStartBlock = ES.slice(
      ES.indexOf("'personalStart.title'"),
      ES.indexOf("'personalStart.failed'"),
    );
    expect(personalStartBlock.toLowerCase()).not.toContain('migra');
    // Ninguna cadena del componente (los comentarios explican la prohibición y no cuentan).
    const screenCode = SCREEN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(screenCode.toLowerCase()).not.toContain('migra');
  });

  it('dos opciones excluyentes y «Continuar» apagado hasta elegir; el amarillo de la app', () => {
    expect(SCREEN).toContain('accessibilityRole="radiogroup"');
    expect(SCREEN).toContain('selected={choice === option.mode}');
    // La elegida lleva el borde amarillo del token `accent` (glass-pressable-style),
    // y sólo ella; el estado accesible sigue saliendo de `selected`, no del color.
    expect(SCREEN).toContain("edge={choice === option.mode ? 'accent' : undefined}");
    expect(PRESSABLE).toContain('glassEdgeStyle(edge, theme.accent)');
    expect(PRESSABLE).toContain('accessibilityState={{ disabled, busy, selected }}');
    expect(SCREEN).not.toMatch(/borderColor|borderWidth|#F[0-9A-F]{5}/);
    expect(SCREEN).toContain('tone="brand"');
    expect(SCREEN).toContain('disabled={busy || (!failed && choice === null)}');
    expect(SCREEN).not.toMatch(/useState<[^>]*>\('include'\)|useState<[^>]*>\('fresh'\)/);
  });

  it('la elección viaja al servidor con su clave, y «ya decidido» es un hecho releído, no un booleano local', () => {
    expect(SERVICE).toContain("supabase.rpc('start_personal_scope'");
    expect(HOOK).toContain('newClientOperationId()');
    // Tras decidir —o al saber que otro decidió, o que hay que preguntar— se relee el ámbito.
    expect(HOOK).toContain("result.code === 'PERSONAL_START_DECIDED'");
    expect(HOOK).toContain("result.code === 'PERSONAL_START_DECISION_REQUIRED'");
    expect(HOOK).toContain('refresh();');
    expect(HOOK).not.toMatch(/AsyncStorage|localStorage|cache\.write|remember/);
    expect(SCOPE).toContain("return needsDecision ? 'ask' : 'autoInclude';");
    // El respaldo local no guarda el punto de inicio.
    expect(SCOPE).toContain('start: null,');
    expect(SCOPE).not.toMatch(/start:\s*scope\.start/);
  });

  it('el include automático se envía UNA vez, con `automatic: true`, y el servidor manda', () => {
    // El efecto pregunta al flujo puro CON el ref (sólo los efectos lo leen), y marca antes de enviar.
    expect(HOOK).toMatch(
      /if \(\s*personalStartStep\(\{ enabled, stale, action, autoSent: autoSent\.current \}\) !== 'autoInclude'\s*\)/,
    );
    expect(HOOK).toContain('autoSent.current = true;');
    expect(HOOK).toContain("void runRef.current('include', true);");
    expect(HOOK).toContain('automatic: true as const');
    // La única puerta de envío es `run`, y el flujo puro decide cuándo.
    expect(HOOK.match(/startPersonalScope\(/g) ?? []).toHaveLength(1);
    // Sin `setState` síncrono en efectos ni refs leídos en render (la regla de `usePersonalScope`).
    expect(HOOK).toContain('personalStartStep({ enabled, stale, action, autoSent: false })');
  });

  it('un invitado no decide, y al convertirse se relee el ámbito antes de evaluar', () => {
    expect(HOOK).toContain('enabled: boolean,');
    // Lo leído siendo invitado es viejo: se espera a la lectura de la cuenta.
    expect(HOOK).toContain("const stale = scope.status === 'ready' && scope.readAsGuest;");
    expect(SCOPE).toContain('readonly readAsGuest: boolean;');
    // Y quien relee es `usePersonalScope`, cuya lectura va por identidad de sesión.
    expect(SCOPE_HOOK).toContain('readAsGuest = false,');
    expect(SCOPE_HOOK).toContain('}, [attempt, actorId, readAsGuest]);');
    expect(SCOPE_HOOK).toContain('scopeFromResult(result, readAsGuest)');
    // El respaldo local no pisa una respuesta real al releer.
    expect(SCOPE_HOOK).toContain('answeredFor.current !== actorId && cached !== null');
    // Deshabilitado, el estado que Inicio pinta es «nada».
    expect(HOOK).toMatch(/const state: PersonalStartState = !enabled\s*\?\s*\{ status: 'none' \}/);
    expect(HOME).toContain('usePersonalScope(actorId, guest)');
    expect(HOME).toContain('usePersonalStart(scope.state, scope.retry, !guest)');
  });

  it('Inicio la pinta en lugar del Personal y no lee cifras mientras haya algo que decidir', () => {
    expect(HOME).toContain('const start = usePersonalStart(scope.state, scope.retry, !guest);');
    expect(HOME).toContain("const startPending = start.state.status !== 'none';");
    expect(HOME).toContain(
      'usePersonalHome(ready !== null && personal && !startPending, range, actorId)',
    );
    expect(HOME).toContain("start.state.status === 'ask' || start.state.status === 'failed'");
    expect(HOME).toContain('<PersonalStart');
    // Después de la puerta del invitado y del ámbito, antes del Personal.
    expect(HOME.indexOf('<GuestSignUp')).toBeLessThan(HOME.indexOf('<PersonalStart'));
    expect(HOME.indexOf('<PersonalStart')).toBeLessThan(HOME.indexOf('<BalanceCard'));
  });

  it('el ADR está aceptado y dice lo que el código hace', () => {
    expect(ADR).toContain('**Estado:** Aceptado');
    for (const marker of [
      'core.personal_start',
      'provisioned_as_guest',
      'sec.counts_in_personal',
      'PERSONAL_START_DECISION_REQUIRED',
      'core.operation.created_at',
      'No `effective_date`',
    ]) {
      expect(ADR).toContain(marker);
    }
  });
});
