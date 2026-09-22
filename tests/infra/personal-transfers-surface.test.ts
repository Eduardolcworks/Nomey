import { describe, expect, it } from 'vitest';

import LAYOUT from '../../src/app/_layout.tsx?raw';
import TABS from '../../src/app/(tabs)/_layout.tsx?raw';
import HOME from '../../src/app/(tabs)/index.tsx?raw';
import ADD from '../../src/app/add.tsx?raw';
import BELL from '../../src/app/notifications.tsx?raw';
import GROUP from '../../src/app/group/[id].tsx?raw';
import SELECTOR from '../../src/features/personal/interval-selector.tsx?raw';
import FORM from '../../src/features/personal/movement-form.tsx?raw';
import INDEX from '../../src/features/transfers/index.ts?raw';
import DECLINED_SEEN from '../../src/features/transfers/declined-seen.ts?raw';
import CARD from '../../src/features/transfers/proposal-card.tsx?raw';
import FIELD from '../../src/features/transfers/recipient-field.tsx?raw';
import ERRORS from '../../src/features/transfers/transfer-errors.ts?raw';
import EVENTS from '../../src/features/transfers/transfer-events.ts?raw';
import TRANSFER_FORM from '../../src/features/transfers/transfer-form.tsx?raw';
import ROW from '../../src/features/transfers/transfer-row.tsx?raw';
import SERVICE from '../../src/features/transfers/transfer-service.ts?raw';
import CREATE from '../../src/features/transfers/use-create-proposal.ts?raw';
import PROPOSALS from '../../src/features/transfers/use-my-proposals.ts?raw';
import TRANSFERS from '../../src/features/transfers/use-my-transfers.ts?raw';
import DECLINES from '../../src/features/transfers/use-declined-notices.ts?raw';
import ACTIONS from '../../src/features/transfers/use-proposal-actions.ts?raw';
import RESOLVE from '../../src/features/transfers/use-resolve-recipient.ts?raw';

