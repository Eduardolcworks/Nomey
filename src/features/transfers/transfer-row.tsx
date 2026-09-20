import { Pressable, StyleSheet, View } from 'react-native';

import { currencyDefinition, moneyFromMinorString } from '@/domain';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { Icon, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import { transferMoment } from './activity';
import type { TransferMovement } from './proposal';

/**
 * A MATERIALISED TRANSFER among the Personal movements.
 *
 * Painted with the same anatomy as `MovementRow` — badge, title, subtitle,
 * signed amount, a detail on tap — and deliberately WITHOUT a pencil or a
 * swipe to delete: an `internal_transfer` has exactly one version and
 * admits neither correction nor annulment (F12/ADR-002 §16), and a row that
 * offered either would be promising something the server refuses.
 *
 * The sign is `balance_amount` as the view publishes it: what this Personal
 * lost or gained. The direction and the counterpart are the view's too,
 * never `created_by` (§12): the receiver creates the operation, and still
 * the row says «recibida de».
 */
export function TransferRow({
  transfer,
  currencyCode,
  currencyScale,
  expanded,
  onToggle,
}: {
  readonly transfer: TransferMovement;
  readonly currencyCode: string;
  readonly currencyScale: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const definition = currencyDefinition({
    id: transfer.currencyDefinitionId,
    code: currencyCode,
    scale: currencyScale,
  });
  const amount = moneyFromMinorString(transfer.balanceAmount, definition);
  const moment = transferMoment(transfer);
  const incoming = transfer.direction === 'incoming';
  const who =
    transfer.counterpartPublicName ??
    (transfer.counterpartHandle === null
      ? t('transfer.counterpartUnknown')
      : `@${transfer.counterpartHandle}`);
  // The sentence carries the amount: the operation exists, so it is what was
  // sent or received, not what somebody proposed.
  const unsigned = format.money(moneyFromMinorString(transfer.amountMinor, definition));
  const title = t(incoming ? 'transfer.rowIncoming' : 'transfer.rowOutgoing', {
    name: who,
    amount: unsigned,
  });
  const handle = transfer.counterpartHandle === null ? null : `@${transfer.counterpartHandle}`;
  const subtitle =
    transfer.groupScopeId !== null
      ? t('transfer.rowGroup')
      : (transfer.concept ?? handle ?? t('transfer.rowPersonal'));

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}. ${format.money(amount, { sign: 'always' })}`}
        onPress={onToggle}
        style={styles.head}>
        <View style={[styles.badge, { backgroundColor: theme.surfaceRaised }]}>
          <Icon
            name={incoming ? Symbols.incoming : Symbols.outgoing}
            size={16}
            colour={theme.textSecondary}
          />
        </View>

        <View style={styles.copy}>
          <ThemedText variant="bodyStrong" numberOfLines={1}>
            {title}
          </ThemedText>
          <ThemedText variant="caption" themeColor="textTertiary" numberOfLines={1}>
            {subtitle}
          </ThemedText>
        </View>

        <ThemedText
          variant="amountRow"
          themeColor={incoming ? 'positive' : 'text'}
          numberOfLines={1}>
          {format.money(amount, { sign: 'always' })}
        </ThemedText>
      </Pressable>

      {expanded ? (
        <View style={styles.detail}>
          <Detail label={t('home.detailDate')} value={format.date(moment.effectiveDate, 'long')} />
          {moment.effectiveTime === '' ? null : (
            <Detail label={t('home.detailTime')} value={moment.effectiveTime} />
          )}
          <Detail
            label={t('home.detailCounterpart')}
            value={handle === null ? who : `${who} · ${handle}`}
          />
          {transfer.concept === null ? null : (
            <Detail label={t('transfer.detailConcept')} value={transfer.concept} />
          )}
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('transfer.rowFinal')}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <ThemedText variant="bodySmall" themeColor="textTertiary">
        {label}
      </ThemedText>
      <ThemedText variant="bodySmall" style={styles.detailValue} numberOfLines={2}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  badge: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  copy: {
    flex: 1,
    gap: 1,
  },
  detail: {
    paddingBottom: Spacing.md,
    paddingLeft: 34 + Spacing.sm,
    gap: Spacing.xs,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  detailValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
});
