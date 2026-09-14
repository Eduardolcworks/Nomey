import { type CurrencyDefinition, money } from '@/domain';
import { type CategoryRow, categoryName } from '@/lib/categories';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import {
  GlassSurface,
  MenuPill,
  OptionMenu,
  PILL_HEIGHT,
  RangeSlider,
  ThemedText,
} from '@/ui/components';
import { Radius, Spacing } from '@/ui/theme';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { GroupParticipant } from './participant-service';
import { allOf, indexOf, minorAt, type MovementFilters, stepsFor } from './movement-filters';

/**
 * EL PANEL DE FILTROS: una tarjeta DENTRO del flujo, no una capa encima.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  0,00 €                            20,00 €   │
 *   │  ●────────────────────────────────────●      │
 *   │  ┌──────────────────┐ ┌──────────────────┐   │
 *   │  │ Todas las categ… │ │ Todos los parti… │   │
 *   │  └──────────────────┘ └──────────────────┘   │
 *   │                               Restablecer    │
 *   └──────────────────────────────────────────────┘
 *
 * **Empuja el listado, no lo tapa.** Es una tarjeta más del `ScrollView`, así
 * que los movimientos bajan mientras está abierta y vuelven a subir al
 * cerrarla. Una capa flotante habría escondido justo lo que se está filtrando.
 *
 * **Lo que se toca aquí es el BORRADOR.** Cambiar un extremo o elegir una
 * categoría no rehace la consulta: quien decide es el tick de confirmar. Es lo
 * que permite abrir, mirar, arrepentirse y cerrar sin haber cambiado nada — y
 * lo que evita una consulta por fotograma mientras se arrastra la barra.
 *
 * **La altura no se fija.** Crece con sus controles, que es lo que pide que un
 * nombre largo o una letra grande no queden recortados. Lo que sí es
 * deliberado es que quepan holgadamente en el hueco de dos movimientos.
 */
export type FilterPanelProps = {
  /** El borrador: lo tocado y todavía sin aplicar. */
  readonly draft: MovementFilters;
  readonly onChange: (draft: MovementFilters) => void;
  /**
   * El mayor gasto del grupo, del conjunto COMPLETO y sin filtrar.
   *
   * `null` si no se ha podido leer: entonces la barra se apaga en vez de
   * ofrecer un intervalo que no corresponde a nada.
   */
  readonly maxMinor: bigint | null;
  readonly currency: CurrencyDefinition;
  /** Las categorías que un gasto compartido admite. Ya filtradas por la ruta. */
  readonly categories: readonly CategoryRow[];
  readonly participants: readonly GroupParticipant[];
  /**
   * Si lo APLICADO deja gastos fuera. Sólo tiñe «Restablecer».
   *
   * Lo aplicado y no el borrador: el color dice si la lista de abajo está
   * acotada ahora mismo, que es la misma pregunta que responde el embudo.
   */
  readonly restricted: boolean;
};

