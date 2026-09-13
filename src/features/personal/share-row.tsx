import { Pressable, StyleSheet, Text, View } from 'react-native';

import { currencyDefinition, money } from '@/domain';
import { type CategoryRow, categoryName } from '@/lib/categories';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { ThemedText } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

import type { ExpenseShare } from './expense-share';

/**
 * MI CUOTA DE UN GASTO COMPARTIDO, en el desplegable de Gastos.
 *
 * Cerrada: el emoji REAL del grupo a la izquierda, el nombre del grupo como
 * título, la categoría del gasto debajo y, a la derecha, MI CUOTA en la divisa
 * del grupo — nunca lo que adelantó quien pagó. Desplegada: el concepto, quién
 * pagó (su nombre de participante, tal como lo publica la lectura), el importe
 * total del gasto y la fecha.
 *
 * **Misma anatomía que `MovementRow`** —fila con línea inferior, cabecera
 * pulsable, disco de 34, columna de texto que cede y cifra que no cede— y el
 * mismo despliegue al tocar. Lo que no hay son acciones: una cuota se lee, y
 * editar o eliminar el gasto sigue siendo cosa del grupo (`home.sharedManaged
 * InGroup`). Poder leer una cuota no da permisos, y esta fila no los pide.
 *
 * Un dato de contexto que no llegue —grupo, emoji, pagador— se dice con su
 * estado; la cuota se conserva siempre, porque es lo que explica el total.
 */
export function ShareRow({
  share,
  categories,
  expanded,
  onToggle,
}: {
  readonly share: ExpenseShare;
  readonly categories: ReadonlyMap<string, CategoryRow>;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const currency = currencyDefinition({
    id: share.currency_definition_id,
    code: share.currency_code,
    scale: share.currency_scale,
  });
  // Un gasto se pinta en negativo con su signo, como en Movimientos recientes.
  const quota = format.money(money(-BigInt(share.share_amount), currency), { sign: 'always' });
  const total = format.money(money(BigInt(share.total_amount), currency));

  const title = share.group_display_name ?? t('home.sharedGroupUnknown');
  const category = share.category_id === null ? undefined : categories.get(share.category_id);
  const subtitle = categoryName(category, t) ?? t('home.categoryUnknown');
  const payer = share.payer_display_name ?? t('home.sharedPayerUnknown');

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}. ${subtitle}. ${quota}`}
        accessibilityHint={t(expanded ? 'home.movementCollapse' : 'home.movementExpand')}
        onPress={onToggle}
        style={styles.head}>
        <View style={[styles.badge, { backgroundColor: theme.surfaceRaised }]}>
          {/* El emoji del grupo, o un guion si no llegó: nunca un emoji inventado. */}
          <Text style={styles.emoji}>{share.group_emoji ?? '—'}</Text>
        </View>

        <View style={styles.copy}>
          <ThemedText variant="bodyStrong" numberOfLines={1}>
            {title}
          </ThemedText>
          <ThemedText variant="caption" themeColor="textTertiary" numberOfLines={1}>
            {subtitle}
          </ThemedText>
        </View>

        <View style={styles.amounts}>
          <ThemedText variant="amountRow" themeColor="negative" numberOfLines={1}>
            {quota}
          </ThemedText>
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.detail}>
          <Detail label={t('home.detailConcept')} value={share.concept ?? '—'} />
          <Detail label={t('home.detailPaidBy')} value={payer} />
          <Detail label={t('home.detailTotal')} value={total} />
          <Detail label={t('home.detailDate')} value={format.date(share.effective_date, 'long')} />
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('home.sharedManagedInGroup')}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function Detail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.detailRow}>
      <ThemedText variant="bodySmall" themeColor="textTertiary">
        {label}
      </ThemedText>
      <ThemedText variant="bodySmall" numberOfLines={2} style={styles.detailValue}>
        {value}
      </ThemedText>
    </View>
  );
}

/** Los mismos números que `MovementRow`: la fila se lee igual porque ES igual. */
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
  emoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  /** El texto cede; `minWidth: 0` es lo que deja que un nombre largo se recorte. */
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  amounts: {
    alignItems: 'flex-end',
    flexShrink: 0,
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
