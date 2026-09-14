import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { type CurrencyDefinition, money } from '@/domain';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import {
  type AmountEntry,
  amountEntryFromMinor,
  amountFieldSelection,
  amountFieldStep,
  amountValue,
  EMPTY_AMOUNT,
  GlassSurface,
  Icon,
  ThemedText,
} from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import { eligibleOn, type GroupParticipant } from './participant-service';
import {
  isFixedAmount,
  type Quota,
  type SharedExpenseDraft,
  sharesOf,
  type SplitMode,
} from './shared-expense';

/**
 * ENTRE QUIÉNES SE REPARTE, y cuánto le toca a cada uno.
 *
 * Una sola tarjeta con los participantes REALES del grupo —los que publica
 * `api.group_participant`, o los que la creación local declaró si el grupo aún
 * no ha viajado—. No son «los usuarios con cuenta» ni «los miembros
 * autorizados»: un participante puede no haber instalado Nomey nunca, y aun así
 * cenar y deber su parte (F03/ADR-009 §1).
 *
 * Cada fila, en este orden: **tick · nombre · cuota**. La cuota a la derecha
 * porque es la cifra, y las cifras se comparan en columna.
 *
 * ═══════════ TRES FILAS, Y A PARTIR DE AHÍ SE DESPLAZA ═══════════
 *
 * Hasta tres caben enteras y la tarjeta no se desplaza por dentro: un scroll
 * dentro de otro scroll sobre tres filas es un gesto que se roba sin ganar nada.
 * Desde cuatro, la tarjeta se acota a la altura de tres y el resto se alcanza
 * desplazando.
 *
 * **Y esa altura se MIDE, no se escribe.** El tope es tres veces lo que mide la
 * fila MÁS ALTA —cada una se mide con `onLayout`— más los dos huecos que las
 * separan. Una cifra fija en puntos habría enseñado tres filas con la letra
 * del sistema al 100 % y una y media al 200 %, que es justo cuando hace más
 * falta ver de qué va la lista. Hasta que la medida llega no hay tope: se pinta
 * entera un fotograma y se acota en el siguiente.
 */
