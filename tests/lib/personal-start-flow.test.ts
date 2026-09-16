import { describe, expect, it } from 'vitest';

import {
  type PersonalScopeState,
  personalStartAction,
  scopeFromResult,
} from '../../src/features/personal/personal-scope';
import { personalStartStep } from '../../src/features/personal/personal-start-flow';

/**
 * EL FLUJO DEL PUNTO DE INICIO (F10/ADR-005 §2), por comportamiento.
 *
 * `usePersonalStart` sólo cablea efectos sobre `personalStartStep`; aquí se
 * recorre exactamente lo que el hook haría en cada instante, con lo que el
 * servidor respondió como entrada y con QUIÉN lo leyó (`readAsGuest`). Lo que
 * el comando escribe lo mide `supabase/checks/personal-start.sql`.
 */

const base = {
  scope_id: 'scope-1',
  base_currency_definition_id: 'eur',
  currency_code: 'EUR',
  currency_scale: 2,
  created: false,
  provisioned_as_guest: true,
  start_mode: null,
};

/** Lo que el hook haría con un ámbito leído y una sesión dadas. */
function stepFor(
  scope: PersonalScopeState,
  input: { enabled: boolean; autoSent?: boolean },
): ReturnType<typeof personalStartStep> {
  return personalStartStep({
    enabled: input.enabled,
    stale: scope.status === 'ready' && scope.readAsGuest,
    action: personalStartAction(scope),
    autoSent: input.autoSent ?? false,
  });
}

const readAsGuestWithoutHistory = scopeFromResult({ ...base, needs_start_decision: false }, true);
const readAsGuestWithHistory = scopeFromResult({ ...base, needs_start_decision: true }, true);
const readAsAccountWithoutHistory = scopeFromResult({ ...base, needs_start_decision: false });
const readAsAccountWithHistory = scopeFromResult({ ...base, needs_start_decision: true });

describe('mientras la sesión es un invitado', () => {
  it('1 · invitado sin historia entra en Inicio: NO escribe personal_start', () => {
    // Sin la guarda, «sin historia» se leería como include automático y el
    // invitado quedaría decidido antes de tener cuenta.
    expect(personalStartAction(readAsGuestWithoutHistory)).toBe('autoInclude');
    expect(stepFor(readAsGuestWithoutHistory, { enabled: false })).toBe('wait');
  });

  it('2 · invitado con historia: tampoco escribe ni pregunta todavía', () => {
    expect(personalStartAction(readAsGuestWithHistory)).toBe('ask');
    expect(stepFor(readAsGuestWithHistory, { enabled: false })).toBe('wait');
  });
});

describe('al pasar de invitado a cuenta', () => {
  it('5 · habilitar con la lectura del invitado en la mano NO decide: se espera a la relectura', () => {
    // `enabled` pasa a true, pero el ámbito que se tiene lo leyó el invitado:
    // viejo por definición. Diga lo que diga, nada se envía ni se pregunta.
    expect(stepFor(readAsGuestWithoutHistory, { enabled: true })).toBe('wait');
    expect(stepFor(readAsGuestWithHistory, { enabled: true })).toBe('wait');
    // Y mientras la relectura está en vuelo, tampoco.
    expect(stepFor({ status: 'provisioning' }, { enabled: true })).toBe('none');
  });

  it('3 · con historia, tras la relectura como cuenta: ask', () => {
    expect(stepFor(readAsAccountWithHistory, { enabled: true })).toBe('ask');
  });

  it('4 · sin historia, tras la relectura como cuenta: autoInclude, y se persiste', () => {
    expect(stepFor(readAsAccountWithoutHistory, { enabled: true })).toBe('autoInclude');
  });

  it('7 · la lectura del invitado decía «sin historia» y la de la cuenta dice «con historia»: gana el servidor', () => {
    // Antes de convertir, el invitado leyó needs=false.
    expect(personalStartAction(readAsGuestWithoutHistory)).toBe('autoInclude');
    // Al habilitar, con esa lectura no se envía el include automático.
    expect(stepFor(readAsGuestWithoutHistory, { enabled: true })).toBe('wait');
    // La relectura como cuenta trae needs=true: la pantalla.
    expect(stepFor(readAsAccountWithHistory, { enabled: true })).toBe('ask');
  });
});

describe('sin dobles comandos', () => {
  it('6 · el include automático sale una vez: un render o un reintento con el mismo estado no lo repite', () => {
    expect(stepFor(readAsAccountWithoutHistory, { enabled: true, autoSent: false })).toBe(
      'autoInclude',
    );
    expect(stepFor(readAsAccountWithoutHistory, { enabled: true, autoSent: true })).toBe('wait');
  });

  it('una cuenta normal, o una ya decidida, no hace nada', () => {
    const normal = scopeFromResult({
      ...base,
      provisioned_as_guest: false,
      needs_start_decision: false,
    });
    const decided = scopeFromResult({ ...base, start_mode: 'fresh', needs_start_decision: false });
    expect(stepFor(normal, { enabled: true })).toBe('none');
    expect(stepFor(decided, { enabled: true })).toBe('none');
  });
});
