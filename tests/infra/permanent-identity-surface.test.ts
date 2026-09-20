import { describe, expect, it } from 'vitest';

import SCREEN from '../../src/app/group/[id].tsx?raw';
import GROUPS from '../../src/app/(tabs)/groups.tsx?raw';
import JOIN from '../../src/features/groups/join-panel.tsx?raw';
import HOOKS from '../../src/features/groups/use-membership.ts?raw';
import SERVICE from '../../src/features/groups/membership-service.ts?raw';
import PARTICIPANTS from '../../src/features/groups/participant-service.ts?raw';
import LOCAL from '../../src/features/groups/use-group-participants.ts?raw';
import INDEX from '../../src/features/groups/index.ts?raw';
import CARD from '../../src/features/groups/group-notice-card.tsx?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import EN from '../../src/lib/i18n/messages/en.ts?raw';
import TYPES from '../../src/types/database.ts?raw';
import CI from '../../.github/workflows/ci.yml?raw';
import LINK_CHECK from '../../supabase/checks/link-instance.sql?raw';
import GUARD from '../../supabase/checks/group-identity-lock.sql?raw';
import LOCK_RACE from '../../scripts/identity-lock-race-evidence.sh?raw';
import HTTP from '../../scripts/http-boundary-check.sh?raw';
import MIGRATION from '../../supabase/migrations/20260917120000_permanent_identity.sql?raw';
import LEAVE from '../../supabase/migrations/20260914120000_departure_novation.sql?raw';
import ADR2 from '../../docs/adr/F10/ADR-002-permanent-identity.md?raw';
import ADR_INDEX from '../../docs/adr/F10/README.md?raw';

/**
 * IDENTIDAD PERMANENTE EN EL GRUPO (F10/ADR-002; bloque F10.A3).
 *
 * Lo estructural del estado FINAL: ni el cliente, ni los tipos generados, ni
 * la migracion que cierra el contrato, ni CI, ni la UX conservan ninguna via
 * para deshacer un vinculo —ni el `unclaim` de F9 ni el `unlink` de F10.A2—;
 * reclamar avisa de que es permanente; salir y volver siguen siendo F9 sin
 * tocar. Las migraciones historicas y F10/ADR-001 conservan a proposito el
 * contrato que existio en su momento: aqui se miran solo las superficies
 * vigentes.
 */

const sql = (text: string) => text.replace(/--.*$/gm, '');
const src = sql(MIGRATION);
const slice = (text: string, a: string, b: string) => {
  const ia = text.indexOf(a);
  const ib = text.indexOf(b, ia);
  expect(ia, a).toBeGreaterThan(-1);
  expect(ib, b).toBeGreaterThan(-1);
  return text.slice(ia, ib);
};

