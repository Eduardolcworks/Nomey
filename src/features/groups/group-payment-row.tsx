import { Pressable, StyleSheet, View } from 'react-native';

import { type CurrencyDefinition, money } from '@/domain';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { Icon, IconButton, SwipeToDelete, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import type { GroupPayment } from './payment-service';

/**
 * UN PAGO REGISTRADO DEL GRUPO (F09/ADR-007), EN UNA FILA QUE SE DESPLIEGA.
 *
 *   ┌───┬──────────────────────────────┬───────────┐
 *   │ ⇄ │ Ana → Bea                    │   25,00 € │
 *   │   │ Pago · 12/9/26               │           │
 *   ├───┴──────────────────────────────┴───────────┤
 *   │      Declarado por        quien cobró        │
 *   │      🗑                                       │
 *   └──────────────────────────────────────────────┘
 *
 * **Misma anatomía que la fila de gasto**, con dos diferencias que son del
 * hecho y no del dibujo. **No hay lápiz**: un pago no se edita (F09/ADR-007 v3);
 * se anula y se registra otro. **Y la cifra va sin signo ni color de
 * dirección**: para el grupo es una transferencia entre dos de sus
 * participantes, no una entrada ni una salida; el signo lo pone cada Personal.
 *
 * **El desplegable no explica la contabilidad** (decisión 2026-09-13): ni
 * «Cerró», ni las obligaciones directas, encadenadas o reasignadas. Lo que el
 * pago cerró sigue persistido con su versión (`core.payment_allocation`,
 * la vista de miembros) y sigue decidiendo lo que el servidor
 * escribe y revierte; sólo no se pinta. El desplegable dice quién lo declaró
 * —lo único que el título no dice— y ofrece anular a las partes.
 *
 * **Un pago anulado se queda en la lista, marcado**: la cifra tachada,
 * «Anulado» en texto y sin papelera.
 *
 * **Quién puede eliminarlo lo decide el servidor** —las dos partes, tengan o
 * no membresía— y la fila lo ofrece a las dos: sobre otra persona, la
 * frontera responde `NOT_AUTHORIZED` y se dice. Anular no borra nada
 * (F06/ADR-006): la deuda que el pago cerró reaparece.
 */
export type GroupPaymentRowProps = {
  readonly payment: GroupPayment;
  /** Los nombres de los participantes del grupo, por su identidad contextual. */
  readonly participants: ReadonlyMap<string, string>;
  /** Mi identidad contextual en el grupo, o `null`. Decide si se ofrece eliminar. */
  readonly me: string | null;
  readonly currency: CurrencyDefinition;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onDelete: () => void;
  readonly deleting?: boolean;
};

export function GroupPaymentRow({
  payment,
  participants,
  me,
  currency,
  expanded,
  onToggle,
  onDelete,
  deleting,
}: GroupPaymentRowProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const nameOf = (id: string) => participants.get(id) ?? t('group.suggestSomeone');
  const from = nameOf(payment.payerParticipantId);
  const to = nameOf(payment.receiverParticipantId);
  const amount = money(BigInt(payment.amountMinor), currency);
  const subtitle = `${t(payment.annulled ? 'group.paymentAnnulled' : 'group.paymentKind')} · ${format.date(payment.effectiveDate, 'short')}`;
  /* Eliminar: sólo las partes, y sólo mientras esté vigente. */
  const party = me === payment.payerParticipantId || me === payment.receiverParticipantId;
  const deletable = party && !payment.annulled;

  return (
    <SwipeToDelete
      label={t('action.delete')}
      enabled={deletable}
      busy={deleting === true}
      onDelete={onDelete}>
      <View style={[styles.row, { borderBottomColor: theme.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded, disabled: deleting === true }}
          accessibilityLabel={`${t('group.paymentTitle', { from, to })}. ${subtitle}. ${format.money(amount)}`}
          accessibilityHint={t(expanded ? 'home.movementCollapse' : 'home.movementExpand')}
          accessibilityActions={
            deletable ? [{ name: 'delete', label: t('group.deletePayment') }] : undefined
          }
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'delete' && deleting !== true) onDelete();
          }}
          onPress={onToggle}
          style={styles.head}>
          <View style={[styles.badge, { backgroundColor: theme.surfaceRaised }]}>
            <Icon name={Symbols.arrowRight} size={16} colour={theme.textSecondary} />
          </View>

          <View style={styles.copy}>
            <ThemedText
              variant="bodyStrong"
              numberOfLines={1}
              themeColor={payment.annulled ? 'textSecondary' : undefined}>
              {t('group.paymentTitle', { from, to })}
            </ThemedText>
            <ThemedText variant="caption" themeColor="textTertiary" numberOfLines={1}>
              {subtitle}
            </ThemedText>
          </View>

          <View style={styles.amounts}>
            {/*
             * Anulado: la cifra tachada y en el color apagado, y «Anulado» en la
             * segunda línea, en texto: el tachado no se anuncia y el color no
             * comunica solo (design-direction §8).
             */}
            <ThemedText
              variant="amountRow"
              numberOfLines={1}
              themeColor={payment.annulled ? 'textDisabled' : undefined}
              style={payment.annulled ? styles.struck : undefined}>
              {format.money(amount)}
            </ThemedText>
          </View>
        </Pressable>

        {expanded ? (
          <View style={styles.detail}>
            <Detail
              label={t('group.paymentDeclaredBy')}
              value={payment.declaredByReceiver ? to : from}
            />

            {deletable ? (
              <View style={styles.actions}>
                <IconButton
                  name={Symbols.delete}
                  label={t('group.deletePayment')}
                  onPress={onDelete}
                  disabled={deleting === true}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </SwipeToDelete>
  );
}

function Detail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.detailRow}>
      <ThemedText variant="bodySmall" themeColor="textTertiary">
        {label}
      </ThemedText>
      <View style={styles.detailValue}>
        <ThemedText variant="bodySmall">{value}</ThemedText>
      </View>
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
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xxs,
  },
  amounts: {
    alignItems: 'flex-end',
    gap: Spacing.xxs,
  },
  struck: {
    textDecorationLine: 'line-through',
  },
  detail: {
    paddingBottom: Spacing.md,
    paddingLeft: 32 + Spacing.sm,
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
    alignItems: 'flex-end',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
  },
});
