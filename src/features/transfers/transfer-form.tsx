import { type ReactNode, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { currencyDefinition, money, toMinorUnits } from '@/domain';
import { currencySymbol, useFormat } from '@/lib/format';
import { type MessageKey, useTranslation } from '@/lib/i18n';
import {
  ActionButton,
  type AmountEntry,
  AmountSheet,
  amountValue,
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
 * ONE form, in this order: amount, concept, the `@username` of the person
 * who will receive, and «Proponer». The only recipient is an account found
 * by its username — there is no other way of addressing a transfer from
 * the client (payment requests by link, F12/ADR-004, have their backend and
 * no screen, by product decision).
 *
 * THE AMOUNT AND THE CONCEPT ARE NOT THIS FORM'S. They come from the add
 * sheet's own draft (`MovementForm` hands them in), so switching Gasto ↔
 * Ingreso ↔ Transferencia in any direction keeps what was typed: one source
 * of truth, no copies to keep in step and no effect syncing them. What this
 * form owns is only what a transfer has: the recipient lookup and the
 * proposal.
 *
 * Three phases, all inside the same sheet: edit, confirm (the identity the
 * server resolved, the amount, the concept — the window for not getting it
 * wrong, §17) and proposed. A refusal or a transport failure keeps the
 * phase and everything typed; the person retries from where they were,
 * with the same command key. Clearing the recipient (the X) clears only
 * the recipient.
 *
 * A guest never reaches the server from here: they see why and where to
 * create the account (F05/ADR-003; the backend would refuse with
 * NOT_AUTHORIZED anyway).
 */
export function TransferForm({
  scope,
  guest,
  entry,
  onChangeEntry,
  concept,
  onChangeConcept,
  onDone,
  onOpenProposals,
  onCreateAccount,
  friendPicker,
}: {
  readonly scope: TransferScope | null;
  readonly guest: boolean;
  /** The add sheet's amount, shared with Gasto and Ingreso. */
  readonly entry: AmountEntry;
  readonly onChangeEntry: (next: AmountEntry) => void;
  /** The add sheet's concept, shared likewise. */
  readonly concept: string;
  readonly onChangeConcept: (next: string) => void;
  /** «Listo» after proposing: the sheet closes. */
  readonly onDone: () => void;
  /** «Ver pendientes»: the pending centre, where the proposal now waits. */
  readonly onOpenProposals: () => void;
  readonly onCreateAccount: () => void;
  /**
   * EL SELECTOR DE AMIGOS, ENTREGADO POR LA RUTA (F12.E.E).
   *
   * Los amigos viven en `features/friends` y una feature no puede importar a
   * otra — la misma frontera por la que `add.tsx` compone este formulario
   * dentro de `MovementForm`. Así que este formulario decide CUÁNDO se
   * enseña el selector y qué hacer con lo elegido, y la ruta decide QUÉ
   * selector es. Sin él, la fila del destinatario es exactamente la que
   * había: campo y lupa.
   *
   * Lo que devuelve la elección es un handle y un nombre, nada más: no hay
   * uid por ningún lado, y lo elegido se convierte en el MISMO `found` que
   * produce la lupa.
   */
  readonly friendPicker?: (props: {
    readonly onSelect: (chosen: { readonly handle: string; readonly publicName: string }) => void;
    readonly onClose: () => void;
  }) => ReactNode;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const lookup = useResolveRecipient();
  const creation = useCreateProposal();
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' });
  /*
   * Montado sólo mientras está abierto, como el teclado de emojis: así la
   * búsqueda local empieza vacía cada vez sin que nadie la borre desde un
   * efecto, y la lista se relee al abrirlo.
   */
  const [picking, setPicking] = useState(false);

  if (guest) {
    return (
      <View style={styles.block}>
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
  // The amount is asked for first, in the order of the screen.
  const blocker: Blocker | null =
    amountValue(entry).trim() === ''
      ? 'amountMissing'
      : minor === null || minor <= 0n
        ? 'amountInvalid'
        : recipient === null
          ? 'recipient'
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
  const trimmedConcept = concept.trim();

  const zero = format.number(0, { minimumFractionDigits: scale, maximumFractionDigits: scale });
  const cut = zero.search(/[^0-9]/);

  if (phase.kind === 'proposed') {
    return (
      <View style={styles.block} accessibilityLiveRegion="polite">
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
          <ActionButton label={t('action.done')} tone="brand" onPress={onDone} />
        </View>
      </View>
    );
  }

  if (phase.kind === 'confirm' && recipient !== null && minor !== null && scope !== null) {
    const failure = creation.failure;
    return (
      <View style={styles.block}>
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
          {trimmedConcept === '' ? null : (
            <ThemedText variant="body" themeColor="textSecondary" style={styles.centred}>
              {trimmedConcept}
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
        <View style={styles.doneActions}>
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

  // edit: amount, concept, @username, «Proponer».
  return (
    <AmountSheet
      fields={
        <View style={styles.fields}>
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
              onChangeText={onChangeConcept}
              placeholder={t('transfer.conceptPlaceholder')}
              placeholderTextColor={theme.textDisabled}
              accessibilityLabel={t('transfer.conceptLabel')}
              style={[styles.conceptInput, { color: theme.text }]}
            />
          </GlassSurface>

          <RecipientField
            lookup={lookup}
            onChange={() => {
              lookup.reset();
            }}
            onPickFriend={
              friendPicker === undefined
                ? undefined
                : () => {
                    setPicking(true);
                  }
            }
          />

          {/*
           * ELEGIR UN AMIGO NO TOCA NADA MÁS. Fija el destinatario, cierra
           * la hoja y se acabó: el importe y el concepto son del borrador
           * del alta y este camino no los mira siquiera.
           */}
          {picking && friendPicker !== undefined
            ? friendPicker({
                onSelect: (chosen) => {
                  lookup.choose(chosen.handle, chosen.publicName);
                  setPicking(false);
                },
                onClose: () => {
                  setPicking(false);
                },
              })
            : null}
        </View>
      }
      entry={entry}
      onChangeEntry={onChangeEntry}
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
  block: {
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  fields: {
    gap: Spacing.sm,
  },
  doneActions: {
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