export function SplitParticipantsCard({
  participants,
  draft,
  quotas,
  currency,
  onToggle,
  onAdjustShares,
  onChangeAmount,
  onEqualize,
}: {
  readonly participants: readonly GroupParticipant[];
  readonly draft: SharedExpenseDraft;
  readonly quotas: readonly Quota[];
  readonly currency: CurrencyDefinition;
  readonly onToggle: (participantId: string) => void;
  /** Una parte más o menos para alguien. El control −/+ no tiene teclado. */
  readonly onAdjustShares: (participantId: string, delta: 1 | -1) => void;
  /** Fija a mano el importe de alguien, tal como se teclea. */
  readonly onChangeAmount: (participantId: string, value: string) => void;
  /** «Repartir igualmente»: libera todas las cuotas fijadas. */
  readonly onEqualize: () => void;
}) {
  const { t } = useTranslation();
  /*
   * LA ALTURA SE MIDE FILA A FILA, y el tope sale de la MÁS ALTA.
   *
   * No todas miden lo mismo: en `Por partes` y en `Cantidad` las filas de quien
   * participa llevan un campo y las de quien no, no. Midiendo sólo la primera
   * —que puede ser la de alguien desmarcado— el tope salía corto y la tarjeta
   * enseñaba dos filas y media. Con el máximo, tres filas caben siempre.
   */
  const [heights, setHeights] = useState<Readonly<Record<string, number>>>({});
  /*
   * EL INDICADOR DE DESPLAZAMIENTO VA A LA IZQUIERDA, junto a los ticks, y no
   * sobre las cuotas: a la derecha se pisaba con las cifras, que es lo que se
   * lee. iOS no tiene un lado para el indicador, pero sí un inset: empujarlo
   * desde la derecha casi todo el ancho lo deja pegado al borde izquierdo. El
   * ancho se mide —cambia con la letra del sistema y el aparato— y hasta que
   * llega, el indicador se queda donde iOS lo pone. Sólo iOS lo respeta; en
   * Android el indicador no se mueve, y no se finge.
   */
  const [listWidth, setListWidth] = useState(0);
  const measure = (id: string, height: number) => {
    /*
     * Aplazado un fotograma, por lo mismo que el ancho de los oblongos: cambiar
     * el estado dentro de `onLayout` vuelve a renderizar durante la medida de
     * Android, y un hijo nativo que se remida dentro de su propia medida tumba
     * la pantalla. Aquí no hay ninguno hoy, pero la ventana entera comparte
     * pasada: el mismo patrón, el mismo riesgo.
     */
    requestAnimationFrame(() => {
      setHeights((previous) =>
        previous[id] === height ? previous : { ...previous, [id]: height },
      );
    });
  };

  const tallest = Math.max(0, ...Object.values(heights));
  const capped = participants.length > 3 && tallest > 0;
  const cap = tallest === 0 ? undefined : tallest * 3 + Spacing.sm * 2;

  const quotaOf = new Map(quotas.map((one) => [one.participantId, one.minor]));

  // Sólo en `Cantidad`, y sólo cuando hay algo fijado que liberar.
  const equalizable =
    draft.mode === 'amounts' && draft.selected.some((id) => isFixedAmount(draft, id));

  return (
    <View style={styles.block}>
      {/*
       * El mismo rol tipográfico con el que la ventana dice de qué ámbito habla
       * —«Personal» en Inicio, el nombre del grupo aquí—, pero alineado a la
       * izquierda: aquello titula la ventana entera y esto encabeza una lista.
       */}
      <ThemedText variant="label" themeColor="textSecondary" style={styles.heading}>
        {t('group.splitAmong')}
      </ThemedText>

      <GlassSurface level="regular" depth="flat" radius={Radius.lg} style={styles.card}>
        <ScrollView
          style={capped ? { maxHeight: cap } : undefined}
          /*
           * Desplazable desde que hay más de tres, sin esperar a la medida: el
           * tope llega un fotograma después, y un gesto que empezara en ese
           * hueco no se perdía por poco. Con tres o menos no hay nada que
           * desplazar y se deja quieta.
           */
          scrollEnabled={participants.length > 3}
          nestedScrollEnabled
          /* Sin rebote cuando no hay nada que desplazar: no es una lista larga. */
          bounces={capped}
          onLayout={(event) => {
            // Aplazado un fotograma, por lo mismo que la medida de las filas.
            const { width } = event.nativeEvent.layout;
            requestAnimationFrame(() => {
              setListWidth((previous) => (previous === width ? previous : width));
            });
          }}
          scrollIndicatorInsets={
            listWidth > INDICATOR_GAP ? { right: listWidth - INDICATOR_GAP } : undefined
          }
          keyboardShouldPersistTaps="handled">
          {/*
           * ═══════ EL GESTO TIENE QUE EMPEZAR DENTRO DE LA LISTA ═══════
           *
           * Medido en el iPhone: la tarjeta se desplazaba si el dedo empezaba
           * sobre un tick —un `Pressable` dentro de la lista— y casi nunca si
           * empezaba sobre el nombre o la cuota. La diferencia es quién toma el
           * responder de React Native al primer toque: sobre el nombre no hay
           * nadie dentro, y lo toma el cuerpo de la ventana, que está FUERA del
           * `ScrollView`; con el responder fuera, el desplazamiento nativo no
           * llega a cancelarlo. Este envoltorio lo toma desde dentro, como hace
           * el tick, y el desplazamiento vuelve a ganar en cualquier punto de la
           * fila. Lo que hay más adentro —ticks, −/+, el campo— sigue ganando
           * la negociación, que va del más profundo hacia arriba.
           *
           * Y conserva el contrato del cuerpo: un toque suelto sobre la tarjeta
           * sigue cerrando el teclado. Un desplazamiento no es un toque suelto,
           * termina cancelado, y no lo cierra.
           */}
          <View
            style={styles.rows}
            onStartShouldSetResponder={() => true}
            onResponderRelease={() => {
              Keyboard.dismiss();
            }}>
            {participants.map((one) => (
              <ParticipantRow
                key={one.participantId}
                participant={one}
                selected={draft.selected.includes(one.participantId)}
                isPayer={one.participantId === draft.payerId}
                inactive={one.presence !== null && !one.presence.isActive}
                eligible={eligibleOn(one, draft.date)}
                mode={draft.mode}
                shares={sharesOf(draft, one.participantId)}
                amount={draft.amounts[one.participantId] ?? ''}
                fixed={isFixedAmount(draft, one.participantId)}
                quota={quotaOf.get(one.participantId) ?? null}
                currency={currency}
                onToggle={onToggle}
                onAdjustShares={onAdjustShares}
                onChangeAmount={onChangeAmount}
                onMeasure={measure}
              />
            ))}
          </View>
        </ScrollView>
      </GlassSurface>

      {/*
       * «REPARTIR IGUALMENTE», discreta y sólo cuando hay algo que liberar: es
       * la única forma de deshacer una cuota fijada a mano. Vaciar un campo no
       * la devuelve a automático, la deja incompleta; esto la suelta y todo el
       * total vuelve a repartirse igual.
       */}
      {equalizable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('group.splitEqualize')}
          accessibilityHint={t('group.splitEqualizeHint')}
          onPress={onEqualize}
          style={({ pressed }) => [styles.equalize, { opacity: pressed ? 0.6 : 1 }]}>
          <ThemedText variant="caption" themeColor="accent">
            {t('group.splitEqualize')}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function ParticipantRow({
  participant,
  selected,
  isPayer,
  inactive,
  eligible,
  mode,
  shares,
  amount,
  fixed,
  quota,
  currency,
  onToggle,
  onAdjustShares,
  onChangeAmount,
  onMeasure,
}: {
  readonly participant: GroupParticipant;
  readonly selected: boolean;
  readonly isPayer: boolean;
  /** Salió del grupo (F09/ADR-003): se dice con TEXTO, no sólo con el tono. */
  readonly inactive: boolean;
  /** Puede figurar en un gasto con la fecha del borrador: `fecha < eligible_until`. */
  readonly eligible: boolean;
  readonly mode: SplitMode;
  /** Las partes declaradas, ya como número: lo que el control −/+ enseña. */
  readonly shares: bigint;
  /** El importe FIJADO a mano, tal como se tecleó; vacío si va en automático. */
  readonly amount: string;
  /** Si el importe está fijado a mano (`Cantidad`). Si no, es automático. */
  readonly fixed: boolean;
  readonly quota: bigint | null;
  readonly currency: CurrencyDefinition;
  readonly onToggle: (participantId: string) => void;
  readonly onAdjustShares: (participantId: string, delta: 1 | -1) => void;
  readonly onChangeAmount: (participantId: string, value: string) => void;
  readonly onMeasure: (participantId: string, height: number) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  /*
   * EL PAGADOR NO SE PUEDE EXCLUIR, y la fila lo DICE.
   *
   * La regla es del modelo —`splitExpense` rechaza un pagador que no figura
   * entre los participantes— y quien paga una cena también cena. Lo que no puede
   * pasar es que el tick simplemente no responda: `accessibilityState.disabled`
   * lo declara y la pista explica por qué, de modo que quien no ve la pantalla
   * recibe el motivo y no un control mudo.
   */
  const label = isPayer
    ? t('group.splitPayerLocked', { name: participant.displayName })
    : t(selected ? 'group.splitExclude' : 'group.splitInclude', {
        name: participant.displayName,
      });

  return (
    <View
      style={styles.row}
      onLayout={(event) => {
        onMeasure(participant.participantId, event.nativeEvent.layout.height);
      }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected, disabled: isPayer || !eligible }}
        accessibilityLabel={label}
        accessibilityHint={
          isPayer ? t('group.splitPayerHint') : !eligible ? t('group.splitInactiveHint') : undefined
        }
        disabled={isPayer || !eligible}
        onPress={() => {
          onToggle(participant.participantId);
        }}
        style={styles.tick}>
        <View
          style={[
            styles.box,
            {
              borderColor: selected ? theme.accent : theme.border,
              backgroundColor: selected ? theme.accent : 'transparent',
            },
          ]}>
          {selected ? <Icon name={Symbols.confirm} size={14} colour={theme.onAccent} /> : null}
        </View>
      </Pressable>

      <View style={styles.name}>
        <ThemedText
          variant="body"
          themeColor={selected ? 'text' : 'textTertiary'}
          numberOfLines={1}>
          {participant.displayName}
        </ThemedText>
        {inactive ? (
          // «Inactivo» es TEXTO, no un color: design-direction.md §8, y es lo
          // que un lector de pantalla puede anunciar.
          <ThemedText variant="caption" themeColor="textDisabled" numberOfLines={1}>
            {t('group.participantInactive')}
          </ThemedText>
        ) : null}
      </View>

      {/*
       * Lo que se DECLARA por participante, cuando el método lo pide. Va antes
       * de la cuota porque es su entrada: primero lo que se escribe, después lo
       * que sale. Quien no participa no declara nada.
       */}
      {selected && mode === 'shares' ? (
        <SharesStepper
          shares={shares}
          name={participant.displayName}
          onAdjust={(delta) => {
            onAdjustShares(participant.participantId, delta);
          }}
        />
      ) : null}

      {selected && mode === 'amounts' ? (
        /*
         * EN `Cantidad` EL OBLONGO ES LA CIFRA DEFINITIVA, y se edita ahí: no
         * hay una segunda cuota a la derecha que la repita.
         */
        <QuotaField
          quota={quota}
          currency={currency}
          onChange={(next) => {
            onChangeAmount(participant.participantId, next);
          }}
          label={t(fixed ? 'group.splitAmountLabel' : 'group.splitAmountAuto', {
            name: participant.displayName,
          })}
          pending={t('home.amountPending')}
        />
      ) : (
        /*
         * LA CUOTA. Pendiente mientras no se pueda calcular —no cero, que es una
         * cuota real y las hay—, y apagada para quien no participa.
         */
        <ThemedText
          variant="bodyStrong"
          themeColor={!selected ? 'textDisabled' : quota === null ? 'textTertiary' : 'text'}
          numberOfLines={1}
          style={styles.quota}>
          {!selected || quota === null
            ? t('home.amountPending')
            : format.money(money(quota, currency))}
        </ThemedText>
      )}
    </View>
  );
}

/**
 * LAS PARTES, CON − Y +, Y SIN TECLADO.
 *
 * `[−] 2x [+]` en el mismo material que el campo de importe. Sólo enteros: no
 * hay nada que teclear, y el mínimo es UNA parte —el − se apaga en 1—; para
 * excluir a alguien está su tick. Cada pulsación recalcula las cuotas por el
 * mismo camino que antes (`computeSplit`).
 *
 * Los dos botones se dibujan compactos —32 × 40— para que la fila quepa con el
 * nombre y la cuota, y `hitSlop` devuelve a cada uno los 44 × 44 que se tocan.
 */
function SharesStepper({
  shares,
  name,
  onAdjust,
}: {
  readonly shares: bigint;
  readonly name: string;
  readonly onAdjust: (delta: 1 | -1) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const count = shares.toString();
  const atMinimum = shares <= 1n;

  return (
    <GlassSurface
      material="control"
      level="regular"
      depth="well"
      rim="soft"
      radius={Radius.full}
      nativeEffect={false}
      style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('group.splitSharesLess', { name })}
        accessibilityState={{ disabled: atMinimum }}
        disabled={atMinimum}
        hitSlop={STEP_HIT_SLOP}
        onPress={() => {
          onAdjust(-1);
        }}
        style={({ pressed }) => [styles.step, { opacity: pressed ? 0.6 : 1 }]}>
        <Icon
          name={Symbols.remove}
          size={16}
          colour={atMinimum ? theme.textDisabled : theme.text}
        />
      </Pressable>
      <ThemedText
        variant="bodyStrong"
        accessibilityLabel={t('group.splitSharesCount', { count, name })}
        style={styles.stepValue}>
        {t('group.splitSharesValue', { count })}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('group.splitSharesMore', { name })}
        hitSlop={STEP_HIT_SLOP}
        onPress={() => {
          onAdjust(1);
        }}
        style={({ pressed }) => [styles.step, { opacity: pressed ? 0.6 : 1 }]}>
        <Icon name={Symbols.add} size={16} colour={theme.text} />
      </Pressable>
    </GlassSurface>
  );
}

/**
 * LA CUOTA DE ALGUIEN EN `Cantidad`, EN SU OBLONGO, y ahí se edita.
 *
 * **Lo que se ve es la cifra definitiva** —fijada a mano o automática, en el
 * mismo color de texto—, formateada como cualquier otra cuota. **Tocarla empieza de cero**:
 * al entrar, la cifra se siembra como precargada y la PRIMERA tecla la
 * sustituye (10,00 → «2» → 2, sin borrar antes), el mismo contrato que el
 * importe total; en cuanto se escribe, queda fijada. Salir sin escribir no
 * fija nada. Lo tecleado pasa por la misma máquina de entrada
 * (`amountFieldStep`): dígitos y un separador, con la escala del grupo.
 *
 * **El campo es un capturador de teclado, no la cifra**, como en
 * `AmountField`: va encima, invisible y sin cursor, y lo que se lee es el
 * texto de debajo. Y tras sustituir la precargada el cursor se coloca al
 * final una vez, imperativamente, por la misma razón medida allí: iOS lo
 * conserva relativo al final anterior y la segunda tecla se insertaba delante.
 *
 * Un campo fijado que se vacía se queda vacío y pendiente («—»): el modelo lo
 * dice, no se convierte en cero ni vuelve solo a automático.
 */
function QuotaField({
  quota,
  currency,
  onChange,
  label,
  pending,
}: {
  readonly quota: bigint | null;
  readonly currency: CurrencyDefinition;
  readonly onChange: (next: string) => void;
  readonly label: string;
  readonly pending: string;
}) {
  const theme = useTheme();
  const format = useFormat();
  const scale = currency.scale;
  // El separador decimal del idioma, resuelto como lo hace la ventana.
  const separator = format
    .number(0, { minimumFractionDigits: scale, maximumFractionDigits: scale })
    .replace(/[0-9]/g, '');

  // Fuera de edición la entrada es la cuota vigente, sembrada: es lo que la
  // primera tecla sustituye. Mientras se edita, manda lo que se va tecleando.
  const seeded: AmountEntry =
    quota === null ? EMPTY_AMOUNT : amountEntryFromMinor(quota.toString(), scale);
  const [editing, setEditing] = useState<AmountEntry | null>(null);
  const entry = editing ?? seeded;

  const input = useRef<TextInput | null>(null);
  const pendingCaret = useRef(false);
  useEffect(() => {
    if (!pendingCaret.current) return;
    pendingCaret.current = false;
    const target = amountFieldSelection({ entry, pinToEnd: true });
    if (target !== undefined) input.current?.setSelection(target.start, target.end);
  });

  const typed = editing !== null && editing.seeded !== true;
  /*
   * EL FOCO SE VE: el oblongo con foco real se hunde como un control
   * presionado —`pressed`, el mismo estado táctil de `GlassPressable`— y
   * vuelve a `well` al perderlo. Es el foco de ESTE campo (`editing`, puesto
   * en `onFocus` y quitado en `onBlur`), no «hay teclado»: al saltar a otra
   * cuota, ésta se levanta y la otra se hunde. Ni borde, ni halo, ni tamaño:
   * sólo el sombreado interior cambia de lado, y nada se mueve.
   */
  const focused = editing !== null;
  const shown = typed
    ? amountValue(editing).replace('.', separator)
    : quota === null
      ? pending
      : format.money(money(quota, currency));

  return (
    <GlassSurface
      material="control"
      level="regular"
      depth={focused ? 'pressed' : 'well'}
      rim="soft"
      radius={Radius.full}
      nativeEffect={false}
      style={styles.declared}>
      <ThemedText
        variant="bodyStrong"
        numberOfLines={1}
        // Siempre en color de texto, fijada o automática: es la cuota. Sólo el
        // «—» de una pendiente va apagado.
        style={[
          styles.declaredFigure,
          { color: quota === null && !typed ? theme.textTertiary : theme.text },
        ]}>
        {shown}
      </ThemedText>
      <TextInput
        ref={input}
        value={amountValue(entry)}
        onFocus={() => {
          setEditing(seeded);
        }}
        onBlur={() => {
          setEditing(null);
        }}
        onChangeText={(next) => {
          const step = amountFieldStep({ entry, pinToEnd: false }, next, scale);
          if (step.pinToEnd) pendingCaret.current = true;
          setEditing(step.entry);
          onChange(amountValue(step.entry));
        }}
        keyboardType="decimal-pad"
        caretHidden
        selectionColor="transparent"
        accessibilityLabel={label}
        style={[StyleSheet.absoluteFill, styles.capture]}
      />
    </GlassSurface>
  );
}

/** Lo que el indicador se separa del borde izquierdo: su propio grosor y un pelo. */
const INDICATOR_GAP = 6;

/** Lo que le falta a un botón de 32 × 40 para tocarse como uno de 44 × 44. */
const STEP_HIT_SLOP = { top: 2, bottom: 2, left: 6, right: 6 };

const styles = StyleSheet.create({
  block: {
    gap: Spacing.sm,
  },
  heading: {
    textAlign: 'left',
  },
  card: {
    padding: Spacing.md,
  },
  rows: {
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  /**
   * El objetivo táctil del tick, no su dibujo.
   *
   * 44 es el mínimo de Apple y el cuadro son 22: compactar el dibujo no puede
   * compactar lo que se toca, así que el área la pone la capa pulsable.
   */
  tick: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: -Spacing.sm,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * El nombre cede el sitio, y es el único que lo cede.
   *
   * `minWidth: 0` no es decorativo: sin él el ancho mínimo de esta columna sería
   * el de su contenido, así que un nombre largo empujaría a la cuota fuera de la
   * tarjeta en vez de recortarse.
   */
  name: {
    flex: 1,
    minWidth: 0,
  },
  /**
   * EL OBLONGO DE LA CUOTA. Con un ancho mínimo para que dos cifras iguales
   * midan igual, y crece con la cifra: es la cuota definitiva, no un campo.
   */
  declared: {
    minWidth: 88,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  declaredFigure: {
    textAlign: 'center',
  },
  /** El capturador: encima de la cifra, sin texto ni cursor visibles. */
  capture: {
    color: 'transparent',
    fontSize: 16,
    padding: 0,
    textAlign: 'center',
  },
  /**
   * El control −/+: el mismo material y alto que el campo de importe, con
   * los dos botones en los extremos y el valor en medio.
   */
  stepper: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
  },
  step: {
    width: 32,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    minWidth: 28,
    textAlign: 'center',
  },
  /** La acción discreta, centrada y con su objetivo táctil aunque sea texto. */
  equalize: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  quota: {
    textAlign: 'right',
  },
});
