import { describe, expect, it } from 'vitest';

import EDIT from '../../src/app/edit-group.tsx?raw';
import SCREEN from '../../src/app/group/[id].tsx?raw';
import INVITATION from '../../src/features/groups/invitation-service.ts?raw';
import PANEL from '../../src/features/groups/join-panel.tsx?raw';
import PRESENCE from '../../src/features/groups/participant-presence.ts?raw';
import PARTICIPANTS from '../../src/features/groups/participant-service.ts?raw';
import PAYMENTS from '../../src/features/groups/payment-service.ts?raw';
import TIMELINE from '../../src/features/groups/group-timeline.ts?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import EN from '../../src/lib/i18n/messages/en.ts?raw';
import TYPES from '../../src/types/database.ts?raw';
import CHECK from '../../supabase/checks/link-lifecycle.sql?raw';
import HELPERS from '../../supabase/checks/lib/group-payment-helpers.sql?raw';
import IDENTITY from '../../supabase/checks/participant-identity.sql?raw';
import MIGRATION from '../../supabase/migrations/20260918120000_active_and_historical_link.sql?raw';
import PERMANENT from '../../supabase/migrations/20260917120000_permanent_identity.sql?raw';
import CI from '../../.github/workflows/ci.yml?raw';
import ADR from '../../docs/adr/F10/ADR-003-active-and-historical-link.md?raw';

/**
 * VINCULO ACTIVO Y VINCULO HISTORICO — F10/ADR-003.
 *
 * Sin renderer de React, lo estructural se fija aqui; lo que decide la base
 * —salir termina el vinculo, quien salio deja el presente, ni reclamable ni
 * retirable, volver como X o como un fantasma, una sola activa, la economia de
 * F9 intacta— lo mide supabase/checks/link-lifecycle.sql contra las funciones
 * reales, y CI lo ejecuta.
 */

