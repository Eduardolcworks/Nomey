import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { currencyDefinition, money, toMinorUnits } from '@/domain';
import { currencySymbol, useFormat } from '@/lib/format';
import { type MessageKey, useTranslation } from '@/lib/i18n';
import {
  ActionButton,
  type AmountEntry,
  AmountSheet,
  amountValue,
  EMPTY_AMOUNT,
  EmptyState,
  GlassSurface,
  IdentityLine,
  ThemedText,
} from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import { RecipientField } from './recipient-field';
import { FAILURE_KEY } from './transfer-errors';
import { useCreateProposal } from './use-create-proposal';
import { useResolveRecipient } from './use-resolve-recipient';

/** The concept row shares the movement form's geometry: this sheet is that sheet. */
const CIRCLE = 52;

export type TransferScope = {
  readonly currencyDefinitionId: string;
  readonly currencyCode: string;
  readonly currencyScale: number;
};

type Phase =
  | { readonly kind: 'edit' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'proposed'; readonly proposalId: string };

type Blocker = 'recipient' | 'amountMissing' | 'amountInvalid';

const BLOCKER_KEY: Readonly<Record<Blocker, MessageKey>> = {
  recipient: 'transfer.blockerRecipient',
  amountMissing: 'entry.amountHint',
  amountInvalid: 'entry.amountInvalid',
};

/**
 * `Personal → + → Transferencia`: PROPOSE A TRANSFER (F12/ADR-002 §2).
 *
 * Nothing here moves money. The button says «Proponer», the confirmation
 * says the other person will have to accept, and the done state says
 * «pendiente»: the transfer exists only when the receiver accepts, and then
 * it appears among the movements of both (F12/ADR-002 §9, §11).
 *
 * Three phases, all inside the same sheet: edit (recipient, amount,
 * concept), confirm (the identity the server resolved, the amount, the
 * concept — the window for not getting it wrong, §17) and proposed. A
 * refusal or a transport failure keeps the phase and everything typed; the
 * person retries from where they were, with the same command key.
 *
 * A guest never reaches the server from here: they see why and where to
 * create the account (F05/ADR-003; the backend would refuse with
 * NOT_AUTHORIZED anyway).
 */