export function FilterPanel({
  draft,
  onChange,
  maxMinor,
  currency,
  categories,
  participants,
  restricted,
}: FilterPanelProps) {
  const { t } = useTranslation();
  const format = useFormat();

  /*
   * ═══════════ POR QUÉ ESTA FILA SE MIDE ═══════════
   *
   * `MenuView` es un anfitrión de Compose y **se mide por su contenido**: el
   * flexbox de React Native no lo atraviesa. Medido aquí con `uiautomator`,
   * los dos oblongos salían de 518 y 529 px dentro de una tarjeta de 870 y se
   * solapaban 72 px, con el segundo saliéndose por la derecha — y ni `flex: 1`
   * ni `minWidth: 0` en la columna lo evitan, porque el que no cede es el
   * nativo de dentro.
   *
   * Así que se le da un ancho DEFINIDO, que es lo único que respeta. Sale de
   * medir la fila y partirla en dos, no de restar a mano los rellenos de sus
   * ancestros: si mañana cambia el margen de la pantalla o el de la tarjeta,
   * esto sigue siendo correcto.
   *
   * **La medida se aplica en el fotograma siguiente.** Un `setState` dentro de
   * `onLayout` reentra en la pasada de medida de Android y revienta a los
   * hijos de Compose —`performMeasureAndLayout called during measure layout`,
   * medido—; con `requestAnimationFrame` la actualización cae fuera de esa
   * pasada. Hasta entonces las columnas reparten con `flex`, que basta para un
   * fotograma.
   */
  const [rowWidth, setRowWidth] = useState(0);
  const slotWidth = rowWidth > 0 ? (rowWidth - Spacing.sm) / 2 : null;

  const steps = stepsFor(maxMinor);
  const top = maxMinor ?? 0n;

  const chosenCategory = categories.find((one) => one.id === draft.categoryId);
  const chosenParticipant = participants.find((one) => one.participantId === draft.payerId);

  /*
   * LO QUE SE VE DENTRO DE CADA OBLONGO.
   *
   * Sin elegir, el nombre de lo que se puede acotar —«Categorías»,
   * «Participantes»— en el tono de un campo sin rellenar. **No «Todas las
   * categorías»**: esa frase es una OPCIÓN del menú, la que quita la
   * restricción, y usarla también como estado de reposo gastaba el ancho del
   * oblongo en decir que no hay filtro puesto — que es justo lo que el tono
   * apagado ya dice. Sigue estando dentro del menú, que es donde se elige.
   *
   * Con algo elegido, su nombre y en el tono normal: el contraste entre los
   * dos estados es lo que hace legible de un vistazo si el oblongo acota.
   */
  const categoryChosen = draft.categoryId !== null;
  const payerChosen = draft.payerId !== null;

  const categoryText = categoryChosen
    ? (categoryName(chosenCategory, t) ?? t('entry.categoryUnknown'))
    : t('group.filterCategoriesEmpty');
  const participantText = payerChosen
    ? (chosenParticipant?.displayName ?? t('group.filterParticipantsEmpty'))
    : t('group.filterParticipantsEmpty');

  const amount = (minor: bigint) => format.money(money(minor, currency));

  return (
    <GlassSurface level="regular" depth="flat" radius={Radius.lg} style={styles.card}>
      {/*
       * LOS DOS IMPORTES ELEGIDOS, con el formato monetario de siempre. Van
       * encima de la barra y no dentro de los pulgares: ahí no caben, y un
       * intervalo que sólo se lee por la posición de dos círculos no se lee.
       */}
      <View style={styles.amounts}>
        <ThemedText variant="bodySmall" themeColor="textSecondary">
          {amount(draft.minMinor)}
        </ThemedText>
        <ThemedText variant="bodySmall" themeColor="textSecondary">
          {amount(draft.maxMinor ?? top)}
        </ThemedText>
      </View>

      <RangeSlider
        steps={steps}
        low={indexOf(draft.minMinor, top, steps)}
        high={indexOf(draft.maxMinor ?? top, top, steps)}
        lowLabel={t('group.filterFrom', { amount: amount(draft.minMinor) })}
        highLabel={t('group.filterTo', { amount: amount(draft.maxMinor ?? top) })}
        disabled={steps <= 0}
        /*
         * LA CONVERSIÓN, AQUÍ Y EN UN SOLO SITIO. La barra devuelve posiciones
         * —geometría— y lo que se guarda es un importe exacto en unidades
         * menores. Los extremos son literales, así que «desde cero» y «hasta el
         * máximo» nunca se aproximan.
         */
        onChange={(low, high) => {
          onChange({
            ...draft,
            minMinor: minorAt(low, top, steps),
            /* Hasta el final es SIN TOPE, no «hasta el máximo de ahora»: si
             * mañana hay un gasto mayor, la selección sigue queriendo decir
             * lo mismo. */
            maxMinor: high >= steps ? null : minorAt(high, top, steps),
          });
        }}
      />

      <View
        onLayout={(event) => {
          const next = event.nativeEvent.layout.width;
          if (next === rowWidth) return;
          requestAnimationFrame(() => {
            setRowWidth(next);
          });
        }}
        style={styles.row}>
        <Slot
          width={slotWidth}
          title={t('group.filterCategory')}
          text={categoryText}
          muted={!categoryChosen}
          /*
           * El nombre accesible dice SIEMPRE de qué selector se trata, con lo
           * elegido dentro cuando lo hay: «Categoría: Restaurantes». Sin el
           * rótulo exterior, un lector de pantalla no tendría dónde enterarse
           * de qué acota este oblongo.
           */
          label={
            categoryChosen
              ? t('group.filterCategoryChosen', { name: categoryText })
              : t('group.filterCategory')
          }
          options={[
            { id: ALL, title: t('group.filterAllCategories'), selected: draft.categoryId === null },
            ...categories.flatMap((row) => {
              const title = categoryName(row, t);
              /* Una categoría sin nombre resoluble no se ofrece: en un menú del
               * sistema no hay dónde avisar, y F06/ADR-003 no admite enseñar una
               * clave cruda. */
              return title === null
                ? []
                : [{ id: row.id, title, selected: row.id === draft.categoryId }];
            }),
          ]}
          onSelect={(id) => {
            onChange({ ...draft, categoryId: id === ALL ? null : id });
          }}
        />

        <Slot
          width={slotWidth}
          /*
           * El encabezado del menú y el nombre accesible dicen los dos que lo
           * que se acota es QUIÉN PAGÓ. El texto visible sigue siendo
           * «Participantes» en reposo — es el nombre de lo que se elige—, pero
           * un lector de pantalla necesita saber qué se hace con esa elección.
           */
          title={t('group.payerTitle')}
          text={participantText}
          muted={!payerChosen}
          label={
            payerChosen
              ? t('group.filterPayerChosen', { name: participantText })
              : t('group.filterPayer')
          }
          options={[
            {
              id: ALL,
              title: t('group.filterAllParticipants'),
              selected: draft.payerId === null,
            },
            /*
             * LOS PARTICIPANTES REALES DEL GRUPO, tengan cuenta o no. Un
             * participante existe sin cuenta desde F03/ADR-009 §1, y dejar fuera a
             * quien todavía no ha instalado nada haría imposible filtrar por la
             * mitad de la gente de un viaje.
             */
            ...participants.map((one) => ({
              id: one.participantId,
              title: one.isSelf ? t('group.payerYou', { name: one.displayName }) : one.displayName,
              selected: one.participantId === draft.payerId,
            })),
          ]}
          onSelect={(id) => {
            onChange({ ...draft, payerId: id === ALL ? null : id });
          }}
        />
      </View>

      {/*
       * RESTABLECER, discreto y dentro del panel. Devuelve el BORRADOR a
       * «todo»: no aplica nada por su cuenta, igual que el resto de controles
       * de aquí. Lo que aplica es el tick.
       *
       * **Su área táctil ES el hueco que queda bajo los oblongos.** La tarjeta
       * no lleva `gap`; cada pieza declara su separación, y ésta no declara
       * ninguna: su caja empieza donde acaba la fila y termina en el borde
       * interior de la tarjeta, con relleno simétrico. Así el texto queda
       * centrado en ese hueco por construcción, sin desplazarlo a ojo, y de
       * paso el objetivo es todo el ancho de esa banda en vez de la altura de
       * una línea.
       *
       * **El acento sigue a lo APLICADO, no al borrador.** Es lo mismo que
       * decide el color del embudo, y por la misma razón: dice si la lista de
       * abajo está acotada ahora mismo. Un borrador a medio tocar todavía no
       * esconde ningún gasto.
       */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('group.filterReset')}
        onPress={() => {
          onChange(allOf());
        }}
        style={styles.reset}>
        <ThemedText variant="caption" themeColor={restricted ? 'accent' : 'textTertiary'}>
          {t('group.filterReset')}
        </ThemedText>
      </Pressable>
    </GlassSurface>
  );
}

