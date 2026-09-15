import { describe, expect, it } from 'vitest';

import CI from '../../.github/workflows/ci.yml?raw';
import HTTP from '../../scripts/http-boundary-check.sh?raw';
import RACE from '../../scripts/unlink-race-evidence.sh?raw';
import GUARD from '../../supabase/checks/group-identity-lock.sql?raw';
import CHECK from '../../supabase/checks/unlink-evidence.sql?raw';
import MIGRATION from '../../supabase/migrations/20260916120000_unlink_participant.sql?raw';

/**
 * DEJAR UNA INSTANCIA DE VINCULO (F10/ADR-001 §2, §4–§11; bloque F10.A2).
 *
 * Lo estructural del repositorio: una sola implementacion y en que orden lee y
 * escribe, que el evaluador no usa ni canonico ni valor absoluto ni reloj, que
 * el hecho y el aviso quedan en `core` con lo justo publicado, y que la
 * evidencia viva —checks, carreras, HTTP— corre en CI. Lo que pasa contra la
 * base real lo miden `supabase/checks/unlink-evidence.sql`,
 * `scripts/unlink-race-evidence.sh` y la seccion 13 de
 * `scripts/http-boundary-check.sh`.
 */

const sql = (text: string) => text.replace(/--.*$/gm, '');
const src = sql(MIGRATION);
const between = (a: string, b: string) => {
  const ia = src.indexOf(a);
  const ib = src.indexOf(b, ia);
  expect(ia, a).toBeGreaterThan(-1);
  expect(ib, b).toBeGreaterThan(-1);
  return src.slice(ia, ib);
};
const before = (body: string, a: string, b: string) => {
  const ia = body.indexOf(a);
  const ib = body.indexOf(b);
  expect(ia, a).toBeGreaterThan(-1);
  expect(ib, b).toBeGreaterThan(-1);
  expect(ia, `${a} < ${b}`).toBeLessThan(ib);
};

