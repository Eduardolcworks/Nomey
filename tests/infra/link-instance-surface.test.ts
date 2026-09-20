import { describe, expect, it } from 'vitest';

import CI from '../../.github/workflows/ci.yml?raw';
import CHECK from '../../supabase/checks/link-instance.sql?raw';
import GUARD from '../../supabase/checks/group-identity-lock.sql?raw';
import MIGRATION from '../../supabase/migrations/20260915120000_link_instance_schema.sql?raw';

/**
 * LA INSTANCIA DE VINCULO (F10/ADR-001 §1, §3, §7, §11; bloque F10.A2.1).
 *
 * Lo estructural del repositorio: que la migracion deja exactamente el modelo
 * aprobado y nada mas, que el relleno es fail-closed y no usa el reloj, que
 * las dos altas escriben origen, S0 y linea base bajo el cerrojo, y que la
 * evidencia viva corre en CI. Lo que pasa contra la base real lo mide
 * `supabase/checks/link-instance.sql`.
 */

const sql = (text: string) => text.replace(/--.*$/gm, '');

const bodyOf = (name: string) => {
  const src = sql(MIGRATION);
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION api.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = src.indexOf('$function$;', start);
  return src.slice(start, end);
};

const before = (body: string, a: string, b: string) => {
  const ia = body.indexOf(a);
  const ib = body.indexOf(b);
  expect(ia, a).toBeGreaterThan(-1);
  expect(ib, b).toBeGreaterThan(-1);
  expect(ia, `${a} < ${b}`).toBeLessThan(ib);
};

describe('el modelo de instancia', () => {
  it('identidad y procedencia son dos columnas, con PK intacta y compatibilidad derivada', () => {
    const src = sql(MIGRATION);
    expect(src).toContain('add column link_id           uuid not null default gen_random_uuid()');
    expect(src).toContain('add column origin_command_id uuid;');
    expect(src).toContain('unique (link_id)');
    expect(src).toContain(
      'foreign key (user_id, origin_command_id)\n    references core.provisioning_command (created_by, client_command_id)',
    );
    expect(src).toContain(
      'check (claim_command_id is null or claim_command_id = origin_command_id)',
    );
    expect(src).not.toMatch(/drop column claim_command_id/);
    expect(src).not.toMatch(/drop constraint participant_user_link_pkey/);
  });

  it('las relaciones de instancia sobreviven a la baja: ninguna FK al vinculo vivo', () => {
    const src = sql(MIGRATION);
    expect(src).toContain('create table core.link_baseline_subject');
    expect(src).toContain('create table core.link_baseline');
    expect(src).toContain('create table core.participant_unlink');
    expect(src).not.toMatch(/references core\.participant_user_link/);
    expect(src).toContain(
      'foreign key (operation_id, baseline_version_id)\n    references core.operation_version (operation_id, id)',
    );
  });

  it('el hecho de baja distingue el comando de origen del comando de baja, ambos por (actor, comando)', () => {
    const src = sql(MIGRATION);
    const unlink = src.slice(
      src.indexOf('create table core.participant_unlink'),
      src.indexOf('§4'),
    );
    expect(unlink).toContain(
      'constraint participant_unlink_comando_unico unique (user_id, client_command_id)',
    );
    expect(unlink).toContain(
      'foreign key (user_id, client_command_id)\n    references core.provisioning_command (created_by, client_command_id)',
    );
    expect(unlink).toContain(
      'foreign key (user_id, origin_command_id)\n    references core.provisioning_command (created_by, client_command_id)',
    );
    expect(unlink).not.toMatch(/client_command_id uuid not null unique/);
    expect(unlink).toContain('check (unlinked_by = user_id)');
    expect(unlink).toContain("check (reason = 'self')");
  });

  it('grants minimos: insert/select del provisioner en la linea base, nada en la baja, nada para el cliente ni el writer', () => {
    const src = sql(MIGRATION);
    expect(src).toContain(
      'revoke all on core.link_baseline_subject, core.link_baseline, core.participant_unlink from public;',
    );
    expect(src).toContain(
      'grant select, insert on core.link_baseline_subject, core.link_baseline to nomey_provisioner;',
    );
    expect(src).not.toMatch(/grant [^;]*on core\.participant_unlink/);
    expect(src).not.toMatch(/grant [^;]*(update|delete)[^;]*on core\.link_baseline/);
    expect(src).not.toMatch(/to authenticated/);
    expect(src).not.toMatch(/to nomey_writer/);
    expect(src).toMatch(/alter table core\.participant_unlink\s+enable row level security/);
  });
});