describe('el cliente y los tipos no conocen ninguna baja', () => {
  it('ni unclaim, ni unlink, ni claim_command_id, ni link_id, ni «Me equivoqué», ni «Dejar mi identidad»', () => {
    for (const [name, file] of [
      ['screen', SCREEN],
      ['groups', GROUPS],
      ['join', JOIN],
      ['hooks', HOOKS],
      ['service', SERVICE],
      ['participants', PARTICIPANTS],
      ['local', LOCAL],
      ['index', INDEX],
      ['card', CARD],
      ['es', ES],
      ['en', EN],
      ['types', TYPES],
    ] as const) {
      expect(file, name).not.toMatch(
        /unclaim|Unclaim|unlink|Unlink|claimCommandId|claim_command_id|linkId|link_id|identity_released|identityReleased|Me equivoqu|Dejar mi identidad|Leave my identity/,
      );
    }
    expect(TYPES).not.toMatch(/unlink_participant|unclaim_participant/);
    // La fila propia de Saldos no tiene menu; las ajenas conservan el suyo.
    expect(SCREEN).toContain('La fila PROPIA no tiene menu');
    expect(SCREEN).toContain("id: 'associate',");
    expect(SCREEN).toContain("id: 'retire',");
    // La campana: los seis kinds de F9, y nada mas.
    expect(SERVICE).toContain("| 'payment_annulled';");
    expect(CARD).toContain("payment_annulled: 'notice.paymentAnnulled',");
  });

  it('reclamar avisa de que, mientras se forme parte del grupo, ese es el participante y no se cambia, con la ventana y los botones de siempre', () => {
    // F10/ADR-003 §3: «permanente» se dice como lo que es —mientras formes
    // parte del grupo—, porque salir y volver como otro existe.
    expect(ES).toContain(
      "'Sus gastos y deudas anteriores pasarán a tu cuenta. Mientras formes parte del grupo, este será tu participante: no podrás cambiarlo ni desvincularte.'",
    );
    expect(EN).toContain(
      `"Their earlier expenses and debts will move to your account. While you are in the group, this will be your participant: it can't be changed or given up."`,
    );
    expect(JOIN).toContain("t('groups.claimAskTitle', { name: one.displayName })");
    expect(JOIN).toContain("t('groups.claimAskBody')");
    expect(JOIN).toContain("{ text: t('groups.claimBack'), style: 'cancel' }");
    expect(JOIN).toContain("text: t('groups.claimYes', { name: one.displayName })");
    expect(JOIN).toContain('PERMANENTE');
    expect(JOIN).not.toMatch(/SheetWindow[^\n]*claim/i);
  });
});

describe('la migracion 49 deja el contrato final', () => {
  it('retira la baja y el legado, y conserva instancia, procedencia, linea base y F9', () => {
    // Fail-closed antes de retirar: ninguna baja ni aviso registrados.
    expect(src).toContain('select count(*) into v_n from core.participant_unlink;');
    expect(src).toContain(
      "select count(*) into v_n from core.group_notice where kind = 'identity_released';",
    );
    for (const drop of [
      'drop function api.unlink_participant(jsonb);',
      'drop function sec.unlink_instance(uuid, uuid, integer, uuid, uuid, uuid, boolean);',
      'drop function api.unclaim_participant(jsonb);',
      'drop function sec.unlink_blocking_attribution(uuid);',
      'drop function sec.unclaim_blocking_operations(uuid);',
      'drop function sec.my_claim_command_id(uuid);',
      'drop function sec.my_link_id(uuid);',
      'drop view api.group_participant;',
      'drop table core.participant_unlink;',
      'alter table core.participant_user_link drop column claim_command_id;',
    ]) {
      expect(src, drop).toContain(drop);
    }
    const view = slice(
      src,
      'create or replace view api.group_participant',
      "where s.kind = 'group';",
    );
    expect(view).not.toMatch(/claim_command_id|link_id/);
    expect(view).toContain('sec.is_my_participant(p.id) as is_self,');
    expect(src).toContain('grant select on api.group_participant to authenticated;');
    const notice = slice(
      src,
      'create or replace view api.group_notice',
      'alter table core.group_notice drop constraint',
    );
    expect(notice).not.toContain('identity_released');
    expect(src).toContain(
      "check (kind = any (array['edit', 'profile', 'departure', 'settlement', 'payment', 'payment_annulled']));",
    );
    // redeem sin la columna derivada; el origen se queda.
    expect(src).toContain(
      'insert into core.participant_user_link (participant_id, scope_id, user_id, origin_command_id)',
    );
    expect(src).not.toMatch(/drop column (link_id|origin_command_id)/);
    expect(src).not.toMatch(/drop table core\.link_baseline/);
    expect(src).not.toMatch(/drop function sec\.(instance_subjects|link_baseline_rows)/);
    // F9 intacta: ni leave_group, ni la novacion, ni create_group se recrean aqui.
    expect(src).not.toMatch(
      /function api\.leave_group|record_departure_novation|function api\.create_group/,
    );
    // La presencia solo la toca redeem al volver (F9); la migracion no cierra ninguna por su cuenta.
    expect(src).not.toMatch(/set valid_until = current_date/);
  });

  it('salir y volver siguen siendo F9: leave_group conserva el vinculo y rejoin recupera el participante', () => {
    const leave = slice(sql(LEAVE), 'create or replace function api.leave_group(', '\n$function$');
    expect(leave).toContain(
      'delete from core.membership where scope_id = v_scope and user_id = v_actor;',
    );
    expect(leave).not.toContain('delete from core.participant_user_link');
    expect(leave).toContain("perform sec.raise_boundary('LEAVE_BLOCKED_DEBT',");
    const rejoin = slice(src, "if v_choice <> 'rejoin' then", "if v_choice = 'rejoin' then");
    expect(rejoin).toContain(
      'insert into core.membership (scope_id, user_id) values (v_inv.scope_id, v_actor);',
    );
    expect(rejoin).not.toContain('into core.participant_user_link');
  });
});