/**
 * La identidad de «sin acotar» dentro del menú nativo.
 *
 * Un valor propio y no la cadena vacía: el menú devuelve un identificador de
 * texto, y `''` se confundiría con una opción sin id. Nunca sale de aquí — se
 * traduce a `null` en el mismo sitio donde se lee.
 */
const ALL = '__all__';

/** Uno de los dos oblongos que comparten la fila. */
function Slot({
  width,
  title,
  text,
  muted,
  label,
  options,
  onSelect,
}: {
  /** El ancho medido de su mitad, o `null` en el primer fotograma. */
  readonly width: number | null;
  readonly title: string;
  readonly text: string;
  readonly muted: boolean;
  readonly label: string;
  readonly options: readonly {
    readonly id: string;
    readonly title: string;
    readonly selected: boolean;
  }[];
  readonly onSelect: (id: string) => void;
}) {
  return (
    /*
     * EL REPARTO DEL ANCHO LO HACE ESTA COLUMNA, no el menú. `MenuView` es un
     * anfitrión de Compose y se mide POR SU CONTENIDO: el flexbox de React
     * Native no lo atraviesa, así que un nombre largo desbordaba la tarjeta y
     * se montaba encima del oblongo de al lado — medido en el emulador. Con
     * `flex: 1` más `minWidth: 0` en la columna y el alto declarado en el menú,
     * el disparador se estira dentro y el texto se recorta con elipsis.
     *
     * Es exactamente la disposición de «Pagado por» y «Reparto», que ya pasó
     * por esto.
     */
    <View style={[styles.slot, width === null ? null : { width }]}>
      {/*
       * SIN RÓTULO ENCIMA. Lo que el oblongo acota lo dice él mismo —su texto
       * de reposo es «Categorías» o «Participantes»— y el encabezado del menú
       * lo repite al abrirlo. Un rótulo exterior decía dos veces lo mismo y
       * subía la tarjeta dos líneas.
       */}
      <OptionMenu title={title} options={options} onSelect={onSelect} height={PILL_HEIGHT}>
        <MenuPill text={text} label={label} muted={muted} width={width ?? undefined} />
      </OptionMenu>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * SIN `gap`. Con él, el hueco entre la fila de oblongos y el borde interior
   * de la tarjeta se repartía entre una separación y el relleno de
   * «Restablecer», y su área táctil quedaba descentrada en ese hueco.
   * Declarando cada separación en su pieza, la última ocupa el hueco entero.
   */
  card: {
    padding: Spacing.md,
  },
  amounts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  slot: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xxs,
  },

  /**
   * Ocupa el hueco entero bajo los oblongos: sin margen arriba y con relleno
   * simétrico, así que su contenido queda centrado en él por construcción.
   * La alineación horizontal no cambia.
   */
  reset: {
    alignSelf: 'flex-end',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
});
