import { Pressable, StyleSheet, View } from 'react-native';

import { currencyDefinition, money } from '@/domain';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { Icon, IconButton, ThemedText } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

import { type CategoryRow, categoryIcon, categoryName } from './category';
import {
  adjustmentForm,
  type BalanceObservation,
  displayMinor,
  isEdited,
  movementKind,
  type PersonalOperation,
  type PersonalOperationVersion,
} from './movement';
import { toMinor } from './statistics';

export type MovementRowProps = {
  readonly operation: PersonalOperation;
  readonly previous: PersonalOperationVersion | undefined;
  readonly observation: BalanceObservation | undefined;
  readonly categories: ReadonlyMap<string, CategoryRow>;
  readonly currencyCode: string;
  readonly currencyScale: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /** Editar y eliminar existen visualmente; la acción llega en F6.F. */
  readonly onEdit: () => void;
  readonly onDelete: () => void;
};

/**
 * Una fila de movimiento, y lo que enseña al desplegarse.
 *
 * Tres cosas que vienen decididas de F6.D y aquí sólo se respetan:
 *
 * **La unidad es la operación, no el efecto.** Una fila es una operación con su
 * versión vigente; las anuladas no llegan hasta aquí porque no salen de la
 * superficie.
 *
 * **El «Editado» compara `original_amount` con `original_amount`.** La versión
 * anterior no tiene importe firmado —sus efectos están en `core.effect`, que
 * ninguna vista puede leer— así que las dos líneas se comparan en la magnitud
 * declarada y el signo lo pone `displayMinor` a partir de la clase. Es seguro
 * porque todas las versiones de una operación son de la misma clase, garantía
 * de `OPERATION_CLASS_MISMATCH`.
 *
 * **El ajuste no tiene concepto ni categoría, y no se le inventan.** Su línea
 * la compone el producto: con objetivo, «Saldo ajustado a X»; por delta, el
 * delta con su signo.
 */
export function MovementRow({
  operation,
  previous,
  observation,
  categories,
  currencyCode,
  currencyScale,
  expanded,
  onToggle,
  onEdit,
  onDelete,
}: MovementRowProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const kind = movementKind(operation.operation_class);
  const definition = currencyDefinition({
    id: 'personal-base',
    code: currencyCode,
    scale: currencyScale,
  });

  const amount = money(toMinor(operation.balance_amount), definition);
  const form = adjustmentForm(operation);
  const category =
    operation.category_id === null ? undefined : categories.get(operation.category_id);

  /*
   * El título de la fila. El ajuste NO tiene concepto: su línea se compone,
   * y con el objetivo declarado cuando lo hay. `target_balance` es intención
   * —lo que la persona dijo tener— y por eso puede escribirse en la etiqueta.
   */
  const title =
    form === 'target' && operation.target_balance !== null
      ? t('home.adjustedTo', {
          amount: format.money(money(toMinor(operation.target_balance), definition)),
        })
      : form === 'delta'
        ? t('home.adjustmentManual')
        : (operation.concept ?? t('home.movement'));

  const symbol =
    kind === 'adjustment'
      ? 'slider.horizontal.3'
      : (categoryIcon(category) ?? (kind === 'income' ? 'arrow.down.left' : 'arrow.up.right'));

  const subtitle =
    kind === 'adjustment'
      ? t('home.adjustment')
      : (categoryName(category, t) ?? t('home.categoryUnknown'));

  const previousShown =
    previous === undefined || kind === null
      ? null
      : money(displayMinor(kind, previous.original_amount), definition);

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}. ${format.money(amount, { sign: 'always' })}`}
        accessibilityHint={t(expanded ? 'home.movementCollapse' : 'home.movementExpand')}
        onPress={onToggle}
        style={styles.head}>
        <View style={[styles.badge, { backgroundColor: theme.surfaceRaised }]}>
          <Icon name={symbol as never} size={16} colour={theme.textSecondary} />
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
          <View style={styles.currentLine}>
            <ThemedText
              variant="amountRow"
              themeColor={toMinor(operation.balance_amount) < 0n ? 'negative' : 'positive'}
              numberOfLines={1}>
              {format.money(amount, { sign: 'always' })}
            </ThemedText>
            {isEdited(operation) ? (
              // «Editado» es TEXTO, no un color ni un punto: es el refuerzo no
              // cromático que exige design-direction.md §8, y además es lo que
              // un lector de pantalla puede anunciar.
              <ThemedText variant="caption" themeColor="textTertiary">
                {t('home.edited')}
              </ThemedText>
            ) : null}
          </View>

          {previousShown === null ? null : (
            <ThemedText
              variant="caption"
              themeColor="textDisabled"
              numberOfLines={1}
              accessibilityLabel={t('home.previousAmount', {
                amount: format.money(previousShown, { sign: 'always' }),
              })}
              style={styles.struck}>
              {format.money(previousShown, { sign: 'always' })}
            </ThemedText>
          )}
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.detail}>
          <Detail
            label={t('home.detailDate')}
            value={format.date(operation.effective_date, 'long')}
          />
          {operation.effective_time === null ? null : (
            <Detail label={t('home.detailTime')} value={operation.effective_time.slice(0, 5)} />
          )}
          {observation === undefined ? null : (
            <Detail
              label={t('home.detailObserved')}
              value={format.money(money(toMinor(observation.observed_balance_after), definition))}
              /*
               * Y se dice lo que es. ADR-023 §5: la observación es del instante
               * en que la versión se escribió, así que corregir hoy un
               * movimiento de hace tres meses observa el saldo DE HOY. Se
               * presenta como observación del sistema y nunca como «el saldo que
               * tenías aquel día», que sería una reconstrucción que nadie hace.
               */
              note={t('home.detailObservedNote')}
            />
          )}

          <View style={styles.actions}>
            <IconButton name="pencil" label={t('home.editMovement')} onPress={onEdit} />
            <IconButton name="trash" label={t('home.deleteMovement')} onPress={onDelete} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Detail({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={styles.detailRow}>
      <ThemedText variant="bodySmall" themeColor="textTertiary">
        {label}
      </ThemedText>
      <View style={styles.detailValue}>
        <ThemedText variant="bodySmall">{value}</ThemedText>
        {note === undefined ? null : (
          <ThemedText variant="caption" themeColor="textTertiary" style={styles.note}>
            {note}
          </ThemedText>
        )}
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
  amounts: {
    alignItems: 'flex-end',
    gap: 1,
  },
  currentLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  struck: {
    textDecorationLine: 'line-through',
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
    alignItems: 'flex-end',
  },
  note: {
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
  },
});
