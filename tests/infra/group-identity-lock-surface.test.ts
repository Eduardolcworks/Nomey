import { describe, expect, it } from 'vitest';

import CI from '../../.github/workflows/ci.yml?raw';
import RACE from '../../scripts/unclaim-race-evidence.sh?raw';
import GUARD from '../../supabase/checks/group-identity-lock.sql?raw';
import MIGRATION from '../../supabase/migrations/20260912150000_group_identity_lock.sql?raw';

/**
 * EL CERROJO DE IDENTIDAD DEL GRUPO. Lo estructural del repositorio; el orden
 * de las funciones VIVAS lo mide `group-identity-lock.sql` contra el catalogo y
 * las carreras, con dos sesiones reales, `scripts/unclaim-race-evidence.sh`.
 */

const sql = (text: string) => text.replace(/--.*$/gm, '');

const bodyOf = (name: string) => {
  const src = sql(MIGRATION);
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION api.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = src.indexOf('$function$;', start);
  return src.slice(start, end);
};

describe('la migracion', () => {
  it('recrea con create or replace las seis funciones del protocolo, sin cambiar propietarios', () => {
    for (const fn of [
      'record_group_expense',
      'record_settlement_by_transfer',
      'retire_participant',
      'settle_participant',
      'leave_group',
    ]) {
      const body = bodyOf(fn);
      expect(body, fn).toContain('perform sec.lock_participant_claims(v_scope);');
    }
    // Reclamar ya lo tomaba (20260912140000) y no se recrea: solo cambia el orden de los demas.
    expect(MIGRATION).not.toContain('FUNCTION api.redeem_invitation(');
    expect(MIGRATION).not.toMatch(/alter function .* owner to/);
    expect(sql(MIGRATION)).not.toMatch(/\b(grant|revoke)\b/);
  });

  it('el cerrojo va despues de la clave y antes de la identidad, las filas y el CAS', () => {
    const before = (body: string, a: string, b: string) => {
      const ia = body.indexOf(a);
      const ib = body.indexOf(b);
      expect(ia, a).toBeGreaterThan(-1);
      if (ib > -1) expect(ia, `${a} < ${b}`).toBeLessThan(ib);
    };
    for (const fn of ['record_group_expense', 'record_settlement_by_transfer']) {
      const body = bodyOf(fn);
      before(body, 'sec.begin_command(', 'sec.lock_participant_claims(');
      before(body, 'sec.lock_participant_claims(', 'sec.assert_member(');
      before(body, 'sec.lock_participant_claims(', 'sec.participant_personal_scope(');
      before(body, 'sec.lock_participant_claims(', 'sec.lock_scopes(');
      before(body, 'sec.lock_scopes(', 'sec.lock_and_cas(');
    }
    for (const fn of ['retire_participant', 'settle_participant']) {
      const body = bodyOf(fn);
      before(body, 'sec.lock_participant_claims(', 'sec.assert_member(');
      before(body, 'sec.lock_participant_claims(', 'sec.lock_scopes(');
      before(body, 'sec.lock_scopes(', 'from core.participant_retirement');
    }
    const leave = bodyOf('leave_group');
    before(leave, 'into core.provisioning_command', 'sec.lock_participant_claims(');
    before(leave, 'sec.lock_participant_claims(', 'sec.is_member(');
    // Salir sigue sin tomar filas de ambito: es del provisioner (E6).
    expect(leave).not.toContain('sec.lock_scopes(');
  });
});

describe('la evidencia', () => {
  it('la guarda de catalogo vigila a TODO resolutor de Personal por vinculo, y CI la ejecuta', () => {
    expect(GUARD).toContain("where body like '%sec.participant_personal_scope(%'");
    expect(GUARD).toContain("'sec.begin_command(',     'sec.lock_participant_claims('");
    expect(GUARD).toContain("raise exception 'F: % toma filas de ambito como provisioner'");
    expect(GUARD.trim().endsWith('rollback;')).toBe(true);
    expect(CI).toContain('supabase/checks/group-identity-lock.sql');
  });

  it('las ocho carreras, en las dos direcciones, con la espera medida, y CI las ejecuta', () => {
    for (const marker of [
      '1a · reclamar (retiene 3 s) → gasto con Ana pagadora',
      '1b · gasto con Ana pagadora (retiene 3 s; Ana sin cuenta al resolver) → reclamar',
      '2a · rectificar (retiene 3 s) → gasto con Ana pagadora',
      '2b · gasto con Ana pagadora (retiene 3 s) → rectificar',
      '3a · rectificar (retiene 3 s) → transferencia de Ana a Edu',
      '3b · transferencia de Ana (retiene 3 s) → rectificar',
      '4a · rectificar (retiene 3 s) → salir Ana',
      '4b · salir Ana (retiene 3 s) → rectificar',
      'select api.unclaim_participant(',
      "grep -q 'UNLINK_BLOCKED_ATTRIBUTION'",
      'ESPERA=',
      'exigir_base_local',
    ]) {
      expect(RACE).toContain(marker);
    }
    // La rectificacion es la funcion REAL (wrapper de F10/ADR-001 §11 desde 20260916120000), como la cuenta que reclamo.
    expect(RACE).not.toContain('raise notice');
    expect(CI).toContain('bash scripts/unclaim-race-evidence.sh');
  });
});
