import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { EmptyState, Icon, ThemedText } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

import { type CategoryRow, categoryIcon, categoryName } from './category';
import { type CategorySlice, sliceAngles, splitTop } from './statistics';

/**
 * El reparto del gasto por categoría, en el intervalo elegido.
 *
 * **Versión gratuita: se muestra el PORCENTAJE, nunca el importe por
 * categoría.** El servidor sí devuelve el importe exacto —la agregación tiene
 * que ser exacta o no sirve— y esta superficie decide no pintarlo. Es una
 * decisión de producto y por eso está aquí, en la presentación, y no escondida
 * en la consulta: cuando Premium lo abra, el dato ya está y no hay que tocar la
 * frontera.
 *
 * **El color no identifica nada por sí solo.** Cada porción tiene su fila en la
 * leyenda, con icono y nombre, y la rampa va ordenada por luminancia para que
 * el diagrama siga siendo legible en escala de grises. Es la regla obligatoria
 * de `design-direction.md` §8, no una preferencia.
 */
export type CategoryCardProps = {
  readonly slices: readonly CategorySlice[];
  readonly categories: ReadonlyMap<string, CategoryRow>;
};

/**
 * La rampa del diagrama, construida SÓLO con tokens ya validados.
 *
 * Ordenada por luminancia descendente a propósito: así la porción mayor es
 * también la más luminosa, el orden visual coincide con el orden de la leyenda,
 * y en escala de grises se siguen distinguiendo. No se inventan hues nuevos —
 * el amarillo de Nomey es identidad y acento, y multiplicar colores en una app
 * financiera es exactamente lo que `design-direction.md` §2 evita.
 */
function useRamp(): string[] {
  const theme = useTheme();
  return [
    theme.accent,
    theme.text,
    theme.textSecondary,
    theme.textTertiary,
    theme.borderInteractive,
  ];
}

const DIAMETER = 116;
const RING = 22;

export function CategoryCard({ slices, categories }: CategoryCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const ramp = useRamp();
  const [expanded, setExpanded] = useState(false);

  const { top, rest } = splitTop(slices);

  if (slices.length === 0) {
    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <EmptyState
          symbol="chart.pie"
          title={t('home.categoriesEmpty')}
          description={t('home.categoriesEmptyHint')}
        />
      </View>
    );
  }

  const visible = expanded ? slices : top;

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.head}>
        <ThemedText variant="caption" themeColor="textTertiary">
          {t('home.categories')}
        </ThemedText>
        {rest.length === 0 ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={t(expanded ? 'home.categoriesLess' : 'home.categoriesMore')}
            onPress={() => setExpanded((value) => !value)}
            hitSlop={Spacing.sm}>
            <Icon
              name={expanded ? 'chevron.up' : 'chevron.down'}
              size={13}
              colour={theme.textSecondary}
            />
          </Pressable>
        )}
      </View>

      <View style={styles.body}>
        <Donut slices={slices} ramp={ramp} hole={theme.surface} />

        <View style={styles.legend}>
          {visible.map((slice, index) => (
            <LegendRow
              key={slice.categoryId}
              slice={slice}
              colour={ramp[index % ramp.length]}
              category={categories.get(slice.categoryId)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function LegendRow({
  slice,
  colour,
  category,
}: {
  slice: CategorySlice;
  colour: string;
  category: CategoryRow | undefined;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const name = categoryName(category, t);
  const symbol = categoryIcon(category);
  // Una categoría que el catálogo no resuelve NO se pinta como identificador ni
  // como clave cruda: se dice que no se conoce, que es información honesta.
  const label = name ?? t('home.categoryUnknown');
  const share = format.percent(slice.share, 1);

  return (
    <View accessibilityLabel={`${label} ${share}`} style={styles.legendRow}>
      <View style={[styles.swatch, { backgroundColor: colour }]} />
      {symbol === null ? null : (
        <Icon name={symbol as never} size={14} colour={theme.textTertiary} />
      )}
      <ThemedText variant="bodySmall" numberOfLines={1} style={styles.legendName}>
        {label}
      </ThemedText>
      {/* Porcentaje, nunca el importe: es lo que la versión gratuita muestra. */}
      <ThemedText variant="bodySmall" themeColor="textSecondary">
        {share}
      </ThemedText>
    </View>
  );
}

/**
 * El diagrama de sectores, con `View` y nada más.
 *
 * No hay biblioteca de SVG en el proyecto y **añadir una dependencia de runtime
 * exige aprobación explícita** (`AGENTS.md`), así que el sector se construye con
 * geometría de caja:
 *
 *   · un recorte que deja ver sólo la MITAD DERECHA del círculo;
 *   · dentro, un semicírculo con `transformOrigin` en el centro del círculo,
 *     girado `sweep - 180` grados: la intersección con el recorte es
 *     exactamente el sector de 0 a `sweep`;
 *   · un sector mayor de media vuelta se pinta en dos mitades;
 *   · el grupo entero se gira hasta su ángulo de inicio.
 *
 * El agujero central es un círculo del color de la tarjeta pintado encima. Todo
 * el conjunto queda oculto a accesibilidad: **lo que se lee es la leyenda**, y
 * un lector de pantalla no gana nada anunciando doce cajas.
 */
function Donut({
  slices,
  ramp,
  hole,
}: {
  slices: readonly CategorySlice[];
  ramp: readonly string[];
  hole: string;
}) {
  const angles = sliceAngles(slices);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.donut}>
      {angles.map((angle, index) => (
        <Sector
          key={slices[index].categoryId}
          start={angle.start}
          sweep={angle.sweep}
          colour={ramp[index % ramp.length]}
        />
      ))}
      <View style={[styles.hole, { backgroundColor: hole }]} />
    </View>
  );
}

function Sector({ start, sweep, colour }: { start: number; sweep: number; colour: string }) {
  return (
    <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${start}deg` }] }]}>
      <Wedge sweep={Math.min(sweep, 180)} colour={colour} />
      {sweep > 180 ? (
        <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: '180deg' }] }]}>
          <Wedge sweep={sweep - 180} colour={colour} />
        </View>
      ) : null}
    </View>
  );
}

function Wedge({ sweep, colour }: { sweep: number; colour: string }) {
  const half = DIAMETER / 2;

  return (
    <View style={styles.rightHalf}>
      <View
        style={{
          width: half,
          height: DIAMETER,
          borderTopRightRadius: half,
          borderBottomRightRadius: half,
          backgroundColor: colour,
          transformOrigin: 'left center',
          transform: [{ rotate: `${sweep - 180}deg` }],
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  donut: {
    width: DIAMETER,
    height: DIAMETER,
    borderRadius: DIAMETER / 2,
    overflow: 'hidden',
  },
  rightHalf: {
    position: 'absolute',
    left: DIAMETER / 2,
    top: 0,
    width: DIAMETER / 2,
    height: DIAMETER,
    overflow: 'hidden',
  },
  hole: {
    position: 'absolute',
    left: RING,
    top: RING,
    width: DIAMETER - RING * 2,
    height: DIAMETER - RING * 2,
    borderRadius: (DIAMETER - RING * 2) / 2,
  },
  legend: {
    flex: 1,
    gap: Spacing.sm,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  legendName: {
    flex: 1,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: Radius.full,
  },
});
