import { describe, expect, it } from 'vitest';

import SCREEN from '../../src/app/group/[id].tsx?raw';
import SHEET from '../../src/features/groups/group-action-sheet.tsx?raw';
import ARRIVAL from '../../src/features/groups/invitation-arrival.ts?raw';
import HOOKS from '../../src/features/groups/use-membership.ts?raw';
import SERVICE from '../../src/features/groups/membership-service.ts?raw';
import PARTICIPANTS from '../../src/features/groups/participant-service.ts?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import CI from '../../.github/workflows/ci.yml?raw';
import CHECK from '../../supabase/checks/unclaim-evidence.sql?raw';
import GUARD from '../../supabase/checks/group-identity-lock.sql?raw';
import RACE from '../../scripts/unclaim-race-evidence.sh?raw';
import MIGRATION from '../../supabase/migrations/20260912160000_unclaim_participant.sql?raw';

/**
 * RECTIFICAR UNA RECLAMACION (F09/ADR-006). Lo estructural; lo que solo la base
 * demuestra —caja que bloquea, claves, procedencia, historial intacto, acceso
 * perdido, invitacion caducada— lo mide `unclaim-evidence.sql` contra la
 * funcion real, y las ocho carreras `scripts/unclaim-race-evidence.sh`.
 */

const sql = (text: string) => text.replace(/--.*$/gm, '');
const before = (body: string, a: string, b: string, label = `${a} < ${b}`) => {
  const ia = body.indexOf(a);
  const ib = body.indexOf(b);
  expect(ia, a).toBeGreaterThan(-1);
  expect(ib, b).toBeGreaterThan(-1);
  expect(ia, label).toBeLessThan(ib);
};

describe('el servidor', () => {
  it('la procedencia vive en el vinculo, con FK al comando, y solo se rellena si es inequivoca', () => {
    expect(sql(MIGRATION)).toContain('add column claim_command_id uuid;');
    expect(sql(MIGRATION)).toContain(
      'references core.provisioning_command (created_by, client_command_id);',
    );
    expect(sql(MIGRATION)).toMatch(/where c\.n = 1 and c\.created_by = l\.user_id/);
    // Reclamar la escribe; el creador y «Soy nuevo» no llevan comando de reclamacion.
    expect(sql(MIGRATION)).toContain(
      'insert into core.participant_user_link (participant_id, scope_id, user_id, claim_command_id)',
    );
    expect(
      sql(MIGRATION).match(
        /insert into core\.participant_user_link \(participant_id, scope_id, user_id\)/g,
      ),
    ).toHaveLength(1);
  });

  it('rectificar sigue el protocolo de identidad: clave → cerrojo → membresia → vinculo → caja → hecho', () => {
    const body = sql(MIGRATION).slice(
      sql(MIGRATION).indexOf('create function api.unclaim_participant('),
      sql(MIGRATION).indexOf('grant create on schema api to nomey_provisioner;'),
    );
    before(body, 'into core.provisioning_command', 'sec.lock_participant_claims(v_scope)');
    before(body, 'sec.lock_participant_claims(v_scope)', 'sec.is_member(v_scope)');
    before(body, 'sec.is_member(v_scope)', 'from core.participant_user_link');
    before(body, 'from core.participant_user_link', 'sec.unclaim_blocking_operations(v_scope)');
    before(body, 'sec.unclaim_blocking_operations(v_scope)', 'into core.participant_unclaim');
    before(body, 'into core.participant_unclaim', 'delete from core.participant_user_link');
    before(body, 'delete from core.participant_user_link', 'delete from core.membership');
    // Del provisioner, sin filas de ambito; ejecutable por la app.
    expect(body).not.toContain('sec.lock_scopes(');
    expect(sql(MIGRATION)).toContain(
      'alter function api.unclaim_participant(jsonb) owner to nomey_provisioner;',
    );
    expect(sql(MIGRATION)).toContain(
      'grant execute on function api.unclaim_participant(jsonb) to authenticated;',
    );
    for (const code of [
      'CLAIM_SUPERSEDED',
      'UNCLAIM_NOT_AVAILABLE',
      'UNCLAIM_BLOCKED_CASH',
      'NOT_AUTHORIZED',
      'IDEMPOTENCY_KEY_REUSED',
    ]) {
      expect(body).toContain(`'${code}'`);
    }
    // Nada mas se toca: ni presencia, ni efectos, ni versiones, ni aviso.
    expect(body).not.toMatch(
      /participant_period|core\.effect|operation_version|group_notice|group_departure/,
    );
  });

  it('la caja que bloquea es una frontera del provisioner, y el error la describe sin exigir ids', () => {
    expect(sql(MIGRATION)).toContain(
      'returns table (operation_id uuid, operation_class text, concept text, amount text, effective_date date)',
    );
    expect(sql(MIGRATION)).toContain(
      'grant execute on function sec.unclaim_blocking_operations(uuid) to nomey_provisioner;',
    );
    expect(sql(MIGRATION)).toContain("jsonb_build_object('operations', v_blocking)");
    // El importe viaja como texto (F02/ADR-001): nunca como numero JSON.
    expect(sql(MIGRATION)).toContain('ov.original_amount::text');
    // La lectura publica la procedencia PROPIA y solo la propia.
    expect(sql(MIGRATION)).toContain('sec.my_claim_command_id(p.id) as claim_command_id');
    const mine = sql(MIGRATION).slice(
      sql(MIGRATION).indexOf('create function sec.my_claim_command_id('),
    );
    expect(mine.slice(0, mine.indexOf('revoke execute'))).toContain(
      'and l.user_id = sec.request_actor_id()',
    );
  });

  it('el check cubre lo pedido contra la funcion REAL, la guarda incluye rectificar, y CI los ejecuta', () => {
    expect(CHECK).toContain('api.unclaim_participant(jsonb_build_object(');
    expect(CHECK).not.toContain('pg_temp.unlink');
    for (const marker of [
      'A · sin membresia, rectificar responde NOT_AUTHORIZED',
      'D2:',
      'I6b: el execute de unclaim_blocking_operations no es solo del provisioner',
      'I7: el provisioner ve % efectos del grupo',
      'J1: la rectificacion toco historial, efectos o presencia',
      'J8: Ana sigue viendo el grupo',
      'K1b: el reintento toco la reclamacion posterior',
      'K2:',
      'L2: el relleno eligio una de dos reclamaciones',
      'M3: el vinculo volvio',
      'F2:',
    ]) {
      expect(CHECK).toContain(marker);
    }
    expect(CHECK.trim().endsWith('rollback;')).toBe(true);
    expect(GUARD).toContain("('api.unclaim_participant'),");
    expect(GUARD).toContain("('api.record_group_payment')) as t(name)");
    expect(RACE).toContain('select api.unclaim_participant(');
    expect(RACE).not.toContain('raise notice');
    expect(CI).toContain('supabase/checks/unclaim-evidence.sql');
    expect(CI).toContain('bash scripts/unclaim-race-evidence.sh');
  });
});

