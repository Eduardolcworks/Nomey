import { StyleSheet, TextInput, View } from 'react-native';

import { type MessageKey, useTranslation } from '@/lib/i18n';
import { type CategoryRow, categoryIcon, categoryName, categoryOptions } from '@/lib/categories';
import {
  CategoryTrigger,
  DateSheet,
  GlassPressable,
  GlassSurface,
  Icon,
  MenuPill,
  OptionMenu,
  PILL_HEIGHT,
  ThemedText,
} from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import type { GroupParticipant } from './participant-service';
import { type SharedExpenseDraft, type SplitMode, SPLIT_MODES } from './shared-expense';

/** Cómo se llama cada método en el catálogo. Uno por valor, sin comodines. */
const MODE_KEY = {
  equal: 'group.splitEqual',
  shares: 'group.splitShares',
  amounts: 'group.splitAmounts',
} as const satisfies Record<SplitMode, string>;

/**
 * LO QUE UN GASTO COMPARTIDO TIENE ADEMÁS DE UNA CIFRA.
 *
 * Dos filas, y en este orden:
 *
 *   concepto ··············· categoría · fecha
 *   Pagado por                Reparto
 *   [nombre] (Tú)      ▾      Igualmente     ▾
 *
 * La primera es exactamente la del alta de un movimiento personal: el concepto
 * ocupando el ancho y dos círculos a la derecha, del mismo lado y en el mismo
 * orden. **El de categoría es la misma pieza** —`CategoryTrigger`, con su
 * material, su lado y sus iconos— desplegando el mismo catálogo con el mismo
 * menú del sistema. No hay un segundo botón parecido ni un segundo catálogo.
 *
 * La segunda son los dos oblongos, en la misma línea, mitad y mitad, con el hueco
 * que ya separa a los controles de la fila de arriba. Los dos son el MISMO
 * control —`OptionMenu` sobre `MenuPill`— con distintas opciones: el menú es el
 * del sistema, el mismo que despliega la categoría en Inicio. No hay un segundo
 * sistema de menús, y no se ha añadido ninguna dependencia para tenerlos.
 *
 * **Cada oblongo lleva su rótulo encima**, alineado a su borde izquierdo y con el
 * mismo rol tipográfico que «Repartir entre». El rótulo dice QUÉ se elige y el
 * oblongo enseña sólo lo ELEGIDO: dentro ya no cabe «Pagado por Fulano», que a
 * 148 puntos se recortaba antes de llegar al nombre — justo la mitad que importa.
 */
