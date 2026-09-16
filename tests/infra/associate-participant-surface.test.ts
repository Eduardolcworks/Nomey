import { describe, expect, it } from 'vitest';

import LIST from '../../src/app/(tabs)/groups.tsx?raw';
import SCREEN from '../../src/app/group/[id].tsx?raw';
import FORM from '../../src/features/groups/shared-expense-form.tsx?raw';
import INDEX from '../../src/features/groups/index.ts?raw';
import MEMBERSHIP from '../../src/features/groups/use-membership.ts?raw';
import SERVICE from '../../src/features/groups/membership-service.ts?raw';
import PARTICIPANTS from '../../src/features/groups/participant-service.ts?raw';
import PRESENCE from '../../src/features/groups/participant-presence.ts?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import EN from '../../src/lib/i18n/messages/en.ts?raw';
import TYPES from '../../src/types/database.ts?raw';
import NOVATION from '../../supabase/migrations/20260914120000_departure_novation.sql?raw';
import ASSOCIATE from '../../supabase/migrations/20260914130000_associate_participant.sql?raw';
import PERMANENT from '../../supabase/migrations/20260917120000_permanent_identity.sql?raw';
import NOVATION_CHECK from '../../supabase/checks/departure-novation.sql?raw';
import ASSOCIATE_CHECK from '../../supabase/checks/associate-participant.sql?raw';
import RACE from '../../scripts/associate-race-evidence.sh?raw';
import ADR38 from '../../docs/adr/F09/ADR-007-group-payments-and-exit-without-debt.md?raw';
import ADR40 from '../../docs/adr/F09/ADR-009-associate-ghost-to-own-account.md?raw';

/**
 * SALIR A NETO CERO (F09/ADR-007 C8) Y ASOCIAR UN FANTASMA (F09/ADR-009): la
 * superficie que el cliente consume y el contrato que las migraciones fijan.
 * La verdad contable la demuestran los checks aislados; aquí se fija que lo
 * que se cablea es lo que se demostró.
 */
describe('salir a neto cero: la novación de salida (20260914120000)', () => {
  it('la salida exige neto cero y reasigna los pares sin caja ni gasto, atómica e idempotente', () => {
    expect(NOVATION).toContain(
      'alter table core.group_departure add column novation_operation_id uuid references core.operation (id);',
    );
    expect(NOVATION).toContain(
      'create function sec.record_departure_novation(p_scope uuid, p_participant uuid, p_command uuid)',
    );
    // Neto cero o nada: sin novación no hay salida con pares.
    expect(NOVATION).toContain(
      "perform sec.raise_boundary('LEAVE_BLOCKED_DEBT', 'la novacion de salida exige neto cero', 409,",
    );
    expect(NOVATION).toContain('if v_sum_in = 0 then return null; end if;');
    // La MISMA clave que la salida, otra relación: un reintento no escribe otra.
    expect(NOVATION).toContain(
      "v_payload := jsonb_build_object('client_operation_id', p_command, 'command_contract_version', 1, 'scope_id', p_scope);",
    );
    expect(NOVATION).toContain(
      "from sec.begin_command(v_payload, 'departure_novation', v_canonical);",
    );
    // Sólo deuda: liquidaciones (−) y novaciones (+); ninguna caja, ningún económico.
    expect(NOVATION).toContain(
      "values (gen_random_uuid(), v_version, p_scope, 'settlement', v_currency, - v_ins_a[v_i], v_ins_d[v_i], p_participant);",
    );
    expect(NOVATION).toContain(
      "values (gen_random_uuid(), v_version, p_scope, 'novation', v_currency, v_take, v_ins_d[v_i], v_out_c[v_k]);",
    );
    expect(NOVATION).not.toContain('balance_amount');
    // No se anula; la salida guarda la procedencia.
    expect(NOVATION).toContain("if v_clase = 'departure_novation' then");
    expect(NOVATION).toContain("perform sec.raise_boundary('OPERATION_NOT_ANNULLABLE',");
    expect(NOVATION).toContain('if v_net <> 0 then');
    expect(NOVATION).toContain(
      'v_novation := sec.record_departure_novation(v_scope, v_participant, v_command);',
    );
    expect(NOVATION).toContain(
      'insert into core.group_departure (scope_id, participant_id, user_id, client_command_id, novation_operation_id)',
    );
    // El writer es el dueño; el provisioner sólo lo invoca.
    expect(NOVATION).toContain(
      'alter function sec.record_departure_novation(uuid, uuid, uuid) owner to nomey_writer;',
    );
    expect(NOVATION).toContain(
      'grant execute on function sec.record_departure_novation(uuid, uuid, uuid) to nomey_provisioner;',
    );
  });

  it('la evidencia aislada cubre el ejemplo, cadenas, ciclos, fantasmas, lo posterior y C6', () => {
    for (const marker of [
      "if pg_temp.gp_pairs(r.g1) <> 'Aitor>Luis:300' then raise exception 'A7: %'",
      "if pg_temp.gp_personal(r.edu) <> v_edu then raise exception 'A13: Personal Edu cambio",
      "if v <> 'REPLAY' then raise exception 'A16: %', v; end if;",
      "'Aitor>Bea:300 Ana>Aitor:250 Bea>Luis:400 Gus>Bea:100 Gus>Luis:100'",
      "'Aitor>Luis:300 Ana>Aitor:250 Gus>Luis:200'",
      "if pg_temp.gp_pairs(r.g3) <> '-' then raise exception 'C4: %'",
      "if pg_temp.salida(r.g3, r.a3) is not null then raise exception 'C6: novacion sin pares'; end if;",
      "if v <> 'DEPARTED_OBLIGATION_CHANGED' then raise exception 'D2d: %', v; end if;",
      "if pg_temp.gp_reopened_debt(r.edu) <> -100 then raise exception 'E3: %'",
    ]) {
      expect(NOVATION_CHECK).toContain(marker);
    }
    expect(ADR38).toContain('### C8. Salir a cero: la salida simplifica las obligaciones');
    expect(ADR38).toContain('**No se afirma** que las obligaciones vigentes');
  });
});

