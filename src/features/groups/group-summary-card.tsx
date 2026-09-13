import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { type CurrencyDefinition, money } from '@/domain';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { GlassSurface, ThemedText } from '@/ui/components';
import { Radius, Spacing, type TextColor, useTheme } from '@/ui/theme';

import { positionAmount, positionLabel, positionState, positionTone } from './group-position';
import type { GroupAmount, GroupSummary } from './group-summary';

/**
 * LAS TRES CIFRAS DEL GRUPO, EN UNA SOLA TARJETA.
 *
 *   ┌──────────────┬──────────────┬──────────────┐
 *   │  Te deben    │ Tú gastaste  │    Total     │
 *   │   0,00 €     │    0,00 €    │   0,00 €     │
 *   └──────────────┴──────────────┴──────────────┘
 *
 * **Una tarjeta, no tres.** Son tres lecturas del mismo grupo y se leen de un
 * vistazo; tres cajas separadas las convertirían en tres cosas que hay que
 * relacionar. Los separadores son la línea de pelo del tema, decorativa: lo que
 * distingue las columnas es su etiqueta, no la raya.
 *
 * **Sólo el `Total` va en amarillo.** El acento es identidad y responde «cuánto
 * ha costado esto» — la misma función que cumple en el Disponible de Inicio. La
 * posición conserva el color de su estado —rojo si debes, verde si te deben,
 * blanco en paz— y `Tú gastaste` es texto normal: no es una posición y teñirla
 * sugeriría una dirección que no tiene.
 *
 * ═══════════ TRES COLUMNAS, HASTA QUE NO CABEN ═══════════
 *
 * A partir de cierto ancho de columna las cifras dejarían de caber en una línea,
 * y encogerlas por debajo de su rol no es una opción: `design-direction.md` §8
 * no admite que un importe se lea peor por ganar sitio. Así que **la tarjeta se
 * apila**: las tres zonas pasan a filas, cada una con su etiqueta y su cifra a
 * lo ancho, y el separador cambia de vertical a horizontal.
 *
 * El umbral no es un ancho de pantalla: es el ancho **por columna** que el
 * contenido necesita. Se calcula con el ancho real de la ventana y el factor de
 * tipografía del sistema, así que a 411 dp con la letra al 200 % se apila igual
 * que a 320 dp con la letra normal — que es lo correcto, porque el problema es el
 * mismo.
 */
export type GroupSummaryCardProps = {
  readonly summary: GroupSummary;
  /** La divisa base del grupo. Todas las cifras van en ella. */
  readonly currency: CurrencyDefinition;
};

/**
 * El ancho mínimo que una columna necesita, y de dónde sale el número.
 *
 * **Del contenido corriente, no del peor caso.** Un importe de tres dígitos con
 * decimales y símbolo son siete caracteres a `amountRow` —17 pt—, unos 66 pt,
 * más el relleno lateral de la columna (`sm` a cada lado) = **88**. Un importe excepcionalmente largo no
 * decide la disposición de los demás: para eso está `adjustsFontSizeToFit`, que
 * lo encoge dentro de su columna hasta el 80 % sin bajar de ahí.
 *
 * Dimensionarlo por el peor caso —`1.234.567,89 €`, unos 132— apilaba la tarjeta
 * **siempre**, incluso a 411 dp con la letra normal, que es justo cuando las tres
 * columnas caben de sobra. Medido en el emulador.
 */
const MIN_COLUMN = 88;

export function GroupSummaryCard({ summary, currency }: GroupSummaryCardProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();
  const { width, fontScale } = useWindowDimensions();

  /*
   * ¿Caben tres columnas? El ancho útil es la ventana menos el margen de la
   * pantalla y el relleno de la tarjeta, repartido entre tres. El factor de
   * tipografía entra porque una cifra al 200 % necesita el doble de sitio.
   */
  const usable = width - Spacing.lg * 2 - Spacing.md * 2;
  const stacked = usable / 3 < MIN_COLUMN * fontScale;

  const state = positionState(summary.position);
  const positionMinor = positionAmount(summary.position);

  const zones: readonly {
    readonly key: string;
    readonly label: string;
    readonly text: string;
    readonly tone: TextColor;
  }[] = [
    {
      key: 'position',
      label: t(positionLabel(state)),
      text:
        positionMinor === null
          ? t('home.amountPending')
          : format.money(money(positionMinor, currency)),
      tone: positionTone(state),
    },
    {
      key: 'spent',
      label: t('group.youSpent'),
      text: render(summary.youSpent),
      /* Una cuantía, no una posición: sin dirección, sin color de estado. */
      tone: summary.youSpent.kind === 'unavailable' ? 'textDisabled' : 'text',
    },
    {
      key: 'total',
      label: t('group.total'),
      text: render(summary.total),
      tone: summary.total.kind === 'unavailable' ? 'textDisabled' : 'accent',
    },
  ];

  function render(amount: GroupAmount): string {
    return amount.kind === 'unavailable'
      ? t('home.amountPending')
      : format.money(money(amount.minor, currency));
  }

  return (
    <GlassSurface
      level="regular"
      depth="flat"
      radius={Radius.lg}
      style={[styles.card, stacked ? styles.stack : styles.row]}>
      {zones.map((zone, index) => (
        <View key={zone.key} style={stacked ? styles.stackedZone : styles.zone}>
          {/*
           * El separador va ANTES de cada zona menos la primera, y cambia de
           * eje con la disposición. Es de pelo y decorativo: quien distingue las
           * columnas es la etiqueta.
           */}
          {index === 0 ? null : (
            <View
              style={[
                stacked ? styles.ruleHorizontal : styles.ruleVertical,
                { backgroundColor: theme.border },
              ]}
            />
          )}
          <View style={stacked ? styles.stackedFigure : styles.figure}>
            <ThemedText variant="caption" themeColor="textTertiary" numberOfLines={1}>
              {zone.label}
            </ThemedText>
            {/*
             * `amountRow` y no `amountHero`: son tres magnitudes emparejadas, y
             * ninguna debe dominar a las otras dos. `adjustsFontSizeToFit` con
             * una sola línea deja que una cifra excepcionalmente larga encoja
             * dentro de su columna en vez de recortarse a la mitad.
             */}
            <ThemedText
              variant="amountRow"
              themeColor={zone.tone}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}>
              {zone.text}
            </ThemedText>
          </View>
        </View>
      ))}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  stack: {
    flexDirection: 'column',
    gap: Spacing.sm,
  },
  /** Las tres del mismo ancho: `flex: 1` con `minWidth: 0` para poder encoger. */
  zone: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
  },
  stackedZone: {
    flexDirection: 'column',
    gap: Spacing.sm,
  },
  figure: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xxs,
  },
  /**
   * Apilada, cada zona es una FILA: etiqueta a la izquierda y cifra a la
   * derecha. Apilarlas también dentro haría la tarjeta el doble de alta sin
   * ganar nada — a lo ancho sobra sitio, que es precisamente por lo que se ha
   * dejado de repartir en tres.
   */
  stackedFigure: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  ruleVertical: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  ruleHorizontal: {
    height: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
});
