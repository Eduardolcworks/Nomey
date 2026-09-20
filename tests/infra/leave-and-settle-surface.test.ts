import { describe, expect, it } from 'vitest';

import LIST from '../../src/app/(tabs)/groups.tsx?raw';
import TABS from '../../src/app/(tabs)/_layout.tsx?raw';
import SCREEN from '../../src/app/group/[id].tsx?raw';
import EDIT from '../../src/app/edit-group.tsx?raw';
import BELL from '../../src/app/notifications.tsx?raw';
import ROW from '../../src/features/groups/group-balance-row.tsx?raw';
import CARD from '../../src/features/groups/split-participants-card.tsx?raw';
import FORM from '../../src/features/groups/shared-expense-form.tsx?raw';
import HOOKS from '../../src/features/groups/use-membership.ts?raw';
import SERVICE from '../../src/features/groups/membership-service.ts?raw';
import NOTICE from '../../src/features/groups/group-notice-card.tsx?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import MIGRATION from '../../supabase/migrations/20260911120000_leave_group_and_settle_participant.sql?raw';
import CHECK from '../../supabase/checks/leave-and-settle.sql?raw';
import CHECK_INV from '../../supabase/checks/group-invitations.sql?raw';
import LINKED from '../../supabase/migrations/20260912130000_group_participant_is_linked.sql?raw';
import PSERVICE from '../../src/features/groups/participant-service.ts?raw';

/**
 * SALIR DE UN GRUPO Y «SALDADO» — F09/ADR-003, con F09/ADR-007 C5 encima: ya no se
 * sale con pendientes, y «Saldado» sobre quien salió (`settle_participant`)
 * queda en el servidor, sin UI, para el estado heredado.
 *
 * Sin renderer de React, lo estructural se fija aquí; lo contable —membresía,
 * presencia, pares, CAS, atomicidad, idempotencia, barreras— lo mide
 * `supabase/checks/leave-and-settle.sql` contra la base real, con fixtures y
 * rollback.
 */

describe('salir del grupo', () => {
  it('sustituye a eliminar en el menú, con confirmación de las cuatro cosas', () => {
    expect(LIST).toContain("id: 'leave',");
    expect(LIST).not.toContain("id: 'delete',");
    expect(LIST).toContain("t('groups.leaveTitle', { name: displayName })");
    // Las cuatro cosas, en el catálogo, y sin presentarlo como pago.
    const body = ES.slice(ES.indexOf("'groups.leaveBody'"), ES.indexOf("'groups.leaveConfirm'"));
    expect(body).toContain('grupos activos');
    expect(body).toContain('permanecerán en Personal');
    expect(body).toContain('Deudas de Personal');
    expect(body).toContain('conservarán el historial');
    expect(body).not.toMatch(/pag|liquid|condon/i);
  });

  it('va directo a la frontera, con una clave por grupo, y publica en el bus', () => {
    expect(SERVICE).toContain("supabase.rpc('leave_group'");
    expect(HOOKS).toContain('key.current = { scopeId, id: newClientOperationId() };');
    expect(HOOKS).toContain('publishGroupRecorded(scopeId);');
    expect(HOOKS).not.toContain('queueStore');
  });

  it('el servidor borra UNA membresía, cierra la presencia HOY y no toca efectos ni vínculo', () => {
    expect(MIGRATION).toContain(
      'delete from core.membership where scope_id = v_scope and user_id = v_actor;',
    );
    expect(MIGRATION).toContain('set valid_until = current_date');
    expect(MIGRATION).toContain('insert into core.group_departure');
    const salir = MIGRATION.slice(
      MIGRATION.indexOf('create function api.leave_group'),
      MIGRATION.indexOf('create function api.settle_participant'),
    );
    expect(salir).not.toContain('core.effect');
    expect(salir).not.toContain('core.operation');
    expect(salir).not.toContain('lock_scopes');
    expect(MIGRATION).not.toMatch(/delete from core\.participant_user_link/);
    // El mismo día: el periodo vacío es admisible.
    expect(MIGRATION).toContain('check (valid_until is null or valid_until >= valid_from)');
    expect(CHECK).toContain('D · crear y salir el mismo dia');
  });
});

