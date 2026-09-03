import { useState } from 'react';
import { PixelRatio, Platform, Pressable, StyleSheet, View } from 'react-native';

import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { EmptyState, Icon, ThemedText } from '@/ui/components';
import {
  categoryColour,
  categorySymbol,
  HomeCardRelief,
  homeCardSurface,
  Radius,
  Spacing,
  Symbols,
  useTheme,
} from '@/ui/theme';

import { type CategoryRow, categoryIcon, categoryName } from './category';
import { type CategorySlice, sliceAngles, splitTop } from './statistics';

/**
 * El reparto del gasto por categoría, en el intervalo elegido.
 *
 * **Versión gratuita: se muestra el PORCENTAJE, nunca el importe por
 * categoría.** El servidor sí devuelve el importe exacto —la agregación tiene
 * que ser exacta o no sirve, y es lo que hace posible el reparto— y esta
 * superficie decide no pintarlo. La decisión vive en la presentación, así que
 * cuando Premium lo abra no hay que tocar la frontera.
 *
 * **El color no identifica nada por sí solo.** Cada porción tiene su fila con
 * nombre y porcentaje, que es la representación autoritativa y la accesible.
 * `design-direction.md` §8 lo exige, y aquí importa el doble: la paleta es
 * cerrada, así que con muchas categorías dos pueden compartir tono.
 *
 * **El intervalo no se guarda aquí.** Las porciones llegan ya calculadas desde
 * `api.personal_statistics`, que las agrega en el servidor para el intervalo que
 * gobierna toda la pantalla. Un estado temporal propio sería una segunda
 * respuesta a la misma pregunta.
 */
export type CategoryCardProps = {
  readonly slices: readonly CategorySlice[];
  readonly categories: ReadonlyMap<string, CategoryRow>;
};

/**
 * EL SOLAPE QUE TAPA LA COSTURA DEL DIÁMETRO VERTICAL.
 *
 * ======================== QUÉ SE MIDIÓ, Y DÓNDE ============================
 *
 * Una línea oscura de **una sola columna** —x = 270 en la captura nativa, color
 * 28,28,30— recorría el anillo a 0° y a 180°, de y = 1784 a y = 1847:
 * exactamente desde el canto del agujero hasta el borde exterior, y ni un píxel
 * dentro del hueco. Debajo asomaba la superficie de la tarjeta.
 *
 * **No era una unión entre sectores.** A 180° no hay frontera de datos —las de
 * esa muestra caen en 0° y 199,4°— y `sliceAngles` cierra el último tramo en
 * 360 exactos, así que tampoco hay hueco de redondeo al dar la vuelta. Aquí no
 * hay SVG, ni trazo, ni separación intencionada, ni una capa de más.
 *
 * Lo que hay es **rasterización con coordenadas fraccionarias**: el recorte de
 * `rightHalf` cae en `DIAMETER / 2` = 62 dp, que a densidad 2,625 son 162,75
 * píxeles físicos. La mitad derecha empieza en el píxel 163 y la izquierda
 * termina en el 162, así que **la columna del medio no la pinta ninguna de las
 * dos**. A densidad 2 o 3 —las de iOS— 62 dp caen en un píxel entero y la
 * costura no puede existir, de modo que el solape es de Android y allí vale
 * exactamente CERO.
 *
 * La cifra no es un ángulo elegido a ojo: 1 / PixelRatio.get() es la expresión
 * en dp de **un píxel físico**, que es el ancho medido del defecto.
 *
 * Lo que NO cambia es el reparto. El solape ensancha la caja del semicírculo y
 * su recorte hacia el centro; el arco exterior sigue siendo una circunferencia
 * de radio `half` con su centro donde estaba, porque los radios de esquina no
 * se tocan, y la máscara circular de `pie` sigue fijando el diámetro. El pivote
 * del giro queda a un píxel del centro, dentro del agujero, que se pinta
 * encima.
 */
const SEAM = Platform.OS === 'android' ? 1 / PixelRatio.get() : 0;

/**
 * Diámetro del gráfico y hueco central.
 *
 * **Un anillo, no un sector macizo.** El hueco es el 61% del diámetro, así que
 * el aro mide 24 puntos de grosor. Empezó siendo el 27% —un aro de 45— y sobre
 * la pantalla el gráfico se leía pesado: demasiada tinta para lo que dice, al
 * lado de una lista que es la que lleva los nombres y los porcentajes.
 *
 * El valor se buscó mirándolo, y de ahí el vaivén: 45 pesaba, se bajó a 22, se
 * probó 19 y el aro quedó demasiado hilo con demasiado hueco. 24 es el punto
 * en el que se paró — ligero, pero todavía un aro con cuerpo.
 *
 * **El diámetro exterior no se mueve.** Es lo que fija la altura del bloque y
 * su alineación con la lista de la derecha; cambiarlo movería la tarjeta
 * entera, y lo que se buscaba era aligerar el aro, no encoger el gráfico.
 *
 * Lo que se pierde con un aro fino es el juicio a ojo de proporciones
 * parecidas: todos los sectores tienen el mismo grosor, así que sólo el ángulo
 * las distingue. Es asumible aquí y no en un gráfico suelto, porque **la
 * representación autoritativa es la lista** —nombre y porcentaje por fila, como
 * exige `design-direction.md` §8— y el aro acompaña.
 *
 * Ni el hueco ni el diámetro entran en el reparto: los sectores se dibujan por
 * ángulo, y el hueco es un círculo pintado encima al final.
 */