describe('el evaluador economico (§2)', () => {
  const evaluator = between(
    'create function sec.unlink_blocking_attribution(p_link uuid)',
    'revoke execute on function sec.unlink_blocking_attribution(uuid)',
  );

  it('compara S0 sobre la linea base con S_now sobre la version vigente, por operacion e identidad, con ids crudos', () => {
    expect(evaluator).toContain(
      'select s.participant_id from core.link_baseline_subject s where s.link_id = p_link',
    );
    expect(evaluator).toContain(
      'select unnest(sec.instance_subjects((select participant_id from l))) as participant_id',
    );
    expect(evaluator).toContain(
      'join core.effect e on e.operation_version_id = b.baseline_version_id',
    );
    expect(evaluator).toContain(
      'join core.effect e on e.operation_version_id = o.current_version_id',
    );
    expect(evaluator).toContain("select 'owes:' || e.debt_creditor_participant_id, e.debt_amount");
    expect(evaluator).toContain("select 'owed:' || e.debt_debtor_participant_id, e.debt_amount");
    expect(evaluator).toContain('full outer join base b on b.op = c.op and b.key = c.key');
  });

  it('capa necesaria firmada sobre eco/owes, politica v1 sobre toda identidad nueva; nada por neto, abs() ni reloj', () => {
    expect(evaluator).toContain(
      "bool_or(coalesce(c.key, b.key) not like 'owed:%' and coalesce(c.q, 0) > coalesce(b.q, 0)) as necessary",
    );
    expect(evaluator).toContain(
      'bool_or(coalesce(b.q, 0) = 0 and coalesce(c.q, 0) <> 0) as policy',
    );
    expect(evaluator).toContain("case when v.necessary then 'attribution' else 'policy' end");
    expect(evaluator).not.toMatch(
      /canonical_participant|abs\(|created_at|linked_at|current_effect/,
    );
    // El importe viaja como texto (F02/ADR-001).
    expect(evaluator).toContain('ov.original_amount::text');
    // Definer de postgres, ejecutable solo por el provisioner: lee core.effect cruzando RLS como claimed_dimension().
    expect(evaluator).toContain('security definer');
    expect(src).toContain(
      'grant execute on function sec.unlink_blocking_attribution(uuid) to nomey_provisioner;',
    );
  });

  it('S0 y S_now son el cierre transitivo sobre participant_merge, tambien al reclamar', () => {
    const subjects = between(
      'create function sec.instance_subjects(p_participant uuid)',
      'revoke execute on function sec.instance_subjects',
    );
    expect(subjects).toContain('with recursive s as (');
    expect(subjects).toContain('join s on m.target_participant_id = s.id)');
    const redeem = between(
      'CREATE OR REPLACE FUNCTION api.redeem_invitation(',
      'create function sec.my_link_id',
    );
    expect(redeem).toContain('v_s0 := sec.instance_subjects(v_target);');
    expect(redeem).toContain('from sec.link_baseline_rows(v_inv.scope_id, v_s0) b;');
  });
});

describe('la implementacion unica (§5–§9)', () => {
  const core = between(
    'create function sec.unlink_instance(',
    'create function api.unlink_participant(payload jsonb)',
  );

  it('clave → replay → cerrojo → membresia → vinculo propio exacto → atribucion → caja → hecho → aviso → borrados; sin rango 2', () => {
    before(core, 'into core.provisioning_command', 'perform sec.lock_participant_claims(p_scope);');
    before(
      core,
      'perform sec.lock_participant_claims(p_scope);',
      'if not sec.is_member(p_scope) then',
    );
    before(
      core,
      'if not sec.is_member(p_scope) then',
      'and l.participant_id = p_participant and l.link_id = p_link;',
    );
    before(core, 'and l.link_id = p_link;', 'from sec.unlink_blocking_attribution(p_link) b;');
    before(
      core,
      'from sec.unlink_blocking_attribution(p_link) b;',
      'from sec.unclaim_blocking_operations(p_scope) b;',
    );
    before(
      core,
      'from sec.unclaim_blocking_operations(p_scope) b;',
      'insert into core.participant_unlink (',
    );
    before(
      core,
      'insert into core.participant_unlink (',
      "select m.user_id, p_scope, 'identity_released', v_fact.id, p_actor",
    );
    before(
      core,
      "'identity_released', v_fact.id, p_actor",
      'delete from core.participant_user_link where link_id = p_link and user_id = p_actor;',
    );
    before(
      core,
      'delete from core.participant_user_link where link_id = p_link and user_id = p_actor;',
      'delete from core.membership where scope_id = p_scope and user_id = p_actor;',
    );
    expect(core).not.toContain('sec.lock_scopes(');
    // El unico manejador es el de la clave (F03/ADR-008 §13).
    expect(core.match(/exception when/g)).toHaveLength(1);
    expect(core).toContain('exception when unique_violation then');
  });

  it('LINK_SUPERSEDED es uniforme: inexistente, ajeno, antiguo o sin instancia; quien salio con vinculo, NOT_AUTHORIZED', () => {
    expect(core).toContain(
      "perform sec.raise_boundary(case when p_legacy then 'CLAIM_SUPERSEDED' else 'LINK_SUPERSEDED' end,\n      'esa instancia de vinculo no es la tuya vigente en este grupo', 409);",
    );
    expect(core.match(/'LINK_SUPERSEDED'/g)).toHaveLength(2);
    expect(core).toContain(
      'if exists (select 1 from core.participant_user_link l where l.scope_id = p_scope and l.user_id = p_actor) then',
    );
    expect(core).toContain(
      "perform sec.raise_boundary('NOT_AUTHORIZED', 'no eres miembro de este grupo', 403);",
    );
    for (const code of [
      'UNLINK_BLOCKED_ATTRIBUTION',
      'UNLINK_BLOCKED_CASH',
      'COMMAND_IN_FLIGHT',
      'IDEMPOTENCY_KEY_REUSED',
    ]) {
      expect(core).toContain(`'${code}'`);
    }
    expect(core).toContain("jsonb_build_object('operations', v_blocking)");
  });

  it('el efecto de la baja no toca presencia, hechos contables, fusiones ni linea base (§6)', () => {
    const writes = core.slice(core.indexOf('insert into core.participant_unlink ('));
    expect(writes).not.toMatch(
      /participant_period|core\.effect|operation_version|participant_merge|link_baseline|group_departure|participant_retirement/,
    );
    expect(core).toContain(
      "values (p_link, p_participant, p_scope, p_actor, p_actor, v_link.origin_command_id, 'self', p_command)",
    );
    expect(core).toContain('where m.scope_id = p_scope and m.user_id <> p_actor');
    expect(core).toContain('on conflict (recipient_user_id, kind, subject_id) do nothing;');
  });

  it('del provisioner, en sec, y solo api.unlink_participant y el wrapper la ejecutan', () => {
    expect(src).toContain(
      'alter function sec.unlink_instance(uuid, uuid, integer, uuid, uuid, uuid, boolean) owner to nomey_provisioner;',
    );
    expect(src).toContain(
      'revoke execute on function sec.unlink_instance(uuid, uuid, integer, uuid, uuid, uuid, boolean) from public;',
    );
    expect(src).not.toMatch(/grant execute on function sec\.unlink_instance/);
    expect(src).toContain(
      'alter function api.unlink_participant(jsonb) owner to nomey_provisioner;',
    );
    expect(src).toContain(
      'grant execute on function api.unlink_participant(jsonb) to authenticated;',
    );
    const api = between(
      'create function api.unlink_participant(payload jsonb)',
      'create or replace function api.unclaim_participant(payload jsonb)',
    );
    expect(api).toContain(
      "'client_command_id', 'command_contract_version', 'scope_id', 'participant_id', 'link_id'];",
    );
    expect(api).toContain(
      'return sec.unlink_instance(v_actor, v_command, v_version, v_scope, v_target, v_link, false);',
    );
  });
});

describe('seguridad y lectura (§7, §8, §10)', () => {
  it('el hecho: el provisioner escribe y lee solo el suyo; el cliente lee tres columnas por membresia', () => {
    expect(src).toContain('grant insert, select on core.participant_unlink to nomey_provisioner;');
    expect(src).toContain(
      'with check (user_id = sec.request_actor_id() and unlinked_by = sec.request_actor_id());',
    );
    expect(src).toContain(
      'grant select (id, participant_id, scope_id) on core.participant_unlink to authenticated;',
    );
    expect(src).toContain('using (sec.is_member(scope_id));');
    expect(src).not.toMatch(/grant [^;]*(update|delete)[^;]*on core\.participant_unlink/);
    expect(src).not.toMatch(/grant [^;]*on core\.participant_user_link/);
    expect(src).not.toMatch(/create policy [^;]*on core\.participant_user_link/);
    expect(src).not.toMatch(/to nomey_writer/);
  });

  it('identity_released existe en core y NO cruza api hasta A3: ni la vista lo lista ni «visto» lo marca', () => {
    expect(src).toContain("'payment', 'payment_annulled', 'identity_released']));");
    const view = between(
      'create or replace view api.group_notice with (security_invoker = true) as',
      'create or replace function api.mark_group_notices_seen',
    );
    expect(view).toContain(
      "when 'identity_released' then (select u.participant_id from core.participant_unlink u where u.id = n.subject_id)",
    );
    expect(view.trim().endsWith("where n.kind <> 'identity_released';")).toBe(true);
    const seen = between(
      'create or replace function api.mark_group_notices_seen',
      'create function sec.unlink_instance(',
    );
    expect(seen).toContain("and n.kind <> 'identity_released'");
    // Sin datos de la cuenta: el aviso resuelve al participante, nunca a user_id.
    expect(view).not.toMatch(/u\.user_id|unlinked_by/);
  });

  it('el cliente lee SU link_id en su fila de api.group_participant y nada mas; core.participant_unclaim se retira fail-closed', () => {
    const mine = between(
      'create function sec.my_link_id(p_participant uuid)',
      'revoke execute on function sec.my_link_id',
    );
    expect(mine).toContain(
      'where l.participant_id = p_participant and l.user_id = sec.request_actor_id();',
    );
    expect(src).toContain('sec.my_link_id(p.id) as link_id');
    expect(src).toContain('select count(*) into v_n from core.participant_unclaim;');
    expect(src).toContain('drop table core.participant_unclaim;');
  });
});

describe('la evidencia', () => {
  it('el check cubre catalogo, los 15 casos x2, fusiones, situaciones, efecto, uniformidad, replay, aviso y wrapper; CI lo ejecuta', () => {
    for (const s of [
      'A · catalogo: owners, definers, grants, policies, kind oculto, sin cadenas',
      'B · la regla economica, deudor y acreedor (ADR §2.5): 19 casos',
      'C · fusiones: previa en S0, durante con y sin atribucion, cadena A→B→P',
      'D · create / new: con atribucion bloquea; sin ella pasa; el escape falla',
      'E · efecto de la baja: presencia, hechos, disponible, rejoin, claim ajeno',
      'F · LINK_SUPERSEDED uniforme y sin escritura; quien salio con vinculo: NOT_AUTHORIZED',
      'G · replay: mismo comando, misma respuesta, un solo hecho, un solo aviso',
      'I · wrapper legado: clave del cliente, retry sin comando extra, origen ≠ comando de baja',
      'I · wrapper legado: clave del cliente, retry sin comando extra, origen ≠ comando de baja',
      "if v2 <> 'ERR LINK_SUPERSEDED' then fallos := array_append(fallos, 'G4: ' || v2); end if;",
    ]) {
      expect(CHECK, s).toContain(s);
    }
    expect(CHECK.trim().endsWith('rollback;')).toBe(true);
    expect(CI).toContain('supabase/checks/unlink-evidence.sql');
  });

  it('la guarda del cerrojo vigila sec.unlink_instance y api.unlink_participant', () => {
    expect(GUARD).toContain("('sec.unlink_instance'),");
    expect(GUARD).toContain("perform pg_temp.antes('sec.unlink_instance',");
    expect(GUARD).toContain("'sec.unlink_instance', 'api.unlink_participant'");
    expect(CI).toContain('supabase/checks/group-identity-lock.sql');
  });

  it('las carreras de §9, con dos sesiones reales y la espera medida, y las de associate y rejoin, corren en CI', () => {
    for (const marker of [
      '1a · baja (retiene 3 s) → gasto que nombra a Ana',
      '2b · correccion que sube la cuota de Ana (retiene 3 s) → baja',
      '2c · correccion que quita a Ana (retiene 3 s) → baja',
      '3b · transferencia de Ana a Edu (retiene 3 s) → baja',
      '4a · anulacion del gasto nacido durante (retiene 3 s) → baja',
      '5b · salir (retiene 3 s) → baja',
      '6a · baja (retiene 3 s) → volver',
      '7a · baja (retiene 3 s) → Bea reclama a PB',
      '8b · Ana asocia a Gus, que debe (retiene 3 s) → baja',
      '9a · baja (retiene 3 s) → Edu retira a PB',
      '10a · doble baja con la MISMA clave (doble pulsacion)',
      '11 · api.unclaim_participant dos veces a la vez con la MISMA clave (doble pulsacion del cliente vigente)',
      '11 · api.unclaim_participant dos veces a la vez con la MISMA clave (doble pulsacion del cliente vigente)',
      'select api.unlink_participant(',
      "(select link_id from api.group_participant where participant_id = '${PB}')",
      'ESPERA=',
      'exigir_base_local',
    ]) {
      expect(RACE, marker).toContain(marker);
    }
    expect(RACE).not.toContain('raise notice');
    expect(CI).toContain('bash scripts/unlink-race-evidence.sh');
    expect(CI).toContain('bash scripts/associate-race-evidence.sh');
    expect(CI).toContain('bash scripts/rejoin-race-evidence.sh');
  });

  it('la frontera HTTP con JWT ajeno: link_id propio, LINK_SUPERSEDED uniforme, replay, details como texto, aviso oculto', () => {
    for (const marker of [
      '== 13 · dejar la instancia de vinculo, por HTTP y con JWT ajeno (F10/ADR-001) ==',
      'comprobar_error "JWT ajeno, instancia y participante de A" unlink_participant "${TOK_B}"',
      'comprobar_error "JWT ajeno, participante propio con la instancia de A" unlink_participant "${TOK_B}"',
      'comprobar_error "segunda baja con clave nueva" unlink_participant "${TOK_A}"',
      'o[0].amount==="3000" && typeof o[0].amount==="string"',
      'rest/v1/group_notice?scope_id=eq.${GZ}&select=kind',
      'delete from core.participant_unlink where scope_id in (${MIOS});',
    ]) {
      expect(HTTP, marker).toContain(marker);
    }
    expect(CI).toContain('./scripts/http-boundary-isolation.sh');
  });
});