describe('inactivo y retirado en el cliente', () => {
  it('la presencia publicada decide: se lista, se propone, se puede elegir', () => {
    expect(FORM).toContain('const shown = participants.filter(listed);');
    expect(FORM).toContain('shown.filter(activeByDefault)');
    expect(FORM).toContain('shown.filter((one) => eligibleOn(one, current.date))');
    expect(CARD).toContain('eligible={eligibleOn(one, draft.date)}');
    expect(CARD).toContain("t('group.participantInactive')");
    // Quien salió con cuenta es historia (F10/ADR-003): fuera de la lista de edición.
    expect(EDIT).toContain('participants.participants.filter(current)');
  });

  it('en Saldos, «Inactivo» es texto; «Saldado» sobre quien salió ya no se ofrece (F09/ADR-007)', () => {
    expect(ROW).toContain("t('group.participantInactive')");
    // La fila conserva la puerta (`onSettle`), y la pantalla no la abre: sin
    // salida con pendientes no hay a quién dar por saldado.
    expect(ROW).toContain('onSettle === undefined ? null');
    expect(SCREEN).not.toMatch(/onSettle=\{\s*inactive/);
    expect(SCREEN).not.toContain('useSettleParticipant');
    // El contador y la lista no cuentan a los retirados ni a quien salió con cuenta; sus nombres siguen.
    expect(SCREEN).toContain(
      'const listedCount = participants.participants.filter(current).length;',
    );
    expect(MIGRATION).toContain(
      'and not exists (select 1 from core.participant_retirement r where r.participant_id = p.id))::integer as participant_count',
    );
  });
});

describe('«Saldado» (settle_participant, sin UI desde F09/ADR-007)', () => {
  it('el hook y el servicio siguen mandando exactamente los pares enseñados', () => {
    expect(HOOKS).toContain('expected_pairs: expected,');
    expect(SERVICE).toContain("supabase.rpc('settle_participant'");
    // Retirar a quien no tiene cuenta (F09/ADR-005) sí sigue en la pantalla, por la misma puerta.
    expect(SCREEN).toContain("fetchPendingPairs(id ?? '', participantId)");
    expect(SCREEN).toContain("t('group.settlePair', {");
    expect(SCREEN).toContain('useRetireParticipant');
  });

  it('caducada se rechaza; nada se salda sin revisar', () => {
    expect(HOOKS).toContain("response.code === 'SETTLEMENT_STALE'");
    expect(SCREEN).toContain("if (outcome === 'stale') {");
    expect(SCREEN).not.toContain("retirement.failure === 'stale'");
    expect(MIGRATION).toContain("'SETTLEMENT_STALE'");
  });

  it('el check siembra la salida con pendientes como ESTADO HEREDADO y prueba que la real la rehusa', () => {
    expect(CHECK).toContain('pg_temp.salida_heredada(');
    expect(CHECK).toContain("'LEAVE_BLOCKED_DEBT'");
    expect(CHECK).toContain('B1i la salida rehusada dejo su clave');
    expect(CHECK).toContain("'DEPARTED_OBLIGATION_CHANGED'");
  });

  it('el servidor: un efecto de deuda por par, ninguno de caja, retiro explícito, sin operación a cero', () => {
    expect(MIGRATION).toContain("'participant_settlement'");
    expect(MIGRATION).toContain('insert into core.participant_retirement');
    expect(MIGRATION).toContain('cero pendiente no es una liquidacion de cero');
    expect(MIGRATION).toContain('perform sec.lock_scopes(array[v_scope]);');
    expect(CHECK).toContain('G4d «Saldado» escribio caja o gasto');
    expect(CHECK).toContain('I1b la retirada a cero fabrico una operacion');
  });

  it('las barreras viven en el servidor: inactivo sin liquidaciones, retirado sin deuda nueva', () => {
    expect(MIGRATION).toContain('sec.assert_participant_active(v_debtor,   v_scope);');
    expect(MIGRATION).toContain('sec.assert_participant_not_retired(v_payer_scope, v_scope);');
    expect(MIGRATION).toContain('sec.assert_retired_debt_unchanged(v_version, v_expected);');
    expect(MIGRATION).toContain('sec.assert_no_retired_debt(v_expected);');
    expect(CHECK).toContain("'PARTICIPANT_INACTIVE'");
    expect(CHECK).toContain('H3 cambiar concepto y hora de E1 con Ana retirada');
  });
});

describe('quién tiene cuenta, en Saldos', () => {
  it('el dato es un booleano por un definer reducido: el hecho, nunca cuál', () => {
    expect(LINKED).toContain('create function sec.participant_is_linked(p_participant uuid)');
    expect(LINKED).toContain('returns boolean');
    expect(LINKED).toContain('and sec.is_member(p.scope_id)');
    expect(LINKED).toContain('sec.participant_is_linked(p.id) as is_linked');
    expect(LINKED.replace(/--.*$/gm, '')).not.toMatch(/user_id as|l\.user_id as/);
    expect(PSERVICE).toContain('isLinked: row.is_linked ?? null,');
    // No es is_self, y no se deduce del nombre ni de la presencia.
    expect(PSERVICE).toContain('readonly isLinked: boolean | null;');
    expect(PSERVICE).toContain('readonly isSelf: boolean | null;');
    expect(SCREEN).toContain('linked={linkedOf.get(balance.participantId) === true}');
    expect(SCREEN).not.toMatch(/linked=\{[^}]*(isSelf|displayName|isActive)/);
  });

  it('borde amarillo sólo con cuenta Y activo, con «Con cuenta» en la etiqueta; el inactivo sigue igual', () => {
    expect(ROW).toContain('const withAccount = linked && !inactive;');
    expect(ROW).toContain('withAccount ? { borderWidth: 1.5, borderColor: theme.accent } : null');
    expect(ROW).toContain("withAccount ? t('group.participantLinked') : null");
    // Sin halo ni cambio de tamaño: el círculo sigue midiendo lo mismo.
    expect(ROW).toMatch(/badge: \{\s*width: 32,\s*height: 32,/);
    expect(ROW).not.toMatch(/shadow|boxShadow|elevation/);
    expect(CHECK_INV).toContain('G3 reclamada que salio');
    expect(CHECK_INV).toContain('G4 nuevo con cuenta');
    expect(CHECK_INV).toContain('G5 is_linked se confunde con is_self');
  });
});

describe('Personal y los avisos', () => {
  it('la deuda sale del seguimiento por membresía en las dos superficies; el contexto llega por un definer sin parámetros', () => {
    expect(MIGRATION).toMatch(
      /'debt'[\s\S]*sec\.is_member\(e\.scope_id\)[\s\S]*'debt'[\s\S]*sec\.is_member\(e\.scope_id\)/,
    );
    expect(MIGRATION).toContain('create function sec.my_group_expense_context()');
    expect(MIGRATION).toContain(
      'left join sec.my_group_expense_context() ctx on ctx.operation_id = o.id',
    );
    expect(CHECK).toContain('C1 la fila de Luis tras salir');
  });

  it('la campana suma incidencias y avisos, y un aviso abre el grupo y se marca leído', () => {
    // Desde la tanda de la campana el punto lee lo NO VISTO (bell-surface).
    expect(TABS).toContain(
      'const bell = incidents.unseen > 0 || notices.unread > 0 || proposals.incoming.length > 0;',
    );
    expect(BELL).toContain('<GroupNoticeCard');
    expect(BELL).toContain('void notices.markRead(id);');
    expect(NOTICE).not.toMatch(/amount|money\(/);
    expect(SERVICE).toContain("supabase.rpc('mark_group_notice_read'");
    // Una relación de avisos, política por is_me Y is_member, migrando los que había.
    expect(MIGRATION).toContain('create table core.group_notice');
    expect(MIGRATION).toContain(
      'using (sec.is_me(recipient_user_id) and sec.is_member(scope_id));',
    );
    expect(MIGRATION).toContain('from core.group_edit_notice;');
    expect(MIGRATION).toContain('from core.group_profile_notice;');
  });
});