function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = source.indexOf(to, start);
  expect(end, to).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('la migracion 50 parte de la 49 y no la toca', () => {
  it('es una migracion nueva; la 49 sigue tal cual (sin ended_at)', () => {
    expect(MIGRATION).toContain(
      '-- Esta migracion parte del estado que dejo 20260917120000 (F10/ADR-002).',
    );
    expect(PERMANENT).not.toMatch(/ended_at|departure_id|is_departed|participant_link_ended/);
  });

  it('el vinculo gana ended_at + departure_id con CHECK y FK; la unicidad pasa a ser parcial sobre los activos; una salida termina un vinculo', () => {
    expect(MIGRATION).toContain('add column ended_at     timestamptz,');
    expect(MIGRATION).toContain(
      'add column departure_id uuid references core.group_departure (id),',
    );
    expect(MIGRATION).toContain('check ((ended_at is null) = (departure_id is null));');
    expect(MIGRATION).toContain('drop constraint participant_user_link_usuario_unico_por_ambito;');
    expect(MIGRATION).toContain(
      'create unique index participant_user_link_identidad_activa_unica\n  on core.participant_user_link (scope_id, user_id) where ended_at is null;',
    );
    expect(MIGRATION).toContain(
      'create unique index participant_user_link_salida_unica\n  on core.participant_user_link (departure_id) where departure_id is not null;',
    );
  });

  it('el provisioner termina y reactiva SOLO el propio, y ya no puede borrar', () => {
    expect(MIGRATION).toContain(
      'grant update (ended_at, departure_id) on core.participant_user_link to nomey_provisioner;',
    );
    expect(MIGRATION).toMatch(
      /create policy participant_user_link_provisioner_self_end\s+on core\.participant_user_link for update to nomey_provisioner\s+using \(user_id = sec\.request_actor_id\(\)\)\s+with check \(user_id = sec\.request_actor_id\(\)\);/,
    );
    expect(MIGRATION).toContain(
      'drop policy participant_user_link_provisioner_self_delete on core.participant_user_link;',
    );
    expect(MIGRATION).toContain(
      'revoke delete on core.participant_user_link from nomey_provisioner;',
    );
  });

  it('salir TERMINA el vinculo activo, despues del aviso y antes de borrar la membresia; nunca lo borra', () => {
    const leave = slice(MIGRATION, 'create or replace function api.leave_group', '$function$;');
    expect(leave).toContain(
      'where l.user_id = v_actor and p.scope_id = v_scope and l.ended_at is null',
    );
    const order = [
      "perform sec.raise_boundary('LEAVE_BLOCKED_DEBT',",
      'sec.record_departure_novation(v_scope, v_participant, v_command)',
      'insert into core.group_departure',
      'set ended_at = d.left_at, departure_id = d.id',
      'delete from core.membership where scope_id = v_scope and user_id = v_actor;',
    ].map((s) => leave.indexOf(s));
    expect(order.every((p) => p > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(leave).not.toContain('delete from core.participant_user_link');
  });

  it('previsualizar: quien ya estuvo ve su identidad MAS RECIENTE y los sin cuenta; quien nunca estuvo, los sin cuenta', () => {
    const preview = slice(
      MIGRATION,
      'create or replace function api.preview_invitation',
      '$function$;',
    );
    expect(preview).toContain(
      'where l.scope_id = v_inv.scope_id and l.user_id = v_actor and l.ended_at is not null',
    );
    expect(preview).toContain('order by l.ended_at desc');
    expect(preview).toContain(
      "v_state := case when v_prev_id is null then 'join' else 'rejoin' end;",
    );
    expect(preview).toContain(
      "'participants', case when v_state in ('join', 'rejoin') then coalesce((",
    );
    expect(preview).toContain('sec.participant_available(p.id, v_inv.scope_id)');
  });

  it('canjear: rejoin reactiva el MISMO vinculo; claim sigue abierto; new se rehusa con identidad anterior', () => {
    const redeem = slice(
      MIGRATION,
      'create or replace function api.redeem_invitation',
      '$function$;',
    );
    expect(redeem).toContain("if v_mine is not null and v_choice = 'new' then");
    expect(redeem).toContain(
      "'ya estuviste en este grupo: vuelve con tu identidad de entonces o elige un participante sin cuenta', 409);",
    );
    const rejoin = slice(
      redeem,
      "if v_mine is not null and v_choice = 'rejoin' then",
      "if v_choice = 'rejoin' then",
    );
    expect(rejoin).toContain('set ended_at = null, departure_id = null');
    expect(rejoin).toContain('where participant_id = v_mine and user_id = v_actor;');
    expect(rejoin).not.toContain('into core.participant_user_link');
    expect(rejoin).not.toContain('into core.link_baseline');
    // Con identidad anterior y claim, se llega al camino 2a de siempre (sin REJOIN_REQUIRED).
    expect(redeem).not.toContain("if v_choice <> 'rejoin' then");
    expect(redeem).toContain("if v_choice = 'claim' then");
    expect(redeem).toContain(
      "perform sec.raise_boundary('REJOIN_NOT_AVAILABLE', 'no estuviste en este grupo', 409);",
    );
  });

  it('asociar va a la identidad ACTIVA', () => {
    const associate = slice(
      MIGRATION,
      'create or replace function api.associate_participant',
      '$function$;',
    );
    expect(associate).toContain(
      'where l.scope_id = v_scope and l.user_id = v_actor and l.ended_at is null;',
    );
  });

  it('las vistas del presente dejan fuera a las historicas; group_participant las conserva marcadas; la foto de netos coincide', () => {
    expect(MIGRATION).toContain('create function sec.participant_link_ended(p_participant uuid)');
    expect(MIGRATION).toContain('sec.participant_link_ended(p.id) as is_departed');
    const balance = slice(MIGRATION, 'create or replace view api.group_balance', ';');
    expect(balance).toContain('and not sec.participant_link_ended(p.id)');
    const profile = slice(MIGRATION, 'create or replace view api.group_profile', ';');
    expect(profile).toContain(
      'and not sec.participant_link_ended(p.id))::integer as participant_count',
    );
    const positions = slice(
      MIGRATION,
      'create or replace function sec.group_positions_text',
      '$fn$;',
    );
    expect(positions).toContain(
      'and not exists (select 1 from core.participant_user_link l where l.participant_id = p.id and l.ended_at is not null);',
    );
    expect(TYPES).toContain('is_departed: boolean | null;');
  });

  it('lo que NO cambia: retirar rehusa cualquier vinculo, disponible exige ninguno, la atribucion lee activos e historicos', () => {
    expect(MIGRATION).not.toMatch(
      /create or replace function (sec\.is_my_participant|sec\.participant_personal_scope|api\.claimed_dimension|sec\.participant_available|api\.retire_participant|sec\.record_departure_novation|sec\.my_reopened_debt)\b/,
    );
  });
});

describe('la evidencia corre contra las funciones reales', () => {
  it('link-lifecycle.sql: A–F, en rollback, y CI lo ejecuta', () => {
    for (const marker of [
      'A · estructura',
      'B · salir',
      'C · volver como Aitor',
      'D · elegir a Ana',
      'E · nuevo con identidad anterior',
      'F · salida con neto bloqueada',
    ]) {
      expect(CHECK).toContain(marker);
    }
    expect(CHECK).toContain(
      "v := pg_temp.canjear(r.aitor, 'a9d00000-0000-4000-8000-000000000132', r.token, 'claim', r.an1);",
    );
    expect(CHECK).toContain(
      "if v <> 'PARTICIPANT_ALREADY_CLAIMED' then raise exception 'B6c: otra cuenta reclamo a quien salio: %', v; end if;",
    );
    expect(CHECK).toContain(
      "if v <> 'PARTICIPANT_LINKED' then raise exception 'B6e: se retiro a quien salio: %', v; end if;",
    );
    expect(CHECK).toContain("if v <> 'REJOIN_REQUIRED' then raise exception 'E1: %', v; end if;");
    expect(CHECK).toContain(
      "if v_n <> 1 then raise exception 'D3d: identidades activas de aitor: %', v_n; end if;",
    );
    expect(CHECK).toContain(
      "if v not like 'LEAVE_BLOCKED_DEBT%' then raise exception 'F4: salio debiendo: %', v; end if;",
    );
    expect(CHECK).toContain(
      "if t <> 'DEPARTED_OBLIGATION_CHANGED' then raise exception 'F8: %', t; end if;",
    );
    expect(CHECK.trim().endsWith('rollback;')).toBe(true);
    expect(CI).toContain('supabase/checks/link-lifecycle.sql');
  });

  it('la foto de netos de las ayudas se lee como el actor, y participant-identity mide el UNIQUE parcial', () => {
    expect(HELPERS).toContain(
      'create function pg_temp.gp_expected(p_scope uuid, p_as uuid default null)',
    );
    expect(HELPERS).toContain(
      "'expected_positions', coalesce(p_positions, pg_temp.gp_expected(p_scope, p_actor)));",
    );
    expect(IDENTITY).toContain("indexname = 'participant_user_link_identidad_activa_unica'");
    expect(IDENTITY).not.toContain('add constraint participant_user_link_usuario_unico_por_ambito');
  });
});

describe('el cliente', () => {
  it('lee is_departed y lo separa de retirado: listed conserva el nombre, current es el presente', () => {
    expect(PARTICIPANTS).toContain('merged_into_participant_id,is_departed');
    expect(PARTICIPANTS).toContain('isDeparted: row.is_departed ?? false,');
    expect(PRESENCE).toContain('readonly isDeparted: boolean;');
    expect(PRESENCE).toContain(
      'export function current(one: WithPresence): boolean {\n  return listed(one) && (one.presence === null || !one.presence.isDeparted);\n}',
    );
    // listed NO cambia: los gastos anteriores lo nombran y se editan con el.
    expect(PRESENCE).toContain(
      "export function listed(one: WithPresence): boolean {\n  if (typeof one.mergedInto === 'string') return false;\n  return one.presence === null || !one.presence.isRetired;\n}",
    );
    expect(SCREEN).toContain(
      'const listedCount = participants.participants.filter(current).length;',
    );
    expect(EDIT).toContain('existing: participants.participants.filter(current).map((one) => ({');
  });

  it('«¿Quien eres?»: con identidad anterior, volver como X MAS los sin cuenta, y sin «Soy nuevo»', () => {
    expect(INVITATION).toContain("readonly membership: 'member' | 'rejoin' | 'join';");
    // La lista de participantes se pinta siempre; «Soy nuevo» solo sin identidad anterior.
    expect(PANEL).toContain('{rejoin && preview.previousParticipant !== null ? (');
    expect(PANEL).not.toContain('{rejoin ? null : (\n        <ScrollView');
    expect(PANEL).toContain('{rejoin ? null : naming && profileName === null ? (');
    expect(ES).toContain(
      "'groups.whoRejoinHint':\n    'Ya estuviste en este grupo. Vuelve con tu identidad de entonces o elige a alguien sin cuenta; lo anterior sigue siendo tuyo.',",
    );
    expect(EN).toContain(
      "'groups.joinRejoin':\n    'You were in this group before. Rejoin with your identity from then or pick someone without an account.',",
    );
  });

  it('Movimientos es una cronologia unica: la hora del pago viaja, y la mezcla es una hoja pura', () => {
    expect(PAYMENTS).toContain('effective_time');
    expect(PAYMENTS).toContain('effectiveTime: row.effective_time ?? null,');
    const code = TIMELINE.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/react|supabase/i);
    expect(TIMELINE).toContain('export function mergeTimeline(');
    expect(TIMELINE).toContain("order === 'dateDesc'");
    expect(SCREEN).toContain(
      'mergeTimeline(movements.operations, movements.payments ?? [], order)',
    );
    expect(ES).not.toContain("'group.paymentsTitle'");
  });

  it('el ADR esta aceptado y fija lo que supera y lo que conserva', () => {
    expect(ADR).toContain('- **Estado:** Aceptado (2026-09-15)');
    expect(ADR).toContain('**Supera** de [F09/ADR-010]');
    expect(ADR).toContain('**Conserva** de F10/ADR-002 la regla entera');
    expect(ADR).toContain('### §2 · Participante salido ≠ participante sin cuenta');
  });
});