describe('la evidencia y la decision', () => {
  it('checks, guarda, carreras y HTTP miden el contrato permanente; CI no ejecuta nada de unlink', () => {
    for (const s of [
      "'A3 core.participant_unlink sigue existiendo'",
      "'A3 sigue en el catalogo: '",
      "'A3 claim_command_id o link_id siguen publicados o en el vinculo'",
      "'A3 identity_released sigue en el CHECK o en la vista'",
      "'F6 la linea base o los sujetos no sobrevivieron al vinculo'",
    ]) {
      expect(LINK_CHECK, s).toContain(s);
    }
    expect(LINK_CHECK).not.toMatch(/pg_temp\.call\('(unlink|unclaim)_participant'/);
    expect(GUARD).not.toMatch(/unlink|unclaim/);
    // eleven after F10; fourteen since F12.B3 added the three group-proposal commands.
    expect(GUARD).toContain('catorce funciones toman el cerrojo');
    expect(LOCK_RACE).not.toMatch(/unlink|unclaim|rectificar|dejar/);
    expect(LOCK_RACE).toContain('select api.redeem_invitation(');
    expect(HTTP).toContain(
      'comprobar_error "unlink_participant no existe" unlink_participant "${TOK_B}"',
    );
    expect(HTTP).toContain(
      'comprobar_error "unclaim_participant no existe" unclaim_participant "${TOK_B}"',
    );
    expect(HTTP).toContain('!("link_id" in r) && !("claim_command_id" in r)');
    expect(CI).not.toMatch(/unlink-|unclaim-|unlink_participant|unclaim_participant/);
    expect(CI).toContain('bash scripts/identity-lock-race-evidence.sh');
    expect(CI).toContain('supabase/checks/link-instance.sql');
  });

  it('F10/ADR-002 esta Aceptado y dice que supera de ADR-001 y que conserva; el indice lo refleja', () => {
    expect(ADR2).toMatch(/\*\*Estado:\*\* Aceptado/);
    expect(ADR2).toContain('identidad permanente');
    for (const s of ['§2', '§5', '§6', '§7', '§8', '§9', '§10', '§11', '§12', '§14']) {
      expect(ADR2, s).toContain(s);
    }
    const kept = ADR2.slice(
      ADR2.indexOf('**Conserva** de F10/ADR-001'),
      ADR2.indexOf('**Se apoya en**'),
    );
    for (const s of ['**§0**', '**§1**', '**§3**', '**§13**']) {
      expect(kept, s).toContain(s);
    }
    expect(ADR2).toContain('leave_group');
    // El ADR nombra la UX retirada solo como historia; no la ofrece como accion.
    expect(ADR2).not.toMatch(/`unlink_participant` sigue|se conserva la accion/);
    expect(ADR_INDEX).toContain('ADR-002-permanent-identity.md');
    expect(ADR_INDEX).toMatch(/ADR-001[^\n]*superado en parte/i);
  });
});
