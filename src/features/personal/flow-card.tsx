import { Pressable, StyleSheet, View } from 'react-native';

import { currencyDefinition, money } from '@/domain';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { Icon, ThemedText } from '@/ui/components';
import { HomeCardRelief, homeCardSurface, Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import type { MovementKind } from './movement';
import { toMinor } from './statistics';

export type FlowCardProps = {
  readonly kind: Extract<MovementKind, 'income' | 'expense'>;
  /**
   * Exacto, en unidad mínima, tal como sale de la proyección. `null` cuando no
   * hay estadísticas confirmadas: entonces no se fabrica una cifra, se enseña el
   * mismo marcador que el Disponible (ADR-028 §8).
   */
  readonly total: string | null;
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
    <View
      style={[
        styles.card,
        /*
         * `flex: 1` SÓLO cerrada, y es la clave de las dos formas.
         *
         * Cerrada comparte fila con su pareja y reparte el ancho a medias.
         * Abierta la renderiza la pantalla sola, en una columna, y ahí un
         * `flex: 1` la estiraría hasta el alto disponible en vez de dejarla
         * crecer con su contenido — la tarjeta se separaría de sus propios
         * movimientos.
         */
        expanded ? null : styles.half,
        { backgroundColor: homeCardSurface(theme.surface), borderColor: theme.border },
        HomeCardRelief,
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t(income ? 'home.income' : 'home.expenses')}
        accessibilityHint={t('home.flowHint', { count: String(count) })}
        onPress={onToggle}
        style={styles.header}>
        <View style={styles.title}>
          <Icon name={income ? Symbols.incoming : Symbols.outgoing} size={15} colour={tone} />
          <ThemedText variant="caption" themeColor="textTertiary">
            {t(income ? 'home.income' : 'home.expenses')}
          </ThemedText>
        </View>

        <ThemedText
          variant="amountRow"
          themeColor={total === null ? 'textTertiary' : income ? 'positive' : 'negative'}
          numberOfLines={1}
          adjustsFontSizeToFit>
          {total === null
            ? t('home.amountPending')
            : format.money(money(shown, definition), { sign: 'always' })}
        </ThemedText>

        <View style={styles.chevron}>
          <Icon
            name={expanded ? Symbols.collapse : Symbols.expand}
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
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  /** Media fila, cuando comparte sitio con su pareja. */
  half: {
    flex: 1,
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
    /*
     * SIN ACOLCHADO VERTICAL PROPIO, ni arriba ni abajo, porque las filas ya
     * traen el suyo: `MovementRow` acolcha `Spacing.sm` por ARRIBA Y POR ABAJO.
     *
     * Aquí había un `paddingBottom` y no su pareja de arriba, que es la forma
     * de la equivocación: daba por hecho que la fila sólo acolchaba por arriba.
     * El resultado era asimétrico —`sm` sobre la primera fila y `sm` + `sm` bajo
     * la última—, y esa franja de más es la que se veía al desplegar la tarjeta
     * y bajar hasta el final.
     *
     * Una fila desplegada acolcha `Spacing.md` bajo su detalle, así que sus
     * acciones tampoco quedan pegadas al canto.
     */
  },
});