describe('asociar un fantasma a mi cuenta (20260914130000)', () => {
  it('la fusión es de lectura en la proyección canónica; la caja se completa una vez y sólo en mi Personal', () => {
    expect(ASSOCIATE).toContain('create table core.participant_merge (');
    expect(ASSOCIATE).toContain('create function sec.canonical_participant(p_participant uuid)');
    expect(ASSOCIATE).toContain(
      'create or replace view core.current_effect with (security_invoker = true) as',
    );
    expect(ASSOCIATE).toContain(
      'coalesce(me.target_participant_id, e.economic_participant_id)    as economic_participant_id,',
    );
    expect(ASSOCIATE).toContain(
      'coalesce(md.target_participant_id, e.debt_debtor_participant_id)   as debt_debtor_participant_id,',
    );
    // Un origen no se nombra en altas nuevas; quien ya constaba sigue valiendo.
    expect(ASSOCIATE).toContain("perform sec.raise_boundary('PARTICIPANT_MERGED',");
    // La caja histórica: writer, rango 2, sólo lo que falta; anuladas y sustituidas, no.
    expect(ASSOCIATE).toContain(
      'create function sec.incorporate_participant_cash(p_scope uuid, p_source uuid)',
    );
    expect(ASSOCIATE).toContain('perform sec.lock_scopes(array[p_scope, v_personal]);');
    expect(ASSOCIATE).toContain("where ov.version_kind = 'record'),");
    expect(ASSOCIATE).toContain('where not exists (select 1 from core.effect x');
    expect(ASSOCIATE).toContain('create policy effect_writer_incorporate_insert on core.effect');
    expect(ASSOCIATE).toContain('where m.merged_by = sec.request_actor_id()');
    // El comando: clave → cerrojo → destino propio → origen libre → hecho → caja.
    expect(ASSOCIATE).toContain('create function api.associate_participant(payload jsonb)');
    expect(ASSOCIATE).toContain(
      "values (v_actor, v_command, 'group.associate', v_version, v_intent, v_scope);",
    );
    expect(ASSOCIATE).toContain('perform sec.lock_participant_claims(v_scope);');
    expect(ASSOCIATE).toContain(
      "perform sec.raise_boundary('PARTICIPANT_LINKED', 'ese participante ya tiene cuenta', 409);",
    );
    expect(ASSOCIATE).toContain('v_cash := sec.incorporate_participant_cash(v_scope, v_source);');
    // UNCLAIM_BLOCKED_MERGE nacio aqui, con la rectificacion de F9. Desde F10/ADR-002
    // la identidad es permanente: no hay nada que deshacer, y la migracion 49 retira
    // el wrapper que lo emitia (`tests/infra/permanent-identity-surface.test.ts`).
    expect(ASSOCIATE).toContain("perform sec.raise_boundary('UNCLAIM_BLOCKED_MERGE',");
    expect(PERMANENT).toContain('drop function api.unclaim_participant(jsonb);');
    // El origen se publica como fusionado y sin fila en Saldos; «tu parte» es la suma.
    expect(ASSOCIATE).toContain('as merged_into_participant_id');
    expect(ASSOCIATE).toContain(
      'and not exists (select 1 from core.participant_merge m where m.source_participant_id = p.id);',
    );
    expect(ASSOCIATE).toContain('(select sum(ee.economic_amount)::text');
    expect(TYPES).toContain('merged_into_participant_id: string | null');
    expect(TYPES).toContain('associate_participant: { Args: { payload: Json }; Returns: Json }');
  });

  it('la evidencia aislada y la carrera cubren caja una vez, cuota por lectura, replay, rechazos y la novación', () => {
    for (const marker of [
      "if v <> 'OK Aitor caja=4' then raise exception 'B1: %', v; end if;",
      "'Aitor>Edu:200 Ana>Aitor:300 Luis>Edu:100'",
      "'caja=-1000 gasto=900 deuda=100 movs_pago=2 deuda_reabierta=0'",
      "if v <> '200' then raise exception 'B7c: your_share %', v; end if;",
      "if v <> 'REPLAY Aitor' then raise exception 'B9: %', v; end if;",
      "if v <> 'PARTICIPANT_MERGED' then raise exception 'C1: %', v; end if;",
      "'Cafes:-200 Cena:-900'",
      "if v <> 'OK Ana caja=1' then raise exception 'D4: %', v; end if;",
    ]) {
      expect(ASSOCIATE_CHECK).toContain(marker);
    }
    expect(RACE).toContain(
      'afirmar "$(codigo "${t2}")" "PARTICIPANT_MERGED" "Ana ve el hecho bajo el cerrojo"',
    );
    expect(RACE).toContain(
      'afirmar "$(caja "${PSB}")" "-1200" "caja de Aitor (900 + 300, una vez cada una)"',
    );
    expect(ADR40).toContain('## Cómo está hecho en el borrador `20260914130000`, y lo demostrado');
  });

  it('el cliente ofrece «Asociar a mi cuenta», oculta los orígenes y enseña el nombre actual en todo', () => {
    expect(SERVICE).toContain('export async function sendAssociateParticipant(payload: {');
    expect(SERVICE).toContain("supabase.rpc('associate_participant', {");
    expect(MEMBERSHIP).toContain('export function useAssociateParticipant(): {');
    expect(MEMBERSHIP).toContain("response.code === 'PARTICIPANT_LINKED' ||");
    expect(MEMBERSHIP).toContain('publishGroupRecorded(args.scopeId);');
    expect(INDEX).toContain('useAssociateParticipant,');
    // La acción, sólo con identidad propia y sobre un participante sin cuenta y activo; con confirmación.
    expect(SCREEN).toContain("id: 'associate',");
    expect(SCREEN).toContain('...((movements.balances ?? []).some((one) => one.isSelf) &&');
    expect(SCREEN).toContain("t('group.associateTitle', { name: displayName }),");
    expect(SCREEN).toContain('askAssociate(balance.participantId, balance.displayName);');
    expect(SCREEN).toContain('participants.refresh();\n                movements.retry();');
    // El origen: publicado como fusionado, fuera de listas y selecciones nuevas.
    expect(PARTICIPANTS).toContain('merged_into_participant_id');
    expect(PARTICIPANTS).toContain('mergedInto: row.merged_into_participant_id ?? null,');
    expect(PRESENCE).toContain("if (typeof one.mergedInto === 'string') return false;");
    expect(FORM).toContain('const shown = participants.filter(listed);');
    // El nombre actual en todas partes: el mapa de nombres resuelve el origen a su destino.
    expect(SCREEN).toContain(
      '(one.mergedInto === null ? undefined : own.get(one.mergedInto)) ?? one.displayName,',
    );
    for (const key of [
      'group.associate',
      'group.associateTitle',
      'group.associateBody',
      'group.associateConfirm',
      'group.associateTakenTitle',
      'group.associateTaken',
      'group.associateFailedTitle',
      'group.associateFailed',
      'groups.leaveBlockedOwe',
      'groups.leaveBlockedOwed',
    ]) {
      expect(ES).toContain(`'${key}'`);
      expect(EN).toContain(`'${key}'`);
    }
    expect(ES).toContain('sus gastos, sus pagos y sus pendientes pasarán a ser tuyos');
    expect(LIST).toContain("t('groups.leaveBlockedOwe', { amount })");
  });
});
