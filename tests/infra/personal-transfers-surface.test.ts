import { describe, expect, it } from 'vitest';

import LAYOUT from '../../src/app/_layout.tsx?raw';
import TABS from '../../src/app/(tabs)/_layout.tsx?raw';
import HOME from '../../src/app/(tabs)/index.tsx?raw';
import ADD from '../../src/app/add.tsx?raw';
import BELL from '../../src/app/notifications.tsx?raw';
import SCREEN from '../../src/app/transfers.tsx?raw';
import FORM from '../../src/features/personal/movement-form.tsx?raw';
import INDEX from '../../src/features/transfers/index.ts?raw';
import BANNER from '../../src/features/transfers/pending-banner.tsx?raw';
import CARD from '../../src/features/transfers/proposal-card.tsx?raw';
import FIELD from '../../src/features/transfers/recipient-field.tsx?raw';
import EVENTS from '../../src/features/transfers/transfer-events.ts?raw';
import TRANSFER_FORM from '../../src/features/transfers/transfer-form.tsx?raw';
import ROW from '../../src/features/transfers/transfer-row.tsx?raw';
import SERVICE from '../../src/features/transfers/transfer-service.ts?raw';
import CREATE from '../../src/features/transfers/use-create-proposal.ts?raw';
import PROPOSALS from '../../src/features/transfers/use-my-proposals.ts?raw';
import TRANSFERS from '../../src/features/transfers/use-my-transfers.ts?raw';
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
      BANNER,
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
    expect(FORM).toContain('transfer?: ReactNode;');
    expect(FORM).toContain("if (draft.kind === 'transfer' && transfer !== undefined) {");
    expect(ADD).toContain("import { TransferForm } from '@/features/transfers';");
    expect(ADD).toContain('transfer={');
    expect(ADD).toContain('guest={isGuest(session)}');
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
    expect(SCREEN).toContain('stateAfterRefusal(failure)');
    expect(BELL).toContain('stateAfterRefusal(outcome.failure)');
  });

  it('cada acción pide confirmación antes de llamar', () => {
    for (const key of ['transfer.acceptTitle', 'transfer.declineTitle', 'transfer.cancelTitle']) {
      expect(SCREEN).toContain(`t('${key}')`);
    }
    expect(BELL).toContain("t('transfer.acceptTitle')");
    expect(BELL).toContain("t('transfer.declineTitle')");
  });
});

describe('lo que se enseña, y de dónde', () => {
  it('la dirección y la contraparte vienen de la vista; created_by no existe en el cliente', () => {
    for (const source of [CARD, ROW, PROPOSALS, TRANSFERS, SERVICE, SCREEN, HOME, BELL]) {
      expect(code(source)).not.toContain('created_by');
      expect(code(source)).not.toContain('createdBy');
    }
    expect(CARD).toContain("const incoming = proposal.direction === 'incoming';");
    expect(ROW).toContain("const incoming = transfer.direction === 'incoming';");
  });

  it('las recibidas son las que devuelve la vista, y no se inventa histórico', () => {
    expect(PROPOSALS).toContain('incoming: incomingPending(rows),');
    // Y de lo enviado, sólo lo pendiente: la pantalla no es un histórico.
    expect(PROPOSALS).toContain('sent: outgoingPending(rows),');
    expect(PROPOSALS).toContain('newestFirst(stillRelevant(loaded))');
    // Lo que se acaba de resolver desde este aparato sale de la lista antes
    // de que vuelva la recarga, y ésta no lo trae de vuelta como pendiente.
    expect(PROPOSALS).toContain('subscribeProposalSettled((proposalId) => {');
    expect(PROPOSALS).toContain('(one) => !settled.has(one.proposalId),');
    expect(ACTIONS).toContain('publishProposalSettled(proposalId);');
    expect(code(PROPOSALS)).not.toMatch(/AsyncStorage|SecureStore|catalogue|sqlite/i);
    expect(code(TRANSFERS)).not.toMatch(/AsyncStorage|SecureStore|catalogue|sqlite/i);
  });

  it('la campana enseña sólo las entrantes pendientes, y el punto se enciende con ellas', () => {
    expect(BELL).toContain('proposals.incoming.map((proposal) => (');
    expect(BELL).not.toContain('proposals.sent');
    expect(TABS).toContain(
      'const bell = incidents.unseen > 0 || notices.unread > 0 || proposals.incoming.length > 0;',
    );
  });

  it('la fila de transferencia no se edita ni se borra', () => {
    expect(code(ROW)).not.toMatch(/SwipeToDelete|onEdit|onDelete|Symbols\.edit|Symbols\.delete/);
    expect(ROW).toContain("t('transfer.rowFinal')");
  });

  it('Inicio intercala my_transfers en la actividad y relee el Disponible al cambiar algo', () => {
    expect(HOME).toContain('const transfers = useMyTransfers(');
    expect(HOME).toContain('const activity = interleaveActivity(');
    expect(HOME).toContain('projected.operations.length < projected.total,');
    expect(HOME).toContain(
      'useEffect(() => subscribeTransfersChanged(refreshHome), [refreshHome]);',
    );
    expect(HOME).toContain('<PendingTransfersBanner');
  });

  it('la pantalla de propuestas está en la rama protegida y no se persiste nada de ella', () => {
    expect(LAYOUT).toContain('<Stack.Screen name="transfers" />');
    expect(SCREEN).toContain('<PlaceholderScreen title="nav.transfers">');
    expect(SCREEN).toContain("t('transfer.sectionIncoming')");
    expect(SCREEN).toContain("t('transfer.sectionSent')");
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
    expect(SCREEN).toContain('useRefreshOnReturn(proposals.refresh);');
    expect(HOME).toContain('useRefreshOnReturn(transfers.refresh);');
    for (const source of [PROPOSALS, TRANSFERS, EVENTS, RESOLVE]) {
      expect(code(source)).not.toContain('setInterval');
    }
  });
});