export function SharedExpenseFields({
  draft,
  participants,
  onChangeConcept,
  onChangeCategory,
  onOpenDate,
  categories,
  onChangePayer,
  onChangeMode,
  selfParticipantId,
}: {
  readonly draft: SharedExpenseDraft;
  readonly participants: readonly GroupParticipant[];
  readonly onChangeConcept: (value: string) => void;
  readonly onChangeCategory: (categoryId: string) => void;
  readonly onOpenDate: () => void;
  /**
   * El catálogo REAL del actor, ya filtrado a lo elegible.
   *
   * Llega por `prop` desde la ruta y no se carga aquí: quien lo trae es
   * `useEntryCategories`, que vive en la otra feature y que sólo una ruta puede
   * montar. Es lo que permite compartir el catálogo sin que una feature importe
   * de otra ni exista una segunda copia.
   */
  readonly categories: readonly CategoryRow[];
  readonly onChangePayer: (participantId: string) => void;
  readonly onChangeMode: (mode: SplitMode) => void;
  /**
   * QUIÉN ES QUIEN MIRA, resuelto por su VÍNCULO con la cuenta.
   *
   * `null` mientras no se pueda saber, que es hoy: `api.group_participant` no
   * publica `core.participant_user_link` —revelaría qué cuenta global hay detrás
   * de cada identidad contextual, F03/ADR-009 §1— y ninguna otra vista lo suple.
   *
   * **No se sustituye por un parecido.** Ni por nombre ni cogiendo al primero:
   * un acierto ocasional es peor que una casilla vacía, porque nadie la
   * revisaría. Con `null` el «(Tú)» sencillamente no aparece y el pagador se
   * elige a mano; el día que la superficie lo publique, esto se rellena y todo
   * lo demás ya está escrito.
   */
  readonly selfParticipantId: string | null;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const payer = participants.find((one) => one.participantId === draft.payerId) ?? null;
  const chosen = categories.find((row) => row.id === draft.categoryId) ?? null;

  return (
    <>
      <View style={styles.row}>
        <GlassSurface
          material="control"
          level="regular"
          depth="well"
          rim="soft"
          radius={Radius.full}
          /* Superficie de campo: se toca y se escribe en ella. Es un control. */
          nativeEffect={false}
          style={styles.conceptBox}>
          <TextInput
            value={draft.concept}
            onChangeText={onChangeConcept}
            placeholder={t('entry.conceptPlaceholder')}
            placeholderTextColor={theme.textDisabled}
            accessibilityLabel={t('entry.conceptLabel')}
            style={[styles.conceptInput, { color: theme.text }]}
          />
        </GlassSurface>

        {/*
         * LA CATEGORÍA, entre el concepto y la fecha. El mismo círculo y el
         * mismo menú del sistema que en Inicio, con el mismo catálogo: aquí sólo
         * se arma la lista de opciones y se dice cuál está elegida.
         */}
        <OptionMenu
          title={t('entry.categoryTitle')}
          options={categoryOptions(categories, draft.categoryId, t)}
          onSelect={onChangeCategory}>
          <View
            /*
             * `accessible` explícito, por lo mismo que el oblongo: en Android un
             * `View` con rol y etiqueta pero sin él NO abre nodo propio —medido:
             * el botón salía con la descripción vacía— y el control dejaba de
             * anunciarse. Con él es un objetivo, y uno solo.
             */
            accessible
            accessibilityRole="button"
            accessibilityLabel={
              chosen === null
                ? t('entry.categoryEmpty')
                : t('entry.categoryChosen', {
                    name: categoryName(chosen, t) ?? t('entry.categoryUnknown'),
                  })
            }>
            <CategoryTrigger
              icon={categoryIcon(chosen ?? undefined) ?? 'tag'}
              chosen={chosen !== null}
              size={PILL_HEIGHT}
            />
          </View>
        </OptionMenu>

        <GlassPressable label={t('entry.dateLabel')} depth="well" onPress={onOpenDate}>
          <View style={styles.circle}>
            <Icon name={Symbols.calendar} size={20} colour={theme.textSecondary} shape="circle" />
          </View>
        </GlassPressable>
      </View>

      {/*
       * LOS DOS OBLONGOS, MITAD Y MITAD, sin medir nada.
       *
       * El reparto lo hace `OptionMenu`: cada uno vive en un hueco flexible de
       * React Native y el menú nativo va encima, estirado sobre él. La razón —y
       * las dos formas en que fallaba antes— está escrita allí.
       */}
      <View style={[styles.row, styles.pillRow]}>
        {/*
         * PAGADO POR. Un único pagador, elegido entre los participantes REALES
         * del grupo — no entre las cuentas, que es otra cosa (F03/ADR-009 §4).
         *
         * Sin pagador elegido el oblongo NO enseña a nadie: dice que falta
         * elegirlo y se pinta apagado. Poner al primero de la lista habría
         * acertado a veces, que es la peor de las tres opciones.
         */}
        <View style={styles.column}>
          <ThemedText variant="label" themeColor="textSecondary" style={styles.caption}>
            {t('group.payerLabel')}
          </ThemedText>

          <OptionMenu
            height={PILL_HEIGHT}
            title={t('group.payerTitle')}
            options={participants.map((one) => ({
              id: one.participantId,
              title: nameOf(one, selfParticipantId, t),
              selected: one.participantId === draft.payerId,
            }))}
            onSelect={onChangePayer}>
            <MenuPill
              muted={payer === null}
              label={
                payer === null
                  ? t('group.payerEmpty')
                  : t('group.payerChosen', { name: nameOf(payer, selfParticipantId, t) })
              }
              /*
               * Dentro va SÓLO lo elegido: el nombre, y «(Tú)» si esa identidad
               * contextual es la de quien mira. El rótulo de encima ya dice de
               * qué se trata, así que repetir «Pagado por» aquí gastaba en la
               * pregunta el sitio de la respuesta.
               */
              text={payer === null ? t('group.payerEmpty') : nameOf(payer, selfParticipantId, t)}
            />
          </OptionMenu>
        </View>

        {/* EL MÉTODO. Exactamente tres, que son los de F01/ADR-001 §5. */}
        <View style={styles.column}>
          <ThemedText variant="label" themeColor="textSecondary" style={styles.caption}>
            {t('group.splitLabel')}
          </ThemedText>

          <OptionMenu
            height={PILL_HEIGHT}
            title={t('group.methodTitle')}
            options={SPLIT_MODES.map((mode) => ({
              id: mode,
              title: t(MODE_KEY[mode]),
              selected: mode === draft.mode,
            }))}
            onSelect={(id) => {
              onChangeMode(id as SplitMode);
            }}>
            <MenuPill
              label={t('group.methodChosen', { name: t(MODE_KEY[draft.mode]) })}
              text={t(MODE_KEY[draft.mode])}
            />
          </OptionMenu>
        </View>
      </View>
    </>
  );
}

/** El calendario, montado por quien lleva su estado de apertura. */
export function SharedExpenseDate({
  visible,
  value,
  onSelect,
  onClose,
  mode = 'date',
}: {
  readonly visible: boolean;
  readonly value: Date;
  readonly onSelect: (date: Date) => void;
  readonly onClose: () => void;
  /** El mismo control del sistema, para la fecha o para la hora. */
  readonly mode?: 'date' | 'time';
}) {
  const { t } = useTranslation();

  return (
    <DateSheet
      visible={visible}
      value={value}
      mode={mode}
      onSelect={onSelect}
      onClose={onClose}
      title={mode === 'time' ? t('entry.timeTitle') : t('entry.dateTitle')}
      doneLabel={t('action.done')}
      closeLabel={t('action.close')}
    />
  );
}

/**
 * El nombre que se enseña, con «(Tú)» sólo donde corresponde.
 *
 * La comparación es por IDENTIDAD del participante contra el vínculo real, nunca
 * por nombre: dos personas pueden llamarse igual, y un parecido no es prueba de
 * identidad (F03/ADR-009 §3). Sin vínculo conocido, nadie lleva «(Tú)».
 */
function nameOf(
  one: GroupParticipant,
  selfParticipantId: string | null,
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
): string {
  return one.participantId === selfParticipantId
    ? t('group.payerYou', { name: one.displayName })
    : one.displayName;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    /* Por arriba: los dos rótulos quedan en la misma línea pase lo que pase. */
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  /**
   * La mitad de la fila. El reparto lo hace ESTA columna y no el menú: una vista
   * de React Native reparte el ancho como debe, y el nativo de dentro se estira
   * dentro de ella con su alto declarado.
   */
  column: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xs,
  },
  /**
   * ═══════ LA FILA DE OBLONGOS RESERVA SU PROPIO SUELO ═══════
   *
   * «Repartir entre» y su tarjeta se montaban sobre estos dos oblongos. **La
   * causa estaba en el hueco del menú de iOS, no aquí**: llevaba `flex: 1`
   * dentro de una columna, y en ese eje `flexBasis: 0` manda sobre el
   * `height` declarado, así que la fila reservaba cero puntos para el oblongo
   * y el anfitrión de SwiftUI lo pintaba fuera de la caja. Está corregido en
   * `option-menu.ios.tsx`: ahora la fila mide rótulo + hueco + oblongo.
   *
   * Lo que queda aquí es la SEPARACIÓN, que es otra cosa: **relleno inferior
   * en la propia fila**, del mismo escalón —`Spacing.sm`— que ya separa la
   * etiqueta de su oblongo, sumado al `gap` de la hoja. Es espacio reservado
   * en el layout, no un desplazamiento: un `translateY` o un margen negativo
   * moverían el dibujo dejando el hueco igual de pequeño.
   *
   * Y no toca el área táctil de nada: los oblongos siguen midiendo
   * `PILL_HEIGHT` y el relleno queda por debajo de ellos, dentro de la fila.
   */
  pillRow: {
    paddingBottom: Spacing.sm,
  },
  /** Alineado al borde izquierdo de su oblongo, no centrado sobre él. */
  caption: {
    textAlign: 'left',
    paddingHorizontal: Spacing.xs,
  },
  conceptBox: {
    flex: 1,
    height: PILL_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  conceptInput: {
    fontSize: 16,
  },
  circle: {
    width: PILL_HEIGHT,
    height: PILL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
