import { describe, expect, it } from 'vitest';

import LIST from '../../src/app/(tabs)/groups.tsx?raw';
import HOME from '../../src/app/(tabs)/index.tsx?raw';
import SCREEN from '../../src/app/group/[id].tsx?raw';
import CARD from '../../src/features/groups/suggested-payments-card.tsx?raw';
import PAY_ROW from '../../src/features/groups/group-payment-row.tsx?raw';
import HOOK from '../../src/features/groups/use-record-payment.ts?raw';
import ANNUL from '../../src/features/groups/use-annul-expense.ts?raw';
import MEMBERSHIP from '../../src/features/groups/use-membership.ts?raw';
import SERVICE from '../../src/features/groups/payment-service.ts?raw';
import MOVEMENTS from '../../src/features/groups/use-group-movements.ts?raw';
import NOTICES from '../../src/features/groups/membership-service.ts?raw';
import MOVEMENT from '../../src/features/personal/movement.ts?raw';
import MOVEMENT_ROW from '../../src/features/personal/movement-row.tsx?raw';
import PERSONAL from '../../src/features/personal/personal-service.ts?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import EN from '../../src/lib/i18n/messages/en.ts?raw';
import TYPES from '../../src/types/database.ts?raw';
import MIGRATION from '../../supabase/migrations/20260912170000_group_payments_and_departed.sql?raw';
import CHECK from '../../supabase/checks/group-payments-evidence.sql?raw';
import DEPARTED from '../../supabase/checks/departed-obligation-evidence.sql?raw';
import HELPERS from '../../supabase/checks/lib/group-payment-helpers.sql?raw';
import GUARD from '../../supabase/checks/group-identity-lock.sql?raw';
import RACE from '../../scripts/group-payment-race-evidence.sh?raw';
import RACE_DEPARTED from '../../scripts/departed-obligation-race-evidence.sh?raw';
import CI from '../../.github/workflows/ci.yml?raw';
import BUTTON from '../../src/ui/components/action-button.tsx?raw';
import MODEL from '../../src/features/groups/suggested-payments.ts?raw';
import REOPENED from '../../supabase/migrations/20260913120000_reopened_pair_payment.sql?raw';
import REOPENED_CHECK from '../../supabase/checks/reopened-pair-payment.sql?raw';
import GHOST from '../../supabase/migrations/20260913130000_ghost_payments_and_notices_seen.sql?raw';
import GHOST_CHECK from '../../supabase/checks/ghost-payments.sql?raw';

/**
 * PAGOS REGISTRADOS Y SALIDA SIN PENDIENTES — F09/ADR-007 v3 — Y LA OBLIGACIÓN
 * INTOCABLE DE QUIEN SALIÓ — F09/ADR-008.
 *
 * Sin renderer de React, lo estructural se fija aquí; lo contable
 * —descomposición, CAS de netos, anulación por las partes, salida bloqueada,
 * guarda del salido, carreras— lo miden los checks y los scripts contra la
 * base real, y CI los ejecuta.
 */

