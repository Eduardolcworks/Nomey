import { StyleSheet, View } from 'react-native';

import { type CurrencyDefinition, moneyFromMinorString } from '@/domain';
import { useFormat } from '@/lib/format';
import { type MessageKey, useTranslation } from '@/lib/i18n';
import { ActionButton, ThemedText } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

import { isActionable, isCancellable, type ProposalState, type TransferProposal } from './proposal';

const STATE_KEY: Readonly<Record<ProposalState, MessageKey>> = {
  pending: 'transfer.statePending',
  accepted: 'transfer.stateAccepted',
  declined: 'transfer.stateDeclined',
  cancelled: 'transfer.stateCancelled',
  expired: 'transfer.stateExpired',
};

/**
 * ONE PROPOSAL, said as a sentence.
 *
 * The economic fact is the headline and carries the amount — «Le propusiste
 * enviar 25,00 €», «Aitor te propone enviarte 25,00 €» — so there is no
 * second amount floating at the edge of the card. The identity is secondary:
 * the `@handle` under the sentence is what makes «Aitor» verifiable
 * (F12/ADR-001 §10). Direction and counterpart come from the view, never
 * from who created the row (F12/ADR-002 §12).
 *
 * Incoming and pending: Aceptar and Rechazar. Outgoing and pending:
 * Cancelar. Outgoing and declined: «Aitor rechazó tu propuesta de 25,00 €»,
 * with no button at all — it is news, not a task, and nothing economic
 * happened. Anything else the list does not show (see `useMyProposals`),
 * but the state is still a word here, not only a colour (design direction
 * §8), in case a row is painted on its way out.
 */
export function ProposalCard({
  proposal,
  currency,
  busy,
  onAccept,
  onDecline,
  onCancel,
}: {
  readonly proposal: TransferProposal;
  /** `null` while the currency of the actor's Personal is unknown: the amount is shown as minor units then. */
  readonly currency: CurrencyDefinition | null;
  readonly busy: boolean;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const amount =
    currency === null
      ? proposal.amountMinor
      : format.money(moneyFromMinorString(proposal.amountMinor, currency));
  const incoming = proposal.direction === 'incoming';
  const name =
    proposal.counterpartPublicName ??
    (proposal.counterpartHandle === null
      ? t('transfer.counterpartUnknown')
      : `@${proposal.counterpartHandle}`);
  const declined = !incoming && proposal.state === 'declined';
  const headline = t(
    incoming
      ? 'transfer.cardIncoming'
      : declined
        ? 'transfer.cardDeclined'
        : 'transfer.cardOutgoing',
    { amount, name },
  );
  const identity =
    proposal.counterpartHandle === null
      ? null
      : proposal.counterpartPublicName === null
        ? `@${proposal.counterpartHandle}`
        : `${proposal.counterpartPublicName} · @${proposal.counterpartHandle}`;
  const until = format.date(proposal.expiresAt.slice(0, 10), 'medium');
  const when = format.date(proposal.createdAt.slice(0, 10), 'medium');
  const pending = proposal.state === 'pending';

  return (
    <View
      style={[styles.card, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}
      accessibilityLabel={`${headline}. ${t(STATE_KEY[proposal.state])}`}>
      <ThemedText variant="bodyStrong">{headline}</ThemedText>
      {identity === null ? null : (
        <ThemedText variant="caption" themeColor="textSecondary" numberOfLines={1}>
          {identity}
        </ThemedText>
      )}
      {proposal.concept === null ? null : (
        <ThemedText variant="body" themeColor="textSecondary" numberOfLines={2}>
          {proposal.concept}
        </ThemedText>
      )}
      <ThemedText variant="caption" themeColor="textTertiary" numberOfLines={1}>
        {t(STATE_KEY[proposal.state])}
        {' · '}
        {pending ? t('transfer.cardExpires', { date: until }) : when}
      </ThemedText>

      {isActionable(proposal) ? (
        <View style={styles.actions}>
          <ActionButton
            label={t('transfer.accept')}
            tone="brand"
            busy={busy}
            disabled={busy}
            onPress={onAccept}
            style={styles.action}
          />
          <ActionButton
            label={t('transfer.decline')}
            tone="secondary"
            material="control"
            disabled={busy}
            onPress={onDecline}
            style={styles.action}
          />
        </View>
      ) : isCancellable(proposal) ? (
        <View style={styles.actions}>
          <ActionButton
            label={t('transfer.cancel')}
            tone="secondary"
            material="control"
            busy={busy}
            disabled={busy}
            onPress={onCancel}
            style={styles.action}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  action: {
    flexGrow: 1,
  },
});