export function TransferForm({
  scope,
  guest,
  onProposed,
  onOpenProposals,
  onCreateAccount,
}: {
  readonly scope: TransferScope | null;
  readonly guest: boolean;
  /** «Listo» after a proposal: the sheet closes. */
  readonly onProposed: () => void;
  readonly onOpenProposals: () => void;
  readonly onCreateAccount: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const lookup = useResolveRecipient();
  const creation = useCreateProposal();
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_AMOUNT);
  const [concept, setConcept] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' });

  if (guest) {
    return (
      <View style={styles.guest}>
        <EmptyState
          symbol={Symbols.transfer}
          title={t('transfer.guestTitle')}
          description={t('transfer.guestBody')}
        />
        <ActionButton label={t('transfer.guestAction')} tone="brand" onPress={onCreateAccount} />
      </View>
    );
  }

  const scale = scope?.currencyScale ?? 2;
  const recipient = lookup.state.kind === 'found' ? lookup.state : null;
  const minor = scope === null ? null : toMinorUnits(amountValue(entry), scope.currencyScale);
  const blocker: Blocker | null =
    recipient === null
      ? 'recipient'
      : amountValue(entry).trim() === ''
        ? 'amountMissing'
        : minor === null || minor <= 0n
          ? 'amountInvalid'
          : null;

  const definition =
    scope === null
      ? null
      : currencyDefinition({
          id: scope.currencyDefinitionId,
          code: scope.currencyCode,
          scale: scope.currencyScale,
        });
  const amountText =
    definition === null || minor === null ? '' : format.money(money(minor, definition));

  const zero = format.number(0, { minimumFractionDigits: scale, maximumFractionDigits: scale });
  const cut = zero.search(/[^0-9]/);

  if (phase.kind === 'proposed') {
    return (
      <View style={styles.done} accessibilityLiveRegion="polite">
        <EmptyState
          symbol={Symbols.send}
          title={t('transfer.proposedTitle', { amount: amountText })}
          description={t('transfer.proposedBody', {
            name: recipient?.publicName ?? '',
            handle: recipient?.handle ?? '',
          })}
        />
        <View style={styles.doneActions}>
          <ActionButton
            label={t('transfer.seeProposals')}
            tone="secondary"
            material="control"
            onPress={onOpenProposals}
          />
          <ActionButton label={t('action.done')} tone="brand" onPress={onProposed} />
        </View>
      </View>
    );
  }

  if (phase.kind === 'confirm' && recipient !== null && minor !== null && scope !== null) {
    const failure = creation.failure;
    return (
      <View style={styles.confirm}>
        <ThemedText variant="label" themeColor="textSecondary" style={styles.centred}>
          {t('transfer.confirmTitle')}
        </ThemedText>
        <View
          style={[
            styles.card,
            { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
          ]}>
          <IdentityLine
            name={recipient.publicName}
            handle={recipient.handle}
            fallback={t('transfer.recipientUnknown')}
            glyph={Symbols.person}
            emphasis="strong"
          />
          <ThemedText variant="display" style={styles.centred}>
            {amountText}
          </ThemedText>
          {concept.trim() === '' ? null : (
            <ThemedText variant="body" themeColor="textSecondary" style={styles.centred}>
              {concept.trim()}
            </ThemedText>
          )}
          <ThemedText variant="caption" themeColor="textTertiary" style={styles.centred}>
            {t('transfer.confirmNote', { name: recipient.publicName })}
          </ThemedText>
        </View>
        {failure === null ? null : (
          <ThemedText variant="caption" themeColor="negative" style={styles.centred}>
            {t(FAILURE_KEY[failure])}
          </ThemedText>
        )}
        <View style={styles.confirmActions}>
          <ActionButton
            label={t('action.back')}
            tone="secondary"
            material="control"
            disabled={creation.creating}
            onPress={() => {
              setPhase({ kind: 'edit' });
            }}
          />
          <ActionButton
            label={t(failure === 'offline' ? 'action.retry' : 'transfer.confirmAction')}
            tone="brand"
            busy={creation.creating}
            disabled={creation.creating}
            onPress={() => {
              void creation
                .create({
                  handle: recipient.handle,
                  amountMinor: minor,
                  currencyDefinitionId: scope.currencyDefinitionId,
                  concept,
                })
                .then((outcome) => {
                  if (outcome.kind === 'pending') {
                    setPhase({ kind: 'proposed', proposalId: outcome.proposalId });
                    return;
                  }
                  if (outcome.kind === 'not_found') {
                    // The handle stopped resolving between the search and the
                    // send: back to the field, with the reason on it.
                    lookup.reset();
                    setPhase({ kind: 'edit' });
                  }
                });
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <AmountSheet
      header={
        <RecipientField
          lookup={lookup}
          onChange={() => {
            lookup.reset();
          }}
        />
      }
      fields={
        <GlassSurface
          material="control"
          level="regular"
          depth="well"
          rim="soft"
          radius={Radius.full}
          nativeEffect={false}
          style={styles.conceptBox}>
          <TextInput
            value={concept}
            onChangeText={setConcept}
            placeholder={t('transfer.conceptPlaceholder')}
            placeholderTextColor={theme.textDisabled}
            accessibilityLabel={t('transfer.conceptLabel')}
            style={[styles.conceptInput, { color: theme.text }]}
          />
        </GlassSurface>
      }
      entry={entry}
      onChangeEntry={setEntry}
      amountLabel={t('entry.amountLabel')}
      currency={scope === null ? null : { code: scope.currencyCode, scale: scope.currencyScale }}
      currencySymbol={
        scope === null ? '' : currencySymbol(format.locale, scope.currencyCode, scope.currencyScale)
      }
      decimalSeparator={cut === -1 ? '' : zero.slice(cut, cut + 1)}
      currencyLabel={t('entry.currencyLabel', { code: scope?.currencyCode ?? '' })}
      currencyNote={t('entry.currencyFixed')}
      hint={
        scope === null ? t('entry.scopePending') : blocker === null ? null : t(BLOCKER_KEY[blocker])
      }
      error={null}
      saveLabel={t('transfer.proposeAction')}
      saveDisabled={scope === null || blocker !== null}
      saving={false}
      onSave={() => {
        if (blocker !== null) return;
        setPhase({ kind: 'confirm' });
      }}
    />
  );
}

const styles = StyleSheet.create({
  guest: {
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  done: {
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  doneActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  confirm: {
    gap: Spacing.md,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  card: {
    gap: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
  },
  centred: {
    textAlign: 'center',
  },
  conceptBox: {
    height: CIRCLE,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  conceptInput: {
    fontSize: 16,
  },
});
