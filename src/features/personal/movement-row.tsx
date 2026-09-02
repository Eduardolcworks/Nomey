import { Pressable, StyleSheet, View } from 'react-native';

import { currencyDefinition, money } from '@/domain';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { Icon, IconButton, SwipeToDelete, ThemedText } from '@/ui/components';
import { categoryColour, categorySymbol, Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import { type CategoryRow, categoryIcon, categoryName } from './category';
import {
  adjustmentForm,
  adjustmentPreviousBalance,
  amountTone,
  canAnnul,
  canEdit,
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
  readonly categories: ReadonlyMap<string, CategoryRow>;
  readonly currencyCode: string;
  readonly currencyScale: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /**
   * Pide editar. **Ausente mientras no hay editor**, que es el estado de ahora.
   *
   * La ventana de corrección se retiró para rehacerla, así que el lápiz se
   * queda a la vista —es donde va a estar— pero APAGADO: sin manejador no se
   * pulsa, y `accessibilityState` lo anuncia como lo que es. Un control visible
   * que no responde al tocarlo miente; uno apagado, no.
   *
   * Volver a conectarlo es pasar esta prop.
   */
  readonly onEdit?: () => void;
  /**
   * Pide eliminar. **Quien lo recibe confirma y anula**; esta fila no escribe.
   *
   * Se ofrece por deslizamiento y por acción accesible, y las dos llaman aquí:
   * una sola puerta, para que las dos vías no puedan divergir.
   */
  readonly onDelete: () => void;
  /**
   * Mientras esta fila se está anulando.
   *
   * Bloquea su acción destructiva y **nada más**: el resto de Inicio sigue
   * disponible. Eliminar un movimiento no es motivo para tapar la pantalla.
   */
  readonly deleting?: boolean;
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
  categories,
  currencyCode,
  currencyScale,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  deleting,
}: MovementRowProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const kind = movementKind(operation.operation_class);
  /*
   * Eliminar se ofrece por CLASE, nunca por signo ni por color: un ajuste
   * negativo se parece a un gasto en las dos cosas. Lo decide `canAnnul`
   * sobre `operation_class`, que llega en la superficie de lectura.
   */
  const deletable = canAnnul(operation);
  /*
   * Editar sigue la misma regla que eliminar: por CLASE, nunca por el signo.
   * Son dos capacidades distintas y se preguntan por separado, aunque hoy
   * respondan lo mismo para las mismas dos clases.
   */
  const editable = canEdit(operation);
  const definition = currencyDefinition({
    id: 'personal-base',
    code: currencyCode,
    scale: currencyScale,
  });

  const amount = money(toMinor(operation.balance_amount), definition);
  const form = adjustmentForm(operation);
  /*
   * **El saldo que había antes de ESTE ajuste.** Sale de la propia operación
   * —el objetivo declarado menos el efecto que el servidor asentó— así que
   * corresponde a su instante y no al de ahora, y no cuesta ninguna consulta.
   */
  const previousBalance = adjustmentPreviousBalance(operation);
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

  /*
   * El icono. Un ingreso NO tiene categoria, asi que no hay icono de categoria
   * que resolver: lleva el direccional de su clase.
   */
  const iconKey = categoryIcon(category);
  /*
   * **Los tres van como pareja `{ ios, android }`, no como cadena suelta.** Un
   * nombre a secas es un SF Symbol: fuera de iOS no resuelve y la fila cae en
   * el recuadro genérico. Es exactamente el defecto que ADR-027 corrigió en las
   * categorías, y estas tres se habían quedado fuera.
   *
   * El ajuste lleva deslizadores —regular una magnitud— y no una flecha: no es
   * una entrada ni una salida de dinero, es fijar cuánto hay.
   */
  const symbol =
    kind === 'adjustment'
      ? { ios: 'slider.horizontal.3', android: 'tune' }
      : kind === 'income'
        ? { ios: 'arrow.down.left', android: 'south_west' }
        : iconKey === null
          ? { ios: 'arrow.up.right', android: 'north_east' }
          : categorySymbol(iconKey);

  /*
   * **Un ingreso no lleva segunda linea, y no deja hueco.** No tiene categoria
   * -no es un hecho de su clase-, asi que decir «Sin categoria conocida» seria
   * mentira, y «Ingreso» seria repetir lo que el signo y el color ya dicen.
   * Su concepto es todo lo que hay que leer.
   */
  const categoryLabel = categoryName(category, t);

  const subtitle =
    kind === 'income' || kind === 'adjustment'
      ? null
      : (categoryLabel ?? t('home.categoryUnknown'));

  /*
   * EL COLOR DE LA CATEGORÍA, y sólo cuando hay categoría que colorear.
   *
   * **El mismo `categoryColour` que pinta el donut y su leyenda**, no una copia:
   * es lo que hace que un sector y su fila sean del mismo color sin que nadie
   * los sincronice. Las oficiales traen su color cerrado y las personalizadas el
   * determinista que ya devuelve.
   *
   * **Se exige el NOMBRE resuelto, no que exista la fila.** Una categoría cuya
   * clave esta versión no conoce se nombra «desconocida»; darle color sería
   * derivarlo de un identificador que no sabemos leer. Y una retirada del
   * catálogo activo sí se colorea, porque su histórico sigue resolviendo
   * nombre e icono — que es justo lo que ADR-021 protege.
   *
   * **El color no identifica solo.** El icono y el nombre siguen ahí; esto
   * añade una tercera señal, no sustituye a las otras dos.
   *
   * ================== POR QUÉ YA NO SE PIDE CON UNA PROP ======================
   *
   * Esto vivía tras `tintByCategory`, con el argumento de que el color
   * pertenecía a la lista —donde acompaña al donut— y no a la fila. La segunda
   * superficie que montó esta misma fila, las tarjetas de Ingresos y Gastos
   * desplegadas, **no la pidió**, y sus categorías salieron grises: el mismo
   * gasto se veía de dos colores según desde dónde se mirase.
   *
   * El argumento era, además, del revés. El color de una categoría es identidad
   * de LA CATEGORÍA, no lectura de una lista concreta, así que viaja con la fila
   * igual que el icono y el nombre — que nunca estuvieron tras una prop. Dejarlo
   * opcional hacía representable justamente el defecto que apareció.
   */
  const tint =
    kind === 'expense' && category !== undefined && categoryLabel !== null
      ? categoryColour(category.id)
      : null;

  const previousShown =
    previous === undefined || kind === null
      ? null
      : money(displayMinor(kind, previous.original_amount), definition);

  return (
    <SwipeToDelete
      label={t('action.delete')}
      enabled={deletable}
      busy={deleting === true}
      onDelete={onDelete}>
      <View style={[styles.row, { borderBottomColor: theme.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded, disabled: deleting === true }}
          accessibilityLabel={`${title}. ${format.money(amount, { sign: 'always' })}`}
          accessibilityHint={t(expanded ? 'home.movementCollapse' : 'home.movementExpand')}
          /*
           * **LA VÍA ACCESIBLE, y no es un extra.** Un deslizamiento no existe
           * para un lector de pantalla: sin esto, eliminar sería imposible con
           * VoiceOver o TalkBack. La acción aparece en el rotor y llama a la
           * MISMA puerta que el gesto, así que las dos no pueden divergir.
           *
           * Sólo cuando la fila es eliminable: anunciar una acción que no va a
           * ninguna parte es peor que no anunciarla.
           */
          accessibilityActions={
            deletable ? [{ name: 'delete', label: t('home.deleteMovement') }] : undefined
          }
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'delete' && deleting !== true) onDelete();
          }}
          onPress={onToggle}
          style={styles.head}>
          <View style={[styles.badge, { backgroundColor: tint ?? theme.surfaceRaised }]}>
            {/*
             * **El icono va en el fondo del tema, no en blanco.** Los contrastes
             * de la paleta están medidos contra `surface` (#0C0C0C) y su mínimo
             * es 4.11:1; el blanco no llega a eso sobre los diez colores. Sobre
             * el círculo neutro sigue el tono secundario de siempre.
             */}
            <Icon
              name={symbol as never}
              size={16}
              colour={tint === null ? theme.textSecondary : theme.surface}
            />
          </View>

          <View style={styles.copy}>
            <ThemedText variant="bodyStrong" numberOfLines={1}>
              {title}
            </ThemedText>
            {subtitle === null ? null : (
              <ThemedText variant="caption" themeColor="textTertiary" numberOfLines={1}>
                {subtitle}
              </ThemedText>
            )}

            {/*
             * **EL SALDO ANTERIOR, bajo el objetivo y tachado.**
             *
             * Sustituye a la etiqueta «Ajuste de saldo», que repetía lo que el
             * título ya decía. Esto añade el dato que faltaba para entender la
             * fila de un vistazo: de cuánto se venía.
             *
             * Tachado, en el registro pequeño y en el tono más apagado — el
             * mismo tratamiento que el importe anterior de un movimiento
             * corregido, y por la misma razón: es contexto, no la cifra que
             * cuenta. **Nunca en rojo**: no es un error ni una pérdida, es el
             * punto de partida.
             *
             * Y con etiqueta accesible propia, porque un tachado no se anuncia.
             */}
            {previousBalance === null ? null : (
              <ThemedText
                variant="caption"
                themeColor="textDisabled"
                numberOfLines={1}
                accessibilityLabel={t('home.previousBalance', {
                  amount: format.money(money(previousBalance, definition)),
                })}
                style={styles.struck}>
                {format.money(money(previousBalance, definition))}
              </ThemedText>
            )}
          </View>

          <View style={styles.amounts}>
            <View style={styles.currentLine}>
              <ThemedText variant="amountRow" themeColor={amountTone(operation)} numberOfLines={1}>
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
            {/*
             * **AQUÍ IBA EL SALDO OBSERVADO, y se ha retirado de la interfaz.**
             *
             * Enseñaba «Saldo tras el movimiento» con una nota debajo que decía
             * «Observación del sistema al registrar esta versión» — una frase
             * técnica sobre versiones, que es vocabulario del modelo y no del
             * dinero de nadie.
             *
             * Y quitar sólo la nota habría sido peor que quitar las dos cosas.
             * La observación se toma en el INSTANTE en que se escribe la versión
             * (ADR-023 §5), así que desde que se puede corregir un movimiento
             * desde aquí, corregir hoy uno de hace tres meses observa el saldo DE
             * HOY. La nota era lo único que lo advertía: sin ella, la cifra
             * seguiría ahí, etiquetada como el saldo tras aquel movimiento, y
             * sería una afirmación falsa que no falla.
             *
             * **No se ha borrado nada por debajo.** `core.balance_observation`,
             * `api.observed_balance` y el hook siguen exactamente como estaban:
             * esto es dejar de pintarlo, no dejar de guardarlo.
             */}

            <View style={styles.actions}>
              {/*
               * **Las dos acciones viven en el detalle desplegado, no en la fila
               * cerrada.** La lista se mantiene limpia y hay que abrir la fila a
               * propósito para verlas. Eliminar tiene además el deslizamiento,
               * que es el atajo; editar no lo necesita, porque no es una acción
               * que se repita.
               *
               * El lápiz NO va en rojo: sólo la acción destructiva lo lleva.
               */}
              {editable ? (
                <IconButton
                  name={Symbols.edit}
                  label={t('home.editMovement')}
                  onPress={onEdit ?? (() => undefined)}
                  disabled={onEdit === undefined || deleting === true}
                />
              ) : null}
              {/*
               * La papelera del detalle desplegado ya estaba, y se queda: es la
               * tercera vía y la única visible, pero sólo cuando alguien ha
               * abierto la fila a propósito. La lista cerrada no la enseña.
               */}
              {deletable ? (
                <IconButton
                  name={Symbols.delete}
                  label={t('home.deleteMovement')}
                  onPress={onDelete}
                  disabled={deleting === true}
                />
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    </SwipeToDelete>
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
