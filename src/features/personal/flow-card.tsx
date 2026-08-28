import { Pressable, StyleSheet, View } from 'react-native';

import { currencyDefinition, money } from '@/domain';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { Icon, ThemedText } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

import type { MovementKind } from './movement';
import { toMinor } from './statistics';

export type FlowCardProps = {
  readonly kind: Extract<MovementKind, 'income' | 'expense'>;
  /** Exacto, en unidad mínima, tal como llega del servidor. */
  readonly total: string;
  readonly currencyCode: string;
  readonly currencyScale: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly children: React.ReactNode;
  /** Cuántos movimientos hay dentro, para anunciarlo. */
  readonly count: number;
};

/**
 * Ingresos o Gastos: la cifra del intervalo, y sus movimientos al desplegar.
 *
 * **El total llega agregado por el servidor y no se suma aquí.** Es exacto
 * aunque la lista de dentro venga paginada, que es justamente la separación que
 * ADR-026 introdujo: cifras exactas por agregación, listas por página.
 *
 * **Verde y rojo no son la señal, son el refuerzo.** La tarjeta lleva además
 * icono direccional, etiqueta y **signo explícito** en el importe —
 * `sign: 'always'` no es decoración: `design-direction.md` §8 prohíbe que el
 * color comunique solo, y aproximadamente uno de cada doce hombres no
 * distingue este par.
 *
 * **Se despliega hacia abajo y empuja el contenido**, sin navegar a ninguna
 * parte: es lo que el producto pidió, y también lo que conserva el contexto —
 * el saldo y el intervalo siguen a la vista mientras se mira el detalle.
 */
export function FlowCard({
  kind,
  total,
  currencyCode,
  currencyScale,
  expanded,
  onToggle,
  children,
  count,
}: FlowCardProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const income = kind === 'income';
  const tone = income ? theme.positive : theme.negative;
  const minor = toMinor(total);

  /*
   * El gasto se declara en positivo y se muestra en negativo, igual que en la
   * lista: la magnitud es la misma y el signo lo pone la presentación a partir
   * de la clase. Ver `movement.displayMinor`.
   */
  const shown = income ? minor : -minor;
  const definition = currencyDefinition({
    id: 'personal-base',
    code: currencyCode,
    scale: currencyScale,
  });

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t(income ? 'home.income' : 'home.expenses')}
        accessibilityHint={t('home.flowHint', { count: String(count) })}
        onPress={onToggle}
        style={styles.header}>
        <View style={styles.title}>
          <Icon name={income ? 'arrow.down.left' : 'arrow.up.right'} size={15} colour={tone} />
          <ThemedText variant="caption" themeColor="textTertiary">
            {t(income ? 'home.income' : 'home.expenses')}
          </ThemedText>
        </View>

        <ThemedText
          variant="amountRow"
          themeColor={income ? 'positive' : 'negative'}
          numberOfLines={1}
          adjustsFontSizeToFit>
          {format.money(money(shown, definition), { sign: 'always' })}
        </ThemedText>

        <View style={styles.chevron}>
          <Icon
            name={expanded ? 'chevron.up' : 'chevron.down'}
            size={13}
            colour={theme.textTertiary}
          />
        </View>
      </Pressable>

      {expanded ? (
        <View style={[styles.body, { borderTopColor: theme.border }]}>{children}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: {
    padding: Spacing.md,
    gap: Spacing.xxs,
  },
  title: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  chevron: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
  },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
});