const DIAMETER = 124;
const HOLE = 76;

export function CategoryCard({ slices, categories }: CategoryCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const { top, rest } = splitTop(slices);

  /**
   * Sin gasto no hay reparto, y no se inventa uno.
   *
   * Es el caso `expense_total = 0`, que la frontera define devolviendo la lista
   * vacía. No se pintan cuatro categorías al 0%, que serían cuatro afirmaciones
   * falsas sobre categorías que no han recibido nada.
   */
  if (slices.length === 0) {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: homeCardSurface(theme.surface), borderColor: theme.border },
          HomeCardRelief,
        ]}>
        <EmptyState
          symbol={Symbols.breakdown}
          title={t('home.categoriesEmpty')}
          description={t('home.categoriesEmptyHint')}
        />
      </View>
    );
  }

  const visible = expanded ? slices : top;
  /*
   * Con cuatro o menos no hay nada que desplegar, así que NO se pinta un
   * chevron que no llevaría a ninguna parte. Una flecha inerte es peor que su
   * ausencia: promete contenido que no existe.
   */
  const expandable = rest.length > 0;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: homeCardSurface(theme.surface), borderColor: theme.border },
        HomeCardRelief,
      ]}>
      <View style={styles.head}>
        <ThemedText variant="caption" themeColor="textTertiary">
          {t('home.categories')}
        </ThemedText>
        {expandable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={t(expanded ? 'home.categoriesLess' : 'home.categoriesMore')}
            onPress={() => setExpanded((value) => !value)}
            hitSlop={Spacing.md}>
            <Icon
              name={expanded ? Symbols.collapse : Symbols.expand}
              size={13}
              colour={theme.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.body}>
        <Pie slices={slices} hole={homeCardSurface(theme.surface)} />

        <View style={styles.legend}>
          {visible.map((slice) => (
            <LegendRow
              key={slice.categoryId}
              slice={slice}
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
  category,
}: {
  slice: CategorySlice;
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
    <View accessible accessibilityLabel={`${label} ${share}`} style={styles.legendRow}>
      {/*
       * El mismo `categoryColour` que pinta el sector, no una copia de la
       * paleta: el indicador y su porción no pueden discrepar porque salen de
       * la misma función con el mismo argumento.
       */}
      <View style={[styles.swatch, { backgroundColor: categoryColour(slice.categoryId) }]} />
      {symbol === null ? null : (
        <Icon name={categorySymbol(symbol)} size={14} colour={theme.textTertiary} />
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
 * ==================== POR QUÉ CADA SECTOR BARRE HASTA EL FINAL ==============
 *
 * Cada porción **no** se pinta con su propio ángulo, sino desde su inicio hasta
 * los 360°, y se pintan en orden para que la siguiente tape a la anterior. El
 * resultado visible es idéntico —cada una acaba enseñando exactamente su
 * ángulo— pero **desaparecen las costuras**: dos sectores contiguos pintados
 * cada uno con su ángulo comparten un borde, y el antialiasing de ese borde
 * deja una línea del fondo asomando entre ellos.
 *
 * Lo importante es lo que esto NO hace: no cambia ni un grado del reparto. La
 * frontera de cada porción sigue estando donde su porcentaje dice, porque la
 * marca el inicio de la siguiente. La alternativa habitual —solapar unas
 * décimas de grado— sí habría falseado la proporción, y en un gráfico cuya
 * única función es comparar tamaños eso no es aceptable.
 *
 * El agujero central es un círculo del color de la tarjeta pintado encima. Todo
 * el conjunto queda oculto a accesibilidad: **lo que se lee es la leyenda**, y
 * un lector de pantalla no gana nada anunciando una docena de cajas.
 */
function Pie({ slices, hole }: { slices: readonly CategorySlice[]; hole: string }) {
  const angles = sliceAngles(slices);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.pie}>
      {angles.map((angle, index) => (
        <Sector
          key={slices[index].categoryId}
          start={angle.start}
          // Hasta el final, no su propio ángulo. Ver la nota de arriba.
          sweep={360 - angle.start}
          colour={categoryColour(slices[index].categoryId)}
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
          // El pixel de mas va al lado del centro; el arco exterior no se mueve.
          width: half + SEAM,
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
    gap: Spacing.lg,
  },
  pie: {
    width: DIAMETER,
    height: DIAMETER,
    borderRadius: DIAMETER / 2,
    overflow: 'hidden',
  },
  rightHalf: {
    position: 'absolute',
    // El recorte se abre un pixel hacia el centro para que el semicirculo pueda
    // pintar ahi. Sin esto la caja mas ancha se recortaria en el mismo sitio.
    left: DIAMETER / 2 - SEAM,
    top: 0,
    width: DIAMETER / 2 + SEAM,
    height: DIAMETER,
    overflow: 'hidden',
  },
  hole: {
    position: 'absolute',
    left: (DIAMETER - HOLE) / 2,
    top: (DIAMETER - HOLE) / 2,
    width: HOLE,
    height: HOLE,
    borderRadius: HOLE / 2,
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
