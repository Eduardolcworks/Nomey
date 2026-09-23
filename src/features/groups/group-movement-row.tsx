import { Pressable, StyleSheet, View } from 'react-native';

import { type CurrencyDefinition, money } from '@/domain';
import { type CategoryRow, categoryIcon, categoryName } from '@/lib/categories';
import { useFormat } from '@/lib/format';
import { type MessageKey, useTranslation } from '@/lib/i18n';
import { Icon, IconButton, SwipeToDelete, ThemedText } from '@/ui/components';
import { categoryColour, categorySymbol, Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import type { GroupOperation, GroupOperationConversion } from './group-service';
import { SPLIT_MODES, type SplitMode } from './shared-expense';

/**
 * UN GASTO DEL GRUPO, EN UNA FILA QUE SE DESPLIEGA.
 *
 *   ┌───┬──────────────────────────────┬───────────┐
 *   │ 🍽 │ Cena de prueba               │   10,00 € │
 *   │   │ Pagado por Ana · 8/9/26       │           │
 *   ├───┴──────────────────────────────┴───────────┤
 *   │      Reparto            Igualmente           │
 *   │      Tu parte              2,50 €            │
 *   │      ✏  🗑                                    │
 *   └──────────────────────────────────────────────┘
 *
 * **Misma anatomía que la fila de Inicio**: cabecera pulsable que alterna, y el
 * detalle debajo con sus dos acciones al final. No navega a ninguna parte y no
 * remonta la lista — lo único que cambia es qué se pinta bajo la cabecera.
 *
 * ═══════════ QUÉ VA ARRIBA Y QUÉ SÓLO AL ABRIR ═══════════
 *
 * **Cerrada dice quién puso el dinero, y eso es un hecho leído**, no una
 * inferencia: sale de `core.split` a través de `api.group_operation`. No es
 * quien registró la operación —que ni se publica— ni quien tiene cuota.
 *
 * **La cifra grande es el gasto entero**, la distinción de `AGENTS.md` §2: la
 * cena costó 10 y quien mira consumió 2,50. La cuota baja al detalle para que la
 * fila cerrada no ponga dos importes a competir; ahí va etiquetada como «Tu
 * parte», que es lo que es — ni lo adelantado como pagador ni la deuda viva.
 *
 * **Sin cuota no se pinta un cero.** Quien no entró en el reparto no gastó
 * `0,00`: se dice que no participó. Y si su identidad no se puede resolver
 * tampoco se inventa: son dos ausencias distintas y ninguna es una cifra.
 *
 * **Ni signo ni color de dirección.** Un gasto compartido no es una entrada ni
 * una salida del bolsillo de quien mira, así que la cuantía va sin `+` ni `−`.
 *
 * **El nombre de la categoría se resuelve contra el catálogo**, nunca copiado en
 * el gasto (F06/ADR-003), y sigue siendo lo que colorea el círculo: lo que se retiró
 * es su línea de texto, no la categoría.
 */
export type GroupMovementRowProps = {
  readonly operation: GroupOperation;
  readonly categories: ReadonlyMap<string, CategoryRow>;
  /** Los nombres de los participantes del grupo, por su identidad contextual. */
  readonly participants: ReadonlyMap<string, string>;
  /** La divisa base del grupo. Las dos cifras van en ella. */
  readonly currency: CurrencyDefinition;
  /**
   * La moneda DECLARADA del gasto, cuando no es la del grupo (F11/ADR-003).
   * El total va en ella; la cuota y el resto, en la del grupo. Sin conversion
   * o sin poder resolverla, se usa la del grupo, que es correcta para todo lo
   * demas.
   */
  readonly declaredCurrency?: CurrencyDefinition | null;
  /**
   * LA CONVERSIÓN CONGELADA de este gasto, cuando la hubo (F11/ADR-003).
   *
   * Con ella se enseña el total convertido, el tipo y su fuente. **No se
   * recalcula nada para leer**: si el tipo de hoy fuera otro, esta fila
   * seguiría diciendo el que se usó, que es el único que explica su importe
   * (F11/ADR-001 §9). Ausente en un gasto sin convertir, y entonces no se
   * pinta ninguna sección de cambio.
   */
  readonly conversion?: GroupOperationConversion;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  /** Mientras ESTA fila se está anulando. Bloquea sus dos acciones y nada más. */
  readonly deleting?: boolean;
};

/** Cómo se llama cada método de reparto. El mismo vocabulario del alta. */
const METHOD_KEY = {
  equal: 'group.splitEqual',
  shares: 'group.splitShares',
  amounts: 'group.splitAmounts',
} as const satisfies Record<SplitMode, MessageKey>;

/**
 * Del vocabulario de la frontera al de la interfaz.
 *
 * Son dos listas cerradas y distintas —`exact_amounts` allí, `amounts` aquí— y
 * se traducen en un solo sitio. Un método que esta versión no conozca no se
 * nombra: antes que enseñar `equal_v2` como si fuera un reparto conocido, no se
 * dice nada de él.
 */
function modeOf(method: string | null): SplitMode | null {
  if (method === 'exact_amounts') return 'amounts';
  return SPLIT_MODES.find((mode) => mode === method) ?? null;
}

export function GroupMovementRow({
  operation,
  categories,
  participants,
  currency,
  declaredCurrency,
  conversion,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  deleting,
}: GroupMovementRowProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const category = operation.categoryId === null ? undefined : categories.get(operation.categoryId);
  const categoryLabel = categoryName(category, t);
  const iconKey = categoryIcon(category);

  /*
   * El par `{ ios, android }` completo, nunca un nombre suelto: una cadena a
   * secas es un SF Symbol y fuera de iOS no resuelve (F06/ADR-009).
   */
  const symbol =
    iconKey === null ? { ios: 'arrow.up.right', android: 'north_east' } : categorySymbol(iconKey);

  /* Colorear exige NOMBRE resuelto, no que exista la fila: el color de una
   * categoría que no sabemos leer saldría de un identificador. */
  const tint =
    category !== undefined && categoryLabel !== null ? categoryColour(category.id) : null;

  const total = money(BigInt(operation.totalMinor), declaredCurrency ?? currency);
  const share =
    operation.yourShareMinor === null ? null : money(BigInt(operation.yourShareMinor), currency);

  /*
   * ═══════════ EL TOTAL CONVERTIDO, Y EL TIPO QUE LO EXPLICA ═══════════
   *
   * **Sólo con conversión congelada y con la moneda declarada resuelta.** Sin
   * una de las dos no se pinta ninguna sección de cambio: media explicación
   * —un importe convertido sin decir desde qué, o un tipo sin sus monedas— es
   * peor que ninguna.
   *
   * La cifra es la que el servidor asentó, con su único redondeo, y el tipo es
   * el que quedó congelado. Aquí no se multiplica nada.
   */
  const converted =
    conversion === undefined || declaredCurrency === undefined || declaredCurrency === null
      ? null
      : money(BigInt(conversion.converted_amount), currency);
  const rate =
    conversion === undefined
      ? null
      : format.rate(conversion.rate_coefficient, conversion.rate_scale);

  /*
   * ═══════════ EL IMPORTE ANTERIOR, Y CUÁNDO SE ENSEÑA ═══════════
   *
   * **Sólo si CAMBIÓ.** Que exista otra versión no significa que el importe se
   * moviera: corregir la categoría, el concepto o el reparto deja versión nueva
   * con el mismo total, y tachar una cifra idéntica a la de arriba no informa
   * de nada. Es el mismo criterio que la fila de Inicio.
   *
   * **Y es la INMEDIATAMENTE anterior**, no la primera: con varias ediciones
   * seguidas lo que interesa es qué cambió en el último cambio.
   *
   * Los dos importes salen de versiones reales —`original_amount` contra
   * `original_amount`— leídas del servidor, así que se ven igual tras recargar
   * y desde otra cuenta autorizada. Ninguno se reconstruye desde un saldo.
   */
  const previous =
    operation.previousMinor === null || operation.previousMinor === operation.totalMinor
      ? null
      : money(BigInt(operation.previousMinor), currency);

  /* Editado es la EXISTENCIA de otra versión, que no es lo mismo. */
  const edited = operation.versionNo > 1;

  /*
   * QUIÉN PAGÓ, por su nombre en el grupo. Si el participante no está en la
   * lista —todavía cargando, o una identidad que esta pantalla no tiene— se dice
   * que no se sabe en vez de dejar la línea a medias o poner un identificador.
   */
  const payerName =
    operation.payerParticipantId === null
      ? null
      : (participants.get(operation.payerParticipantId) ?? null);

  const subtitle = `${
    payerName === null ? t('group.paidByUnknown') : t('group.paidBy', { name: payerName })
  } · ${format.date(operation.effectiveDate, 'short')}`;

  const mode = modeOf(operation.splitMethod);

  return (
    /*
     * DESLIZAR DESCUBRE LA PAPELERA, como en Movimientos recientes de Inicio:
     * la misma pieza, la misma dirección y el mismo control rojo. Deslizar no
     * elimina: pulsar la papelera abre la misma confirmación que la de la fila
     * desplegada, y lo que se ejecuta es la anulación autoritativa (F06/ADR-006)
     * con sus barreras del servidor —deuda ya saldada, retirados (F09/ADR-003)—,
     * que responden igual vengan de donde vengan. Siempre activa: qué gasto de
     * grupo puede anularse lo decide la frontera, no la lista.
     */
    <SwipeToDelete label={t('action.delete')} enabled busy={deleting === true} onDelete={onDelete}>
      <View style={[styles.row, { borderBottomColor: theme.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded, disabled: deleting === true }}
          accessibilityLabel={`${operation.concept}. ${subtitle}. ${format.money(total)}`}
          accessibilityHint={t(expanded ? 'home.movementCollapse' : 'home.movementExpand')}
          // La vía accesible del gesto, como en Inicio: la misma puerta.
          accessibilityActions={[{ name: 'delete', label: t('group.deleteExpense') }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'delete' && deleting !== true) onDelete();
          }}
          onPress={onToggle}
          style={styles.head}>
          <View style={[styles.badge, { backgroundColor: tint ?? theme.surfaceRaised }]}>
            {/* Sobre el círculo teñido va el fondo del tema: los contrastes de la
             * paleta están medidos contra él, y el blanco no llega al mínimo. */}
            <Icon
              name={symbol as never}
              size={16}
              colour={tint === null ? theme.textSecondary : theme.surface}
            />
          </View>

          <View style={styles.copy}>
            <ThemedText variant="bodyStrong" numberOfLines={1}>
              {operation.concept}
            </ThemedText>
            <ThemedText variant="caption" themeColor="textTertiary" numberOfLines={1}>
              {subtitle}
            </ThemedText>
          </View>

          <View style={styles.amounts}>
            {/*
             * ═══════ LA CIFRA VIGENTE VA SOLA EN SU LÍNEA ═══════
             *
             * «Editado» iba a su izquierda, en la misma fila, y eso tenía dos
             * costes: la cifra principal dejaba de estar donde se la busca —el
             * borde derecho— en cuanto la palabra le robaba sitio, y en una
             * tarjeta estrecha las dos competían por el ancho hasta empujar el
             * importe. La cifra es lo que cuenta y ocupa su línea entera.
             */}
            <ThemedText variant="amountRow" numberOfLines={1}>
              {format.money(total)}
            </ThemedText>

            {/*
             * EL CONVERTIDO, secundario y en la moneda del grupo: es el total
             * que de verdad se repartió. «≈» porque es la magnitud en otra
             * moneda, no porque sea aproximado — la cifra es exacta.
             *
             * El mismo formato que la fila de Inicio, con la misma clave: no
             * hay dos maneras de escribir esto.
             */}
            {converted === null ? null : (
              <ThemedText variant="caption" themeColor="textTertiary" numberOfLines={1}>
                {t('home.convertedAmount', { amount: format.money(converted) })}
              </ThemedText>
            )}

            {/*
             * ═══════ LA LÍNEA DE ABAJO: lo anterior tachado y «Editado» ═══════
             *
             * Van juntos porque cuentan lo mismo —que esto cambió— desde dos
             * ángulos: cuánto valía antes, y que hubo una edición. Con cambio de
             * importe salen los dos; con una edición que no tocó el importe
             * —categoría, concepto, reparto— sale sólo la palabra, porque tachar
             * una cifra idéntica a la de arriba no informa de nada. El criterio
             * de `previous` no se ha tocado: sigue siendo «sólo si cambió» y «la
             * inmediatamente anterior».
             *
             * «Editado» sigue siendo TEXTO, no un color ni un punto: es el
             * refuerzo no cromático de `design-direction.md` §8 y lo único que un
             * lector de pantalla puede anunciar.
             *
             * La fila se alinea a la derecha y cada texto va a una línea: si no
             * cabe, se recorta él, no desplaza la cifra de arriba.
             */}
            {edited || previous !== null ? (
              <View style={styles.historyLine}>
                {previous === null ? null : (
                  <ThemedText
                    variant="caption"
                    themeColor="textDisabled"
                    numberOfLines={1}
                    /* Un tachado no se anuncia: la etiqueta lo dice con palabras. */
                    accessibilityLabel={t('group.previousAmount', {
                      amount: format.money(previous),
                    })}
                    style={[styles.struck, styles.shrinkable]}>
                    {format.money(previous)}
                  </ThemedText>
                )}
                {edited ? (
                  <ThemedText
                    variant="caption"
                    themeColor="textTertiary"
                    numberOfLines={1}
                    style={styles.shrinkable}>
                    {t('group.edited')}
                  </ThemedText>
                ) : null}
              </View>
            ) : null}
          </View>
        </Pressable>

        {expanded ? (
          <View style={styles.detail}>
            {/*
             * EL MÉTODO DECLARADO, no una lectura de las cuotas. «Igualmente» y
             * «Por partes» pueden resolver a los mismos importes, así que
             * deducirlo del resultado diría lo que no es.
             */}
            {mode === null ? null : (
              <Detail label={t('group.splitLabel')} value={t(METHOD_KEY[mode])} />
            )}

            <Detail
              label={t('group.yourPart')}
              value={share === null ? t('group.notInSplit') : format.money(share)}
            />

            {/*
             * ═══ EL CAMBIO, CON SU FUENTE, Y SÓLO SI LO HUBO ═══
             *
             * Las mismas tres etiquetas que el detalle de un movimiento
             * personal, porque es el mismo hecho contado igual. **No se vuelve
             * a resolver nada para leer**: el tipo es el congelado y la fuente,
             * la que lo publicó.
             */}
            {converted === null ||
            declaredCurrency === null ||
            declaredCurrency === undefined ? null : (
              <>
                <Detail
                  label={t('home.detailConverted', { code: currency.code })}
                  value={format.money(converted)}
                />
                {rate === null ? null : (
                  <Detail
                    label={t('home.detailRate')}
                    value={t('home.rateValue', {
                      from: declaredCurrency.code,
                      rate,
                      to: currency.code,
                    })}
                  />
                )}
                {conversion === undefined ? null : (
                  <Detail
                    label={t('home.detailRateSource')}
                    value={t(
                      conversion.source_id === 'ecb'
                        ? 'home.rateSourceEcb'
                        : 'home.rateSourceOther',
                      { date: format.date(conversion.origin_reference_date, 'long') },
                    )}
                  />
                )}
              </>
            )}

            <View style={styles.actions}>
              {/*
               * Las dos acciones viven en el detalle desplegado, igual que en
               * Inicio, con sus mismos iconos y tamaños. Y **no cierran la fila**:
               * cada una es su propio `Pressable`, y el de la cabecera no las
               * envuelve — pulsarlas no llega a él.
               *
               * El lápiz NO va en rojo: sólo la acción destructiva lo lleva.
               */}
              <IconButton
                name={Symbols.edit}
                label={t('group.editExpense')}
                onPress={onEdit}
                disabled={deleting === true}
              />
              <IconButton
                name={Symbols.delete}
                label={t('group.deleteExpense')}
                onPress={onDelete}
                disabled={deleting === true}
              />
            </View>
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
  /** `minWidth: 0` para que un concepto largo se recorte en vez de empujar. */
  copy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xxs,
  },
  amounts: {
    alignItems: 'flex-end',
    gap: Spacing.xxs,
  },
  /**
   * La línea de historia: importe anterior y «Editado», a la derecha y en fila.
   * `flexShrink` en los textos y no aquí: lo que se recorta es el texto.
   */
  historyLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.xs,
    maxWidth: '100%',
  },
  /** Lo que cede cuando no cabe es este texto, nunca la cifra de arriba. */
  shrinkable: {
    flexShrink: 1,
  },
  struck: {
    textDecorationLine: 'line-through',
  },
  /** Sangrado bajo el círculo, como el detalle de Inicio. */
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