describe('el cliente', () => {
  it('la lectura trae la procedencia propia; el comando la cita, y los detalles del error se interpretan', () => {
    expect(PARTICIPANTS).toContain('claim_command_id');
    expect(PARTICIPANTS).toContain('claimCommandId: row.claim_command_id ?? null');
    expect(SERVICE).toContain("supabase.rpc('unclaim_participant'");
    expect(SERVICE).toContain('readonly claim_command_id: string;');
    expect(SERVICE).toContain('details: response.error.details ?? null');
    expect(SERVICE).toContain('export function blockingOperations(');
    expect(HOOKS).toContain("if (response.code === 'UNCLAIM_BLOCKED_CASH')");
    expect(HOOKS).toContain(
      "response.code === 'CLAIM_SUPERSEDED' || response.code === 'UNCLAIM_NOT_AVAILABLE'",
    );
    // Al deshacerse, lo mismo que salir: quien mire lista, Deudas o avisos vuelve a preguntar.
    expect(HOOKS).toMatch(
      /if \(response\.ok\) \{\s*key\.current = null;\s*publishGroupRecorded\(args\.scopeId\);\s*return \{ kind: 'done' \}/,
    );
  });

  it('«Me equivoqué» solo en la fila propia con procedencia; confirma antes; explica el bloqueo sin identificadores', () => {
    expect(SCREEN).toMatch(
      /balance\.isSelf &&\s*typeof claimOf\.get\(balance\.participantId\) === 'string'/,
    );
    expect(SCREEN).toContain("t('group.unclaimTitle', { name: displayName })");
    expect(SCREEN).toContain("text: t('group.unclaimConfirm')");
    expect(SCREEN).toContain('blockedBody(displayName, outcome.operations)');
    expect(SCREEN).toMatch(/one\.concept \?\? t\('group\.unclaimBlockedTransfer'\)/);
    expect(SCREEN).not.toMatch(/one\.operationId/);
    // Salir del grupo no es el camino: se deshace la reclamacion y se vuelve a la invitacion.
    expect(SCREEN).toContain('leaveAfterUnclaim(displayName)');
    expect(SCREEN).toContain("const token = redeemedInvitation(id ?? '');");
    expect(SCREEN).toMatch(
      /router\.back\(\);\s*\/\/[^\n]*\n\s*if \(token !== null\) arriveInvitation\(token\);/,
    );
    expect(SCREEN).not.toContain('leaving.leave(');
    // «¿Eres [nombre]?» sigue delante de reclamar.
    expect(ES).toContain("'groups.claimAskTitle'");
    expect(ES).toContain(
      "'group.unclaimBlockedBody': 'Hay dinero registrado en tu Personal como {name} en este grupo.'",
    );
  });

  it('la invitacion con la que se entro se recuerda en memoria, por grupo, y nunca en disco', () => {
    expect(ARRIVAL).toContain('const redeemed = new Map<string, string>();');
    expect(ARRIVAL).not.toMatch(/AsyncStorage|SecureStore|catalogue_cache/);
    expect(SHEET).toContain('rememberRedeemedInvitation(scopeId, token);');
    expect(SHEET).toContain(
      'rememberRedeemedInvitation(preview.scopeId, invitation.status.token);',
    );
  });
});
