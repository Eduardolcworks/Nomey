import { Pressable, StyleSheet, View } from 'react-native';

import { type CurrencyDefinition, moneyFromMinorString } from '@/domain';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { GlassPressable, Icon, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import type { GroupTransferOperation } from './group-transfer';

/**
 * UNA TRANSFERENCIA REGISTRADA, en el histórico del grupo.
 *
 * **Una intención, una fila.** Con un destinatario se le nombra; con varios se
 * cuentan y el reparto va debajo, persona a persona. Partirla en N filas
 * contaría como N hechos algo que fue uno solo, y además dejaría sin sentido
 * la acción de eliminar: no se elimina un tercio de una operación.
 *
 * **Dice quién transfirió a quién, y eso sale del reparto persistido**
 * (`core.group_transfer_allocation`), no de quién creó la operación. Aquí
 * coinciden —la registra el emisor—, pero la separación se mantiene porque es
 * lo que hace que la frase siga siendo cierta si algún día dejan de coincidir.
 *
 * **Los destinatarios son PARTICIPANTES.** Un fantasma aparece con su nombre,
 * igual que cualquiera, y nada en esta fila distingue a quien tiene cuenta de
 * quien no: en el libro del grupo no es una diferencia.
 *
 * **Se despliega para eliminar, como un pago**, y por la misma razón: una
 * transferencia de UNA voluntad se anula (F12/ADR-007) — la irreversibilidad
 * de B3 venía de que dos personas habían consentido el hecho, y aquí no hay
 * dos. Lo que NO se ofrece es editar: se anula y se registra otra.
 *
 * **Sólo se ofrece a quien la registró.** La operación toca SU Modo Personal,
 * así que la frontera sólo la deja anular a esa cuenta; ofrecerlo a los demás
 * sería enseñar un botón que siempre responde `NOT_AUTHORIZED`.
 */
export function GroupTransferRow({
  transfer,
  currency,
  expanded,
  deleting = false,
  onToggle,
  onDelete,
}: {
  readonly transfer: GroupTransferOperation;
  readonly currency: CurrencyDefinition;
  readonly expanded: boolean;
  readonly deleting?: boolean;
  readonly onToggle: () => void;
  readonly onDelete: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const total = format.money(moneyFromMinorString(transfer.totalMinor, currency));
  const only = transfer.shares.length === 1 ? transfer.shares[0] : undefined;
  const line =
    only === undefined
      ? t('group.transferDoneMany', {
          sender: transfer.senderDisplayName,
          amount: total,
          count: transfer.shares.length,
        })
      : t('group.transferDone', {
          sender: transfer.senderDisplayName,
          receiver: only.receiverDisplayName,
          amount: total,
        });

  const label = transfer.concept === null ? line : `${line}. ${transfer.concept}`;

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Pressable
        accessibilityRole={transfer.isSender ? 'button' : undefined}
        accessibilityState={transfer.isSender ? { expanded } : undefined}
        accessible
        accessibilityLabel={label}
        disabled={!transfer.isSender}
        onPress={onToggle}
        style={styles.head}>
        <View style={[styles.badge, { backgroundColor: theme.surfaceRaised }]}>
          <Icon name={Symbols.transfer} size={16} colour={theme.textSecondary} />
        </View>

        <View style={styles.copy}>
          <ThemedText variant="body" numberOfLines={2}>
            {line}
          </ThemedText>
          {transfer.concept === null ? null : (
            <ThemedText variant="caption" themeColor="textTertiary" numberOfLines={1}>
              {transfer.concept}
            </ThemedText>
          )}
          {/*
           * EL REPARTO, sólo cuando hay más de uno. Con uno la frase ya lo dijo,
           * y repetirlo debajo sería decir dos veces lo mismo.
           */}
          {only !== undefined
            ? null
            : transfer.shares.map((share) => (
                <View key={share.receiverParticipantId} style={styles.share}>
                  <ThemedText variant="caption" themeColor="textTertiary" numberOfLines={1}>
                    {share.receiverDisplayName}
                  </ThemedText>
                  <ThemedText variant="caption" themeColor="textSecondary" numberOfLines={1}>
                    {format.money(moneyFromMinorString(share.amountMinor, currency))}
                  </ThemedText>
                </View>
              ))}
        </View>
      </Pressable>

      {/*
       * ELIMINAR, sólo desplegado y sólo para quien la registró. Anular no
       * borra nada (F06/ADR-006): escribe una versión sin efectos, y la deuda
       * del grupo y el Disponible del emisor vuelven a como estaban.
       */}
      {expanded && transfer.isSender ? (
        <GlassPressable
          label={t('action.delete')}
          disabled={deleting}
          busy={deleting}
          onPress={onDelete}
          radius={Radius.full}
          style={styles.delete}>
          <Icon name={Symbols.delete} size={16} colour={theme.negative} />
          <ThemedText variant="bodySmall" themeColor="negative">
            {t('action.delete')}
          </ThemedText>
        </GlassPressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  delete: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    marginLeft: 40,
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0, gap: Spacing.xxs },
  share: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
});
