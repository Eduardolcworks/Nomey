import { describe, expect, it } from 'vitest';

import SCREEN from '../../src/app/group/[id].tsx?raw';
import SHEET from '../../src/features/groups/group-action-sheet.tsx?raw';
import ARRIVAL from '../../src/features/groups/invitation-arrival.ts?raw';
import HOOKS from '../../src/features/groups/use-membership.ts?raw';
import SERVICE from '../../src/features/groups/membership-service.ts?raw';
import PARTICIPANTS from '../../src/features/groups/participant-service.ts?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import CI from '../../.github/workflows/ci.yml?raw';
import CHECK from '../../supabase/checks/unlink-evidence.sql?raw';
import GUARD from '../../supabase/checks/group-identity-lock.sql?raw';
import RACE from '../../scripts/unclaim-race-evidence.sh?raw';
import MIGRATION from '../../supabase/migrations/20260912160000_unclaim_participant.sql?raw';
import UNLINK from '../../supabase/migrations/20260916120000_unlink_participant.sql?raw';

/**
 * RECTIFICAR UNA RECLAMACION (F09/ADR-006), tal como sobrevive a F10/ADR-001:
 * `api.unclaim_participant` es desde 20260916120000 un WRAPPER de
 * compatibilidad sobre `sec.unlink_instance` (§11, §12) — misma firma, misma
 * semantica que dejar cualquier instancia, ninguna segunda implementacion — y
 * el cliente vigente sigue consumiendolo sin cambios hasta F10.A3. Lo que
 * solo la base demuestra lo mide `unlink-evidence.sql` (seccion I) y las ocho
 * carreras de `scripts/unclaim-race-evidence.sh`.
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
  it('la procedencia de F9 sigue en el vinculo, y solo como compatibilidad derivada del origen', () => {
    expect(sql(MIGRATION)).toContain('add column claim_command_id uuid;');
    expect(sql(MIGRATION)).toContain(
      'references core.provisioning_command (created_by, client_command_id);',
    );
    // F10.A2.1 la ato al origen; A2 no la retira: la lectura del cliente vigente la usa.
    expect(sql(UNLINK)).toContain('sec.my_claim_command_id(p.id) as claim_command_id,');
    expect(sql(UNLINK)).not.toMatch(/drop column claim_command_id/);
    expect(sql(UNLINK)).not.toMatch(/drop function sec\.my_claim_command_id/);
  });

  it('el wrapper conserva la firma de F9: claim_command_id es el ORIGEN, client_command_id la clave de la baja, y delega sin handler', () => {
    const src = sql(UNLINK);
    const body = src.slice(
      src.indexOf('create or replace function api.unclaim_participant(payload jsonb)'),
      src.indexOf('CREATE OR REPLACE FUNCTION api.redeem_invitation('),
    );
    expect(body).toContain(
      "'client_command_id', 'command_contract_version', 'scope_id', 'participant_id', 'claim_command_id'];",
    );
    // La clave del cliente ES el comando de la baja (use-membership.ts la conserva entre reintentos).
    expect(body).toMatch(/v_command\s*:=\s*\(payload ->> 'client_command_id'\)::uuid;/);
    expect(body).not.toContain('gen_random_uuid()');
    // Replay por esa clave antes de resolver nada; otra intencion con la misma clave, rehusada.
    before(body, 'and u.client_command_id = v_command;', 'from core.participant_user_link l');
    expect(body).toContain(
      "perform sec.raise_boundary('IDEMPOTENCY_KEY_REUSED', 'esa clave ya se uso con una intencion distinta', 409);",
    );
    // El origen resuelve el vinculo y nada mas: nunca se pasa como comando.
    expect(body).toContain(
      'if v_link.link_id is null or v_link.origin_command_id is distinct from v_claim then',
    );
    expect(body).toContain(
      "and pc.command_type = 'invitation.redeem' and pc.canonical_intent ->> 'choice' = 'claim') then",
    );
    expect(body).toContain(
      'v_out := sec.unlink_instance(v_actor, v_command, v_version, v_scope, v_target, v_link.link_id, true);',
    );
    // Ningun manejador de excepciones: los codigos legados los nombra la implementacion unica.
    expect(body).not.toMatch(/exception when/);
    expect(body).not.toContain('sqlerrm');
    expect(body).not.toContain('UNCLAIM_BLOCKED_CASH');
    expect(body).not.toContain('UNLINK_BLOCKED_ATTRIBUTION');
    expect(body).not.toContain('UNCLAIM_BLOCKED_MERGE');
    // Ninguna segunda implementacion: el wrapper no toma el cerrojo, no evalua, no borra.
    expect(body).not.toContain('sec.lock_participant_claims(');
    expect(body).not.toContain('sec.unlink_blocking_attribution(');
    expect(body).not.toContain('delete from core.participant_user_link');
    expect(body).not.toContain('into core.participant_unlink');
  });

  it('la implementacion unica nombra los dos codigos legados en el punto donde rehusa, con un solo handler (el de la clave)', () => {
    const src = sql(UNLINK);
    const core = src.slice(
      src.indexOf('create function sec.unlink_instance('),
      src.indexOf('create function api.unlink_participant(payload jsonb)'),
    );
    expect(core).toContain('p_scope uuid, p_participant uuid, p_link uuid, p_legacy boolean)');
    expect(core).not.toContain('p_legacy_origin');
    expect(
      core.match(/case when p_legacy then 'CLAIM_SUPERSEDED' else 'LINK_SUPERSEDED' end/g),
    ).toHaveLength(2);
    expect(core).toContain(
      "case when p_legacy then 'UNCLAIM_BLOCKED_CASH' else 'UNLINK_BLOCKED_CASH' end",
    );
    expect(core).not.toMatch(
      /p_legacy then 'UNLINK_BLOCKED_ATTRIBUTION'|UNCLAIM_BLOCKED_ATTRIBUTION/,
    );
    expect(core.match(/exception when/g)).toHaveLength(1);
    expect(core).toContain('exception when unique_violation then');
    // El hecho cita el origen del vinculo y la clave de la baja: dos comandos distintos.
    expect(core).toContain(
      "values (p_link, p_participant, p_scope, p_actor, p_actor, v_link.origin_command_id, 'self', p_command)",
    );
    // Sin colision con el contrato anterior: la migracion afirma que no queda ningun participant.unclaim.
    expect(src).toContain(
      "select count(*) into v_n from core.provisioning_command where command_type = 'participant.unclaim';",
    );
  });

  it('el check mide el wrapper contra la funcion REAL, la guarda vigila la implementacion unica, y CI ejecuta las carreras', () => {
    for (const marker of [
      'I · wrapper legado: clave del cliente, retry sin comando extra, origen ≠ comando de baja',
      "'I0 el origen como clave de baja: '",
      "'I1 origen y comando de baja no apuntan a comandos distintos de tipos distintos'",
      "'I1 la baja reclamo mas de un comando'",
      "'I2 retry: '",
      "'I2 el retry dejo un comando adicional'",
      "'I3 otra intencion, misma clave: '",
      "'I4b clave nueva tras la baja: '",
      "'I5 origen equivocado: '",
      "'I5 «Soy nuevo» por el wrapper: '",
      "if v2 <> 'ERR UNCLAIM_BLOCKED_CASH'",
      "if v2 <> 'ERR UNLINK_BLOCKED_CASH'",
    ]) {
      expect(CHECK, marker).toContain(marker);
    }
    expect(CHECK.trim().endsWith('rollback;')).toBe(true);
    expect(GUARD).toContain("('sec.unlink_instance'),");
    expect(GUARD).not.toContain("('api.unclaim_participant'),");
    expect(RACE).toContain('select api.unclaim_participant(');
    expect(RACE).toContain('preparar 1 1 previa');
    expect(RACE).toContain("grep -q 'UNLINK_BLOCKED_ATTRIBUTION'");
    expect(RACE).not.toContain('raise notice');
    expect(CI).toContain('supabase/checks/unlink-evidence.sql');
    expect(CI).not.toContain('supabase/checks/unclaim-evidence.sql');
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