describe('el relleno', () => {
  const backfill = sql(MIGRATION).slice(
    sql(MIGRATION).indexOf('do $backfill$'),
    sql(MIGRATION).indexOf('$backfill$;'),
  );

  it('es fail-closed: aborta con diagnostico en vez de inventar una linea base', () => {
    expect(backfill).toContain('raise exception using');
    expect(backfill).toContain('no se inventa');
    expect(backfill).toContain('if cardinality(v_cands) = 1 then');
  });

  it('nunca usa el reloj como autoridad', () => {
    expect(backfill).not.toMatch(/created_at\s*[<>]/);
    expect(backfill).not.toMatch(/linked_at\s*[<>]/);
    expect(backfill).not.toMatch(/between/i);
  });

  it('S0 solo cuando P nunca tuvo otra instancia, y base vacia solo por construccion o por ausencia total de versiones', () => {
    expect(backfill).toContain(
      'from core.participant_unclaim u where u.participant_id = r.participant_id',
    );
    expect(backfill).toContain("if v_kind in ('create', 'new') then");
    expect(backfill).toContain('or e.debt_creditor_participant_id = r.participant_id) then');
  });
});

describe('las altas', () => {
  it('create_group toma el rango 1 despues de la clave y antes de escribir, y deja origen y S0', () => {
    const body = bodyOf('create_group');
    before(body, 'into core.provisioning_command', 'perform sec.lock_participant_claims(v_scope);');
    before(body, 'perform sec.lock_participant_claims(v_scope);', 'insert into core.scope');
    expect(body).toContain(
      'insert into core.participant_user_link (participant_id, scope_id, user_id, origin_command_id)\n  values (v_creator, v_scope, v_actor, v_command)\n  returning link_id into v_link;',
    );
    expect(body).toContain(
      'insert into core.link_baseline_subject (link_id, participant_id) values (v_link, v_creator);',
    );
    expect(body).not.toContain('insert into core.link_baseline (');
  });

  it('redeem: claim escribe origen = claim_command_id, S0 con los origenes fusionados y la base bajo el cerrojo; new solo origen y S0; rejoin nada', () => {
    const body = bodyOf('redeem_invitation');
    before(body, 'perform sec.lock_participant_claims(v_inv.scope_id);', 'sec.link_baseline_rows(');
    expect(body).toContain(
      'insert into core.participant_user_link (participant_id, scope_id, user_id, claim_command_id, origin_command_id)\n      values (v_target, v_inv.scope_id, v_actor, v_command, v_command)',
    );
    expect(body).toContain(
      'select m.source_participant_id from core.participant_merge m where m.target_participant_id = v_target',
    );
    expect(body).toContain('from sec.link_baseline_rows(v_inv.scope_id, v_s0) b;');
    expect(body).toContain(
      'insert into core.participant_user_link (participant_id, scope_id, user_id, origin_command_id)\n  values (v_new, v_inv.scope_id, v_actor, v_command)',
    );
    // rejoin: entre REJOIN_REQUIRED y 'rejoined' no se crea vinculo ni sujetos.
    const rejoin = body.slice(body.indexOf("'REJOIN_REQUIRED'"), body.indexOf("'rejoined', true"));
    expect(rejoin).not.toContain('into core.participant_user_link');
    expect(rejoin).not.toContain('into core.link_baseline');
  });

  it('la linea base se lee con ids crudos, nunca por canonico', () => {
    const src = sql(MIGRATION);
    const rows = src.slice(
      src.indexOf('create function sec.link_baseline_rows'),
      src.indexOf('§8'),
    );
    expect(rows).toContain('e.economic_participant_id    = any (p_subjects)');
    expect(rows).not.toContain('canonical_participant');
    expect(rows).toContain('security definer');
  });
});

describe('la evidencia', () => {
  it('el check cubre catalogo, relleno, altas, fusion e integridad, intenta las escrituras prohibidas y CI lo ejecuta', () => {
    for (const s of [
      'A · catalogo',
      'B · relleno',
      'C · create_group',
      'D · redeem',
      'E · claim de un destino',
      'F · integridad',
    ]) {
      expect(CHECK, s).toContain(s);
    }
    expect(CHECK).toContain("'nomey_provisioner', r.zoe);");
    expect(CHECK).toContain("if v <> '42501'");
    expect(CHECK).toContain('record_debt_settlement');
    expect(CHECK.trim().endsWith('rollback;')).toBe(true);
    expect(CI).toContain('supabase/checks/link-instance.sql');
  });

  it('la guarda del cerrojo vigila ahora a associate_participant y a create_group', () => {
    expect(GUARD).toContain("('api.associate_participant'),");
    expect(GUARD).toContain("('api.create_group'),");
    // F12.B3 (20260928120000): the three group-proposal commands close the list.
    expect(GUARD).toContain("('api.decline_group_transfer_proposal')) as t(name)");
    expect(GUARD).toContain(
      "perform pg_temp.antes('api.create_group',                   'core.provisioning_command', 'sec.lock_participant_claims(');",
    );
  });
});
