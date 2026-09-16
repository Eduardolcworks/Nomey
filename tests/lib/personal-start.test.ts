import { describe, expect, it } from 'vitest';

import {
  IDLE,
  parseScope,
  personalStartAction,
  scopeFromResult,
  serializeScope,
} from '../../src/features/personal/personal-scope';

/**
 * EL PUNTO DE INICIO DEL MODO PERSONAL (F10/ADR-005), la mitad pura.
 *
 * Qué toca hacer en Inicio se decide en `personalStartAction` sobre lo que el
 * servidor respondió en `ensure_personal_scope`; aquí se interroga por
 * comportamiento. Lo que el comando escribe y valida —la marca, la decisión
 * insert-only, el corte— lo mide `supabase/checks/personal-start.sql` y la
 * frontera HTTP §15; esto no lo reproduce.
 */

const base = {
  scope_id: 'scope-1',
  base_currency_definition_id: 'eur',
  currency_code: 'EUR',
  currency_scale: 2,
  created: false,
};

describe('qué toca hacer con el punto de inicio', () => {
  it('una cuenta normal no tiene nada que decidir', () => {
    const state = scopeFromResult({
      ...base,
      provisioned_as_guest: false,
      start_mode: null,
      needs_start_decision: false,
    });
    expect(personalStartAction(state)).toBe('none');
  });

  it('nacida como invitado, con historia y sin decisión: se pregunta', () => {
    const state = scopeFromResult({
      ...base,
      provisioned_as_guest: true,
      start_mode: null,
      needs_start_decision: true,
    });
    expect(personalStartAction(state)).toBe('ask');
  });

  it('nacida como invitado, SIN historia y sin decisión: include automático, persistido', () => {
    // Es lo que cierra el agujero de lifecycle: la pregunta no puede aparecer
    // días después, cuando llegue la primera actividad de grupo.
    const state = scopeFromResult({
      ...base,
      provisioned_as_guest: true,
      start_mode: null,
      needs_start_decision: false,
    });
    expect(personalStartAction(state)).toBe('autoInclude');
  });

  it('ya decidido —include o fresh— nunca vuelve a preguntar ni a escribir', () => {
    for (const mode of ['include', 'fresh']) {
      const state = scopeFromResult({
        ...base,
        provisioned_as_guest: true,
        start_mode: mode,
        // Aunque el servidor dijera lo contrario, el modo manda: la fila existe.
        needs_start_decision: true,
      });
      expect(personalStartAction(state), mode).toBe('none');
    }
  });

  it('sin marca de invitado no se pregunta aunque haya historia', () => {
    const state = scopeFromResult({
      ...base,
      provisioned_as_guest: false,
      start_mode: null,
      needs_start_decision: true,
    });
    expect(personalStartAction(state)).toBe('none');
  });

  it('un servidor que no publique los tres campos deja todo como estaba', () => {
    const state = scopeFromResult(base);
    expect(state.status === 'ready' && state.start).toBeNull();
    expect(personalStartAction(state)).toBe('none');
  });

  it('mientras el ámbito no está listo no hay nada que decidir', () => {
    expect(personalStartAction(IDLE)).toBe('none');
    expect(personalStartAction({ status: 'provisioning' })).toBe('none');
    expect(personalStartAction({ status: 'unavailable' })).toBe('none');
  });

  it('un modo desconocido se lee como «sin decisión»: el servidor decide', () => {
    const state = scopeFromResult({
      ...base,
      provisioned_as_guest: true,
      start_mode: 'reset',
      needs_start_decision: true,
    });
    expect(state.status === 'ready' && state.start?.mode).toBeNull();
    expect(personalStartAction(state)).toBe('ask');
  });
});

describe('el respaldo local no decide nada', () => {
  it('lo guardado no lleva el punto de inicio, y al recordarlo no hay nada que decidir', () => {
    // Sin red no se pregunta ni se escribe: la autoridad es el servidor,
    // cada vez (F10/ADR-005 §2).
    const ready = scopeFromResult({
      ...base,
      provisioned_as_guest: true,
      start_mode: null,
      needs_start_decision: true,
    });
    if (ready.status !== 'ready') throw new Error('unreachable');
    const document = serializeScope(ready);
    expect(document).not.toContain('start');
    const recalled = parseScope(document);
    expect(recalled?.start).toBeNull();
    expect(personalStartAction(recalled ?? IDLE)).toBe('none');
  });
});
