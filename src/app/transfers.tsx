import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { currencyDefinition, moneyFromMinorString } from '@/domain';
import { readyScope, usePersonalScope } from '@/features/personal';
import { isGuest, useSession } from '@/features/session';
import { PlaceholderScreen } from '@/features/shell';
import {
  FAILURE_KEY,
  ProposalCard,
  stateAfterRefusal,
  type TransferFailure,
  type TransferProposal,
  useMyProposals,
  useProposalActions,
} from '@/features/transfers';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { EmptyState, ErrorState, LoadingState, ThemedText } from '@/ui/components';
import { Spacing, Symbols } from '@/ui/theme';

/**
 * «Transferencias»: the proposals of this account, and what can be done
 * about them (F12/ADR-002 §9).
 *
 * Two lists, and exactly what the view publishes. «Por responder» holds the
 * incoming proposals — the view only returns those while they are pending,
 * so an accepted one leaves this list and shows up among the movements, and
 * a declined one is simply gone. «Enviadas» holds the actor's own, in every
 * state the server keeps: pending (cancellable), accepted, declined,
 * cancelled, expired. No local history is invented for either.
 *
 * Every action asks first — acceptance is the one that moves money and has
 * no undo (§16, §17) — and every refusal is said in words. A refusal that
 * carries a state («ya estaba aceptada») is not an error: the other side
 * moved first, and the list reloads to what the server has.
 */
export default function TransfersScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const { state: session } = useSession();
  const actorId = session.status === 'signed-in' ? session.identity.userId : '';
  const guest = isGuest(session);

  const scope = usePersonalScope(actorId, guest);
  const ready = readyScope(scope.state);
  const currency =
    ready === null
      ? null
      : currencyDefinition({
          id: ready.currencyDefinitionId,
          code: ready.currencyCode,
          scale: ready.currencyScale,
        });

  const proposals = useMyProposals(actorId, !guest);
  const actions = useProposalActions();
  useRefreshOnReturn(proposals.refresh);

  const amountOf = (proposal: TransferProposal) =>
    currency === null
      ? proposal.amountMinor
      : format.money(moneyFromMinorString(proposal.amountMinor, currency));

  const nameOf = (proposal: TransferProposal) =>
    proposal.counterpartPublicName ??
    (proposal.counterpartHandle === null
      ? t('transfer.counterpartUnknown')
      : `@${proposal.counterpartHandle}`);

  const explain = (failure: TransferFailure) => {
    const moved = stateAfterRefusal(failure);
    Alert.alert(
      t(moved === null ? 'transfer.actionFailedTitle' : 'transfer.actionMovedTitle'),
      t(FAILURE_KEY[failure]),
      [{ text: t('action.understood') }],
    );
  };

  const accept = (proposal: TransferProposal) => {
    Alert.alert(
      t('transfer.acceptTitle'),
      t('transfer.acceptBody', { amount: amountOf(proposal), name: nameOf(proposal) }),
      [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t('transfer.accept'),
          onPress: () => {
            void actions.accept(proposal.proposalId).then((outcome) => {
              if (outcome.kind === 'failed') explain(outcome.failure);
            });
          },
        },
      ],
    );
  };

  const decline = (proposal: TransferProposal) => {
    Alert.alert(
      t('transfer.declineTitle'),
      t('transfer.declineBody', { amount: amountOf(proposal), name: nameOf(proposal) }),
      [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t('transfer.decline'),
          style: 'destructive',
          onPress: () => {
            void actions.decline(proposal.proposalId).then((outcome) => {
              if (outcome.kind === 'failed') explain(outcome.failure);
            });
          },
        },
      ],
    );
  };

  const cancel = (proposal: TransferProposal) => {
    Alert.alert(
      t('transfer.cancelTitle'),
      t('transfer.cancelBody', { amount: amountOf(proposal), name: nameOf(proposal) }),
      [
        { text: t('action.close'), style: 'cancel' },
        {
          text: t('transfer.cancel'),
          style: 'destructive',
          onPress: () => {
            void actions.cancel(proposal.proposalId).then((outcome) => {
              if (outcome.kind === 'failed') explain(outcome.failure);
            });
          },
        },
      ],
    );
  };

  const card = (proposal: TransferProposal) => (
    <ProposalCard
      key={proposal.proposalId}
      proposal={proposal}
      currency={currency}
      busy={actions.busy === proposal.proposalId}
      onAccept={() => {
        accept(proposal);
      }}
      onDecline={() => {
        decline(proposal);
      }}
      onCancel={() => {
        cancel(proposal);
      }}
    />
  );

  const empty = proposals.incoming.length === 0 && proposals.sent.length === 0;

  return (
    <PlaceholderScreen title="nav.transfers">
      {guest ? (
        <EmptyState
          symbol={Symbols.transfer}
          title={t('transfer.guestTitle')}
          description={t('transfer.guestBody')}
        />
      ) : proposals.loading && empty ? (
        <LoadingState label={t('transfer.loading')} />
      ) : proposals.failed && empty ? (
        <ErrorState
          title={t('transfer.loadFailedTitle')}
          description={t('transfer.loadFailedBody')}
          retry={{ label: t('action.retry'), onPress: proposals.refresh }}
        />
      ) : empty ? (
        <EmptyState
          symbol={Symbols.transfer}
          title={t('transfer.empty')}
          description={t('transfer.emptyHint')}
        />
      ) : (
        <>
          {proposals.failed ? (
            <ThemedText variant="caption" themeColor="negative">
              {t('transfer.loadFailedBody')}
            </ThemedText>
          ) : null}
          {proposals.incoming.length === 0 ? null : (
            <View style={styles.list}>
              <ThemedText variant="caption" themeColor="textTertiary">
                {t('transfer.sectionIncoming')}
              </ThemedText>
              {proposals.incoming.map(card)}
            </View>
          )}
          {proposals.sent.length === 0 ? null : (
            <View style={styles.list}>
              <ThemedText variant="caption" themeColor="textTertiary">
                {t('transfer.sectionSent')}
              </ThemedText>
              {proposals.sent.map(card)}
            </View>
          )}
        </>
      )}
    </PlaceholderScreen>
  );
}

/** Same rule as Inicio: reload when coming back, not on the first mount. */
function useRefreshOnReturn(refresh: () => void) {
  const focused = useIsFocused();
  const visited = useRef(false);

  useEffect(() => {
    if (!focused) return;
    if (!visited.current) {
      visited.current = true;
      return;
    }
    refresh();
  }, [focused, refresh]);
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.md,
    paddingTop: Spacing.sm,
  },
});