/**
 * F12.C1 — the Personal transfer, as the client wires it (F12/ADR-002).
 *
 * What these pins guard is the CONTRACT, not the prose: that nothing here
 * goes through the offline queue, that acceptance sends only the proposal
 * id, that direction and counterpart never come from `created_by`, that the
 * receiver's list is exactly what the view publishes, that the recipient is
 * resolved once and on demand, and that the composition happens in the
 * routes and not across features.
 *
 * And what the client does NOT have, by product decision: the payment
 * requests by link of F12/ADR-004 have their backend (F12.B2) and no screen;
 * the only pending centre is Notifications, and the only way of addressing
 * a transfer is an `@username`.
 */

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('la feature y sus costuras', () => {
  it('features/transfers no importa a otra feature, y nadie la importa desde una feature', () => {
    for (const source of [
      INDEX,
      SERVICE,
      EVENTS,
      CREATE,
      PROPOSALS,
      TRANSFERS,
      ACTIONS,
      RESOLVE,
      TRANSFER_FORM,
      FIELD,
      CARD,
      ROW,
    ]) {
      expect(code(source)).not.toMatch(/from '@\/features\/(personal|groups|auth|session|shell)/);
    }
    expect(code(FORM)).not.toContain('@/features/transfers');
  });

  it('el único fichero que habla con Supabase es el servicio, y nada va por la cola de F7', () => {
    for (const source of [
      CREATE,
      PROPOSALS,
      TRANSFERS,
      ACTIONS,
      RESOLVE,
      TRANSFER_FORM,
      CARD,
      ROW,
    ]) {
      expect(code(source)).not.toContain('@/lib/supabase');
      expect(code(source)).not.toContain('@/lib/offline');
    }
    expect(code(SERVICE)).toContain("import { supabase } from '@/lib/supabase';");
    expect(code(INDEX)).not.toContain('offline');
  });

  it('el segmento Transferencia del formulario de Personal lo compone la ruta, por un slot', () => {
    expect(FORM).toContain('transfer?: (shared: TransferSlot) => ReactNode;');
    expect(FORM).toContain("if (draft.kind === 'transfer' && transfer !== undefined) {");
    expect(ADD).toContain("import { TransferForm } from '@/features/transfers';");
    expect(ADD).toContain('transfer={(shared) => (');
    expect(ADD).toContain('guest={isGuest(session)}');
  });
});

describe('la hoja del +: Gasto | Ingreso | Transferencia, y el importe es uno', () => {
  it('el selector tiene tres segmentos y ninguno es una solicitud', () => {
    expect(FORM).not.toContain("'request'");
    expect(code(ADD)).not.toMatch(/mode|TransferMode|Enlace|link/);
  });

  it('el importe y el concepto son del borrador del +: una sola fuente, sin copias ni efectos', () => {
    expect(FORM).toContain('entry: draft.entry,\n          setEntry: draft.setEntry,');
    expect(FORM).toContain('concept: draft.concept,\n          setConcept: draft.setConcept,');
    expect(ADD).toContain('entry={shared.entry}');
    expect(ADD).toContain('onChangeEntry={shared.setEntry}');
    expect(ADD).toContain('concept={shared.concept}');
    expect(ADD).toContain('onChangeConcept={shared.setConcept}');
    // The transfer form owns no amount and no concept, and syncs nothing.
    expect(code(TRANSFER_FORM)).not.toMatch(/useState<AmountEntry>|EMPTY_AMOUNT|useEffect/);
    expect(TRANSFER_FORM).toContain('readonly entry: AmountEntry;');
    expect(TRANSFER_FORM).toContain('onChangeText={onChangeConcept}');
  });

  it('Transferencia es importe, concepto, @username y Proponer: sin Usuario | Enlace', () => {
    // The concept well comes before the recipient field, both under the amount.
    expect(TRANSFER_FORM.indexOf('onChangeText={onChangeConcept}')).toBeLessThan(
      TRANSFER_FORM.indexOf('<RecipientField'),
    );
    expect(TRANSFER_FORM).toContain("saveLabel={t('transfer.proposeAction')}");
    expect(code(TRANSFER_FORM)).not.toMatch(/OptionPills|TransferMode|mode ===|modeLink|modeUser/);
  });
});

describe('el destinatario', () => {
  it('se resuelve con resolve_username, una vez y a demanda, nunca por tecla', () => {
    expect(SERVICE).toContain("supabase.rpc('resolve_username'");
    expect(code(RESOLVE)).not.toMatch(/setTimeout|debounce/);
    expect(RESOLVE).toContain('const search = useCallback(() => {');
    expect(RESOLVE).toContain('if (!recipientStale(current, next)) return current;');
  });

  it('la regla del handle es la de domain/username, sin duplicarla', () => {
    expect(code(FIELD)).not.toMatch(/\[a-z\]\(_\?/);
    expect(code(TRANSFER_FORM)).not.toMatch(/\[a-z\]\(_\?/);
    expect(FIELD).not.toContain('@/features/auth');
  });

  it('los cuatro estados del resolver tienen su frase y el found enseña nombre y @handle', () => {
    for (const state of ['not_found', 'throttled', 'self']) {
      expect(FIELD).toContain(`${state}:`);
    }
    expect(FIELD).toContain('<IdentityLine');
    expect(FIELD).toContain('name={state.publicName}');
    expect(FIELD).toContain('handle={state.handle}');
  });

  it('la X limpia sólo el destinatario: el importe y el concepto no son de este formulario', () => {
    expect(TRANSFER_FORM).toContain(
      'onChange={() => {\n              lookup.reset();\n            }}',
    );
    expect(code(TRANSFER_FORM)).not.toMatch(/onChangeEntry\(EMPTY|onChangeConcept\(''\)/);
  });
});

describe('proponer', () => {
  it('el botón propone, la confirmación dice que la otra parte acepta, y nada se guarda en local', () => {
    expect(TRANSFER_FORM).toContain("saveLabel={t('transfer.proposeAction')}");
    expect(TRANSFER_FORM).toContain("setPhase({ kind: 'confirm' });");
    expect(TRANSFER_FORM).toContain("t('transfer.confirmNote', { name: recipient.publicName })");
    expect(code(TRANSFER_FORM)).not.toMatch(/enqueue|AsyncStorage|SecureStore|catalogue/);
  });

  it('la clave de comando es por intención y sólo sobrevive a un fallo de transporte', () => {
    expect(CREATE).toContain('const intent = JSON.stringify([');
    expect(CREATE).toContain('client_command_id: key,');
    expect(CREATE).toContain("if (reason !== 'offline') keys.current.delete(intent);");
    expect(CREATE).toContain(
      "if (result.data.state === 'not_found') return { kind: 'not_found' };",
    );
  });

  it('un invitado ve el aviso y no llama a nada', () => {
    expect(TRANSFER_FORM).toContain('if (guest) {');
    expect(TRANSFER_FORM.indexOf('if (guest) {')).toBeLessThan(
      TRANSFER_FORM.indexOf('<AmountSheet'),
    );
    expect(TRANSFER_FORM).toContain("t('transfer.guestAction')");
  });

  it('«Ver pendientes» lleva a Notificaciones: el único centro de pendientes', () => {
    expect(ADD).toContain("router.replace('/notifications');");
    expect(TRANSFER_FORM).toContain("t('transfer.seeProposals')");
  });
});

describe('aceptar, rechazar, cancelar', () => {
  it('aceptar es record_internal_transfer con proposal_id y nada más, con clave por propuesta', () => {
    expect(SERVICE).toContain("supabase.rpc('record_internal_transfer'");
    expect(ACTIONS).toContain('client_operation_id: chosen,');
    expect(ACTIONS).toContain('proposal_id: proposalId,');
    expect(code(ACTIONS)).not.toMatch(/amount|currency|effective_date/);
    expect(ACTIONS).toContain("if (reason !== 'offline') acceptKeys.current.delete(proposalId);");
  });

  it('rechazar y cancelar mandan sólo el id, y una transición ajena repinta en vez de fallar', () => {
    expect(SERVICE).toContain('payload: { proposal_id: proposalId } as never,');
    expect(ACTIONS).toContain("if (reason !== 'offline') publishTransfersChanged();");
    expect(BELL).toContain('stateAfterRefusal(outcome.failure)');
  });

  it('cada acción pide confirmación antes de llamar, en Notificaciones', () => {
    for (const key of ['transfer.acceptTitle', 'transfer.declineTitle', 'transfer.cancelTitle']) {
      expect(BELL).toContain(`t('${key}')`);
    }
    expect(BELL).toContain('void actions.accept(proposal.proposalId).then(explainProposal);');
    expect(BELL).toContain('void actions.decline(proposal.proposalId).then(explainProposal);');
    expect(BELL).toContain('void actions.cancel(proposal.proposalId).then(explainProposal);');
  });
});

describe('Notificaciones, el centro de pendientes', () => {
  it('lista las entrantes pendientes con Aceptar y Rechazar, y las salientes pendientes con Cancelar', () => {
    expect(BELL).toContain(
      '{[...proposals.incoming, ...proposals.sent, ...shownDeclines].map((proposal) => (',
    );
    expect(BELL).toContain('onCancel={() => {\n                cancelProposal(proposal);');
    // The card decides by direction and state: incoming → accept/decline, outgoing → cancel.
    expect(CARD).toContain('{isActionable(proposal) ? (');
    expect(CARD).toContain(') : isCancellable(proposal) ? (');
    expect(CARD).toContain("label={t('transfer.cancel')}");
    expect(CARD).toContain("? 'transfer.cardIncoming'");
    expect(CARD).toContain(": 'transfer.cardOutgoing',");
    expect(CARD).toContain('`${proposal.counterpartPublicName} · @${proposal.counterpartHandle}`');
  });

  it('sólo lo pendiente: lo terminal desaparece, y lo aceptado es un movimiento en Inicio', () => {
    expect(PROPOSALS).toContain('incoming: incomingPending(rows),');
    expect(PROPOSALS).toContain('sent: outgoingPending(rows),');
    expect(PROPOSALS).toContain('newestFirst(stillRelevant(loaded, new Date().toISOString()))');
    expect(PROPOSALS).toContain('subscribeProposalSettled((proposalId) => {');
    expect(PROPOSALS).toContain('(one) => !settled.has(one.proposalId),');
    expect(ACTIONS).toContain('publishProposalSettled(proposalId);');
    expect(code(PROPOSALS)).not.toMatch(/AsyncStorage|SecureStore|catalogue|sqlite/i);
    expect(code(TRANSFERS)).not.toMatch(/AsyncStorage|SecureStore|catalogue|sqlite/i);
  });

  it('la campana: acción pendiente (entrantes) O novedad no vista (rechazos), y abrir Notificaciones sólo apaga la segunda', () => {
    for (const source of [TABS, GROUP]) {
      expect(source).toContain(
        'const bell =\n    incidents.unseen > 0 ||\n    notices.unread > 0 ||\n    proposals.incoming.length > 0 ||\n    declined.unseen.length > 0 ||\n    friends.incoming.length > 0;',
      );
      expect(code(source)).not.toMatch(/proposals\.sent|proposals\.declined\.length/);
    }
    // No seen/read mark for PENDING proposals anywhere: that dot is a fact about the list.
    for (const source of [PROPOSALS, ACTIONS, CARD]) {
      expect(code(source)).not.toMatch(/markSeen|markRead|unread|seenAt|readAt/i);
    }
    const bellCode = code(BELL);
    expect(bellCode).not.toMatch(/proposals\.(markSeen|markRead)/);
    // The only mark Notifications writes for transfers is the declines', once,
    // for exactly what was unseen on entry.
    expect(BELL).toContain(
      'if (freshDeclines.size > 0) void markDeclinesSeen([...freshDeclines]);',
    );
    expect(BELL).toContain(
      'setFreshDeclines(new Set(declines.unseen.map((one) => one.proposalId)));',
    );
    expect(bellCode).not.toMatch(/markDeclinesSeen\([^)]*(incoming|sent)/);
  });

  it('el rechazo propio es una novedad sin acción: copy, sin botones, y sólo mientras sea reciente', () => {
    // The list keeps pending rows and RECENT declines of one's own, nothing else terminal.
    expect(PROPOSALS).toContain('newestFirst(stillRelevant(loaded, new Date().toISOString()))');
    expect(PROPOSALS).toContain(
      "declined: rows.filter((one) => one.direction === 'outgoing' && one.state === 'declined'),",
    );
    // The card says who said no, and offers nothing to do about it.
    expect(CARD).toContain("? 'transfer.cardDeclined'");
    expect(CARD).toContain("const declined = !incoming && proposal.state === 'declined';");
    expect(CARD).toContain('{isActionable(proposal) ? (');
    expect(CARD).toContain(') : isCancellable(proposal) ? (');
    // Shown after the pending ones, during the visit that marked them seen.
    expect(BELL).toContain(
      '{[...proposals.incoming, ...proposals.sent, ...shownDeclines].map((proposal) => (',
    );
    expect(BELL).toContain(
      'const shownDeclines = proposals.declined.filter((one) => freshDeclines?.has(one.proposalId));',
    );
  });

  it('la marca de visto guarda ids por actor en el documento opaco, nunca un importe', () => {
    expect(DECLINED_SEEN).toContain("export const DECLINED_SEEN_KEY = 'transfer.declined.seen';");
    expect(DECLINED_SEEN).toContain('return JSON.stringify([...seen].sort());');
    expect(code(DECLINED_SEEN)).not.toMatch(/amount|currency|balance|counterpart/i);
    expect(DECLINES).toContain("import { offlineCatalogueCache } from '@/lib/offline';");
    expect(code(DECLINES)).not.toMatch(/amount|AsyncStorage|SecureStore|supabase/i);
    // The server list stays a server list: no cache of proposals anywhere.
    expect(code(PROPOSALS)).not.toMatch(/AsyncStorage|SecureStore|catalogue|sqlite/i);
  });

  it('no hay pantalla /transfers, ni banner, ni botón ⇄ en Inicio', () => {
    expect(LAYOUT).not.toContain('name="transfers"');
    expect(code(LAYOUT)).not.toMatch(/name="pay"|name="share-request"/);
    for (const source of [HOME, ADD, BELL, TABS, LAYOUT, TRANSFER_FORM]) {
      expect(code(source)).not.toMatch(/'\/transfers'|'\/pay'|'\/share-request'/);
    }
    expect(HOME).not.toContain('PendingTransfersBanner');
    expect(code(HOME)).not.toMatch(/useMyProposals|transfers=\{\{/);
    expect(code(SELECTOR)).not.toMatch(/transfers|Symbols\.transfer|dot/);
    expect(code(INDEX)).not.toMatch(/pending-banner|PendingTransfersBanner/);
  });
});

describe('lo que el cliente no tiene: solicitudes de pago por enlace (F12/ADR-004)', () => {
  it('ninguna llamada a los comandos de B2, ningún bearer, ningún enlace de pago', () => {
    for (const source of [
      INDEX,
      SERVICE,
      ERRORS,
      TRANSFER_FORM,
      CARD,
      ROW,
      ADD,
      BELL,
      HOME,
      LAYOUT,
      TABS,
    ]) {
      const clean = code(source);
      expect(clean).not.toMatch(
        /create_payment_request|preview_payment_request|cancel_payment_request|payment_request_token/,
      );
      expect(clean).not.toMatch(
        /expo-secure-store|Share\.share|Clipboard|QrCode|paymentRequestLink/,
      );
      // Push stays deferred: the inbox is internal, nothing registers a device.
      expect(clean).not.toMatch(/expo-notifications|PushToken|apns|fcm/i);
    }
    expect(ERRORS).not.toContain('PAYMENT_REQUEST');
    expect(ERRORS).not.toContain("'paid'");
  });

  it('my_transfers sigue leyéndose entera: la columna de B2 se parsea y no se enseña', () => {
    // The view's contract (F12.B2) carries `payment_request_id`; the parser
    // keeps it defensively and no row reads it.
    expect(SERVICE).toContain('payment_request_id');
    expect(code(ROW)).not.toContain('paymentRequestId');
  });
});

describe('lo que se enseña, y de dónde', () => {
  it('la dirección y la contraparte vienen de la vista; created_by no existe en el cliente', () => {
    for (const source of [CARD, ROW, PROPOSALS, TRANSFERS, SERVICE, HOME, BELL]) {
      expect(code(source)).not.toContain('created_by');
      expect(code(source)).not.toContain('createdBy');
    }
    expect(CARD).toContain("const incoming = proposal.direction === 'incoming';");
    expect(ROW).toContain("const incoming = transfer.direction === 'incoming';");
  });

  it('la fila de transferencia dice quién y cuánto, y no se edita ni se borra', () => {
    expect(ROW).toContain("t(incoming ? 'transfer.rowIncoming' : 'transfer.rowOutgoing', {");
    expect(code(ROW)).not.toMatch(/SwipeToDelete|onEdit|onDelete|Symbols\.edit|Symbols\.delete/);
    expect(ROW).toContain("t('transfer.rowFinal')");
  });

  it('Inicio intercala my_transfers en la actividad, por su instante, y relee el Disponible al cambiar algo', () => {
    expect(HOME).toContain('const transfers = useMyTransfers(');
    expect(HOME).toContain('const activity = interleaveActivity(');
    expect(HOME).toContain('...transferMoment(transfer),');
    expect(HOME).toContain('projected.operations.length < projected.total,');
    expect(HOME).toContain(
      'useEffect(() => subscribeTransfersChanged(refreshHome), [refreshHome]);',
    );
  });
});

describe('refrescar sin sondear', () => {
  it('foreground por el único seam, evento in-process tras cada acción, y foco al volver', () => {
    expect(LAYOUT).toMatch(/wakeQueue\(\);\s*wakeIdentity\(\);\s*wakeTransfers\(\);/);
    expect(EVENTS).toContain('export function wakeTransfers(): void {');
    expect(EVENTS).toContain('export function publishTransfersChanged(): void {');
    expect(code(EVENTS)).not.toMatch(/AppState|setInterval/);
    expect(PROPOSALS).toContain('onTransfersWake(() => {');
    expect(TRANSFERS).toContain('onTransfersWake(() => {');
    expect(HOME).toContain('useRefreshOnReturn(transfers.refresh);');
    for (const source of [PROPOSALS, TRANSFERS, EVENTS, RESOLVE]) {
      expect(code(source)).not.toContain('setInterval');
    }
  });
});