describe('el servidor', () => {
  it('una función de alta, sin edición; la clave y el cerrojo de identidad delante', () => {
    expect(MIGRATION).toContain('create function api.record_group_payment(payload jsonb)');
    expect(MIGRATION).toContain("'PAYMENT_NOT_EDITABLE'");
    expect(MIGRATION).toContain("'SETTLEMENT_STALE'");
    expect(MIGRATION).toContain("'PAYMENT_NOT_APPLICABLE'");
    expect(MIGRATION).toContain("'LEAVE_BLOCKED_DEBT'");
    expect(MIGRATION).toContain("'DEPARTED_OBLIGATION_CHANGED'");
    // annul_operation, record_debt_settlement y record_group_payment toman el rango 1: la guarda lo vigila.
    expect(GUARD).toContain("('api.annul_operation'),");
    expect(GUARD).toContain("('api.record_debt_settlement'),");
    expect(GUARD).toContain("('api.record_group_payment'),");
  });

  it('la evidencia es contra las funciones REALES: las ayudas sólo leen y envuelven', () => {
    expect(HELPERS).toContain('v := api.record_group_payment(v_payload);');
    expect(HELPERS).toContain('v := api.annul_operation(');
    expect(HELPERS).toContain('v := api.leave_group(');
    expect(HELPERS).not.toMatch(/insert into core\.effect|pg_temp\.gp_can_leave|simul/i);
    expect(CHECK).not.toMatch(/group-payment-sim|pg_temp\.departed_effects\(/);
    expect(DEPARTED).not.toMatch(/group-payment-sim|LA GUARDA SIMULADA/);
    // Alta retro-fechada rehusada sin escrituras parciales, y alta/modificación válidas entre activos.
    expect(DEPARTED).toContain('I ·');
    expect(DEPARTED).toContain('J ·');
    expect(CHECK.trim().endsWith('rollback;')).toBe(true);
    expect(DEPARTED.trim().endsWith('rollback;')).toBe(true);
  });

  it('las carreras corren sobre las funciones reales, en ambos órdenes, y CI las ejecuta', () => {
    expect(RACE).toContain('group-payment-helpers.sql');
    expect(RACE).not.toContain('group-payment-sim');
    expect(RACE).toContain('pg_temp.gp_leave(');
    for (const marker of ['== 1 ·', '== 2 ·', '== 3 ·', '== 4 ·', '== 5 ·']) {
      expect(RACE).toContain(marker);
    }
    expect(RACE_DEPARTED).toContain('group-payment-helpers.sql');
    for (const marker of ['== 1 ·', '== 1b ·', '== 2 ·', '== 2b ·', '== 3 ·', '== 3b ·']) {
      expect(RACE_DEPARTED).toContain(marker);
    }
    expect(RACE_DEPARTED).toContain('clave de idempotencia del alta rehusada (rollback completo)');
    expect(CI).toContain('supabase/checks/group-payments-evidence.sql');
    expect(CI).toContain('supabase/checks/departed-obligation-evidence.sql');
    expect(CI).toContain('bash scripts/group-payment-race-evidence.sh');
    expect(CI).toContain('bash scripts/departed-obligation-race-evidence.sh');
  });
});

describe('Pagos sugeridos: «Los míos», «Todos» y «Saldado»', () => {
  it('la identidad propia sale de la lectura real; las mías sin rótulo, y «Todos» despliega las demás sin duplicar', () => {
    expect(CARD).toContain('const me = balances.find((one) => one.isSelf)?.participantId ?? null;');
    expect(CARD).not.toMatch(/OptionPills|suggestMine|useState<Scope>/);
    expect(CARD).toContain('...suggestion.payments.filter(isMine),');
    expect(CARD).toContain('suggestion.payments.filter((one) => !isMine(one))');
    // Un solo control pequeño que despliega y pliega, y lo anuncia.
    expect(CARD).toContain("label={t(others ? 'group.suggestOthersHide' : 'group.suggestAll')}");
    expect(CARD).toContain('expanded={others}');
    expect(CARD).toContain('size="compact"');
    expect(BUTTON).toContain('accessibilityState={{ disabled, busy, expanded }}');
  });

  it('los pares reabiertos con quien salió llegan del servidor y sólo la parte activa los salda (excepción 2)', () => {
    // Servidor: migración propia, tope acotado, autor = parte activa, sólo el par directo.
    expect(REOPENED).toContain('create function sec.reopened_pair_cap(');
    expect(REOPENED).toContain('create function api.group_reopened_pair(p_scope uuid)');
    expect(REOPENED).toContain('and l.participant_id is distinct from v_departed');
    expect(REOPENED).toContain(
      "'con quien salio del grupo solo se salda el par directo reabierto'",
    );
    expect(REOPENED_CHECK).toContain('D3: el tope se amplio');
    expect(REOPENED_CHECK).toContain('E4');
    expect(CI).toContain('supabase/checks/reopened-pair-payment.sql');
    // Cliente: los pares entran en la propuesta como pagos fijos, marcados.
    expect(MODEL).toContain('reopened: readonly ReopenedPair[] = [],');
    expect(MODEL).toMatch(
      /fixed\.push\(\{\s*from: pair\.debtorParticipantId,\s*to: pair\.creditorParticipantId,\s*minor,\s*reopened: true,\s*\}\)/,
    );
    expect(MOVEMENTS).toContain('fetchReopenedPairs(scopeId),');
    expect(SCREEN).toContain('reopened={movements.reopened ?? []}');
    expect(SERVICE).toContain("supabase.rpc('group_reopened_pair'");
  });

  it('«Saldado» compacto sólo en las propuestas mías, bloqueado mientras se registra', () => {
    expect(CARD).toMatch(
      /onSettle !== undefined &&\s*isMine\(payment\) &&\s*\(canSettle === undefined \|\| canSettle\(payment\)\) &&\s*!settling/,
    );
    // Al menos una parte con cuenta (20260913130000): la pantalla lo decide por la lectura real (is_linked).
    expect(SCREEN).toMatch(
      /canSettle=\{\(proposal\) =>\s*linkedOf\.get\(proposal\.from\) === true \|\|\s*linkedOf\.get\(proposal\.to\) === true/,
    );
    expect(GHOST).toContain('if v_pp is null and v_pr is null then');
    expect(GHOST).toContain("or n.kind in ('payment', 'payment_annulled')");
    expect(GHOST_CHECK).toContain('F5');
    expect(CI).toContain('supabase/checks/ghost-payments.sql');
    expect(CARD).toContain('size="compact"');
    expect(CARD).toContain("label={t('group.settleAction')}");
  });

  it('la pantalla confirma, manda la foto de netos literal y relee tras escribir o caducar', () => {
    expect(SCREEN).toContain('onSettle={askPay}');
    expect(SCREEN).toContain("t('group.payBody', { from, to, amount })");
    expect(SCREEN).toContain('amountMinor: proposal.minor,');
    expect(SCREEN).toContain('balances,');
    // El motivo es el de ESTE intento (la promesa), nunca el estado capturado antes de pulsar.
    expect(SCREEN).toContain("if (outcome === 'stale') {");
    expect(SCREEN).not.toContain("payment.failure === 'stale'");
    expect(HOOK).toContain("export type PaymentOutcome = 'recorded' | PaymentFailure;");
    expect(HOOK).toContain("return 'recorded';");
    expect(HOOK).toContain('return outcome;');
    expect(HOOK).toContain('participant_id: one.participantId,');
    expect(HOOK).toContain('net: one.netMinor,');
    expect(HOOK).toContain("response.code === 'SETTLEMENT_STALE'");
    expect(HOOK).toContain("response.code === 'PAYMENT_NOT_APPLICABLE'");
    // Una clave por intención, conservada sin respuesta; nada calcula la descomposición.
    expect(HOOK).toContain('keys.current.set(intent, attempt);');
    expect(HOOK).toContain('effective_time: attempt.time,');
    expect(HOOK).not.toMatch(/settlement|novation|decompose/);
    expect(SERVICE).toContain("supabase.rpc('record_group_payment'");
  });
});

describe('el pago en el grupo y en Personal', () => {
  it('los pagos vigentes se leen con la misma lectura, fuera de los filtros, llevan su versión y van en la cronología única', () => {
    expect(MOVEMENTS).toContain('fetchGroupPayments(scopeId),');
    expect(SERVICE).toContain('version_id');
    expect(SERVICE).toContain('effective_time');
    expect(TYPES).toMatch(/group_payment: \{[\s\S]*version_id: string \| null;/);
    // Sin bloque aparte ni rótulo: «Saldado» se ordena entre los gastos por
    // fecha y hora reales (mergeTimeline), y sigue fuera de los filtros.
    expect(SCREEN).not.toContain("t('group.paymentsTitle')");
    expect(SCREEN).toContain(
      'mergeTimeline(movements.operations, movements.payments ?? [], order)',
    );
    expect(SCREEN).toContain("entry.kind === 'payment' ? (");
  });

  it('lo que el pago cerró sigue persistido y medido, pero el desplegable no lo pinta (decisión 2026-09-13)', () => {
    // El hecho, persistido al registrar con la version: no una lectura de los saldos de ahora.
    expect(MIGRATION).toContain('create table core.payment_allocation (');
    expect(MIGRATION).toContain(
      'insert into core.payment_allocation (operation_version_id, ordinal, scope_id, kind, debtor_participant_id, creditor_participant_id, amount)',
    );
    expect(MIGRATION).toContain('create view api.group_payment_allocation');
    expect(CHECK).toContain('B4d');
    expect(CHECK).toContain('J10b');
    expect(SERVICE).not.toContain(".eq('annulled', false)");
    // Presentacion: pagador/receptor, importe y fecha (titulo y cabecera), «Declarado por», anulado, papelera. Nada contable.
    expect(PAY_ROW).not.toMatch(
      /group_payment_allocation|fetchPaymentAllocation|paymentClosed|paymentHadClosed|paymentAlsoClosed|paymentNovation|paymentSettlementLine/,
    );
    expect(PAY_ROW).toContain("label={t('group.paymentDeclaredBy')}");
    expect(PAY_ROW).toContain('const deletable = party && !payment.annulled;');
    expect(PAY_ROW).toContain('style={payment.annulled ? styles.struck : undefined}');
    expect(PAY_ROW).not.toMatch(/group_balance|netMinor|proposePayments/);
    for (const key of ['group.paymentAnnulled', 'group.paymentDeclaredBy']) {
      expect(ES).toContain(`'${key}'`);
      expect(EN).toContain(`'${key}'`);
    }
    for (const key of [
      'group.paymentClosed',
      'group.paymentHadClosed',
      'group.paymentAlsoClosed',
      'group.paymentNovationLine',
    ]) {
      expect(ES).not.toContain(`'${key}'`);
    }
  });

  it('la fila del pago no tiene lápiz y ofrece eliminar a las dos partes; la anulación es la misma frontera', () => {
    expect(PAY_ROW).not.toContain('Symbols.edit');
    expect(PAY_ROW).toContain(
      'const party = me === payment.payerParticipantId || me === payment.receiverParticipantId;',
    );
    expect(PAY_ROW).toContain("label={t('group.deletePayment')}");
    expect(SCREEN).toContain('askDeletePayment(entry.payment);');
    expect(SCREEN).toContain("writer.code === 'NOT_AUTHORIZED'");
    expect(ANNUL).toContain(
      "export type Annullable = Pick<GroupOperation, 'operationId' | 'versionId'>;",
    );
  });

  it('en Personal la clase es propia: con contraparte, sin edición, eliminable, y nunca renta', () => {
    expect(PERSONAL).toContain('payment_counterpart');
    expect(MOVEMENT).toContain("if (operationClass === 'group_payment') return 'payment';");
    expect(MOVEMENT).toContain(
      "return kind === 'income' || kind === 'expense' || kind === 'payment';",
    );
    expect(MOVEMENT).toMatch(
      /export function canEdit[\s\S]*return kind === 'income' \|\| kind === 'expense';/,
    );
    expect(MOVEMENT_ROW).toContain("'home.paymentTo' : 'home.paymentFrom'");
    expect(MOVEMENT_ROW).toContain("t('home.paymentNotEditable')");
    expect(HOME).toContain("operation.operation_class === 'group_payment'");
    // Fuera de Ingresos (ni lista ni total): un pago no es renta; vive en Movimientos.
    expect(HOME).toContain(
      "const income = projected.operations.filter((op) => movementKind(op.operation_class) === 'income');",
    );
    expect(ES).toContain("'home.paymentFrom': 'Pago recibido de {name}'");
  });
});

describe('salir a neto cero (F09/ADR-007 C8)', () => {
  it('el bloqueo tiene su propio fallo y lleva a Pagos sugeridos; «Saldado» sobre inactivos ya no está', () => {
    expect(MEMBERSHIP).toContain("if (code === 'LEAVE_BLOCKED_DEBT') return 'blockedDebt';");
    // Dos pasos y el resultado devuelto, nunca leido del estado en el mismo then.
    expect(MEMBERSHIP).toContain('readonly check: (scopeId: string) => Promise<LeaveCheck>;');
    expect(MEMBERSHIP).toContain('readonly leave: (scopeId: string) => Promise<LeaveOutcome>;');
    // El bloqueo dice el motivo exacto: el NETO por pagar o por cobrar; con neto cero se sale.
    expect(MEMBERSHIP).toContain("{ readonly state: 'blocked'; readonly net: bigint }");
    expect(MEMBERSHIP).toContain(
      "return net !== 0n ? { state: 'blocked', net } : { state: 'clear' };",
    );
    expect(NOTICES).toContain(
      'export async function fetchMyNetPosition(scopeId: string): Promise<bigint> {',
    );
    expect(NOTICES).toContain(".eq('is_self', true)");
    expect(NOTICES).not.toContain('fetchMyPendingPairsNamed');
    expect(LIST).toContain("if (check.state === 'blocked') {");
    expect(LIST).toContain('leaveBlocked(scopeId, check.net);');
    expect(LIST).toContain("t('groups.leaveBlockedOwe', { amount })");
    expect(LIST).toContain("t('groups.leaveBlockedOwed', { amount })");
    expect(LIST).not.toContain('MyPendingPair');
    expect(LIST).toContain("if (outcome === 'blockedDebt') {");
    // El listado de «pares propios» de Pagos sugeridos se retiró: forzaba pagos redundantes.
    expect(MOVEMENTS).not.toContain('fetchPendingPairs');
    expect(MOVEMENTS).not.toContain('myPairs');
    expect(CARD).not.toContain('myPairs');
    expect(CARD).not.toContain('suggestOwnPairs');
    expect(SCREEN).not.toContain('myPairs=');
    expect(ES).not.toContain("'group.suggestOwnPairs'");
    expect(ES).not.toContain("'groups.leaveBlockedPairs'");
    expect(LIST).not.toContain('leaving.failure');
    expect(LIST).toContain("t('groups.leaveBlockedGo')");
    expect(SCREEN).not.toContain('useSettleParticipant');
    expect(NOTICES).toContain("'payment' | 'payment_annulled'");
  });

  it('los dos catálogos tienen los textos nuevos', () => {
    for (const key of [
      'group.suggestAll',
      'group.suggestOthersHide',
      'group.payTitle',
      'group.payBody',
      'group.payStale',
      'group.payNotApplicable',
      'group.deletePayment',
      'group.deletePaymentNotParty',
      'groups.leaveBlocked',
      'groups.leaveBlockedGo',
      'notice.payment',
      'notice.paymentAnnulled',
      'home.paymentTo',
      'home.paymentFrom',
      'home.paymentNotEditable',
      'home.deletePaymentBody',
    ]) {
      expect(ES).toContain(`'${key}'`);
      expect(EN).toContain(`'${key}'`);
    }
  });
});
