import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { type CurrencyDefinition, money } from '@/domain';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { ActionButton, GlassSurface, Icon, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import type { GroupBalanceRow } from './group-service';
import type { ParticipantPresence } from './participant-presence';
import { type ReopenedPair, type SuggestedPayment, suggestionOf } from './suggested-payments';

/**
 * «PAGOS SUGERIDOS», bajo la lista de Saldos.
 *
 * Un oblongo amarillo que despliega, debajo, la propuesta: quién paga, a
 * quién y cuánto, con nombres y cifras reales. Lo que se ve sale de los MISMOS
 * saldos que la lista de arriba (`api.group_balance`, el conjunto entero, sin
 * paginar y sin filtros), calculado en cada render. Cuando los saldos cambian
 * —un gasto, una corrección, una anulación, un pago— la lista se relee y la
 * propuesta se rehace con ella; no hay nada guardado que pueda quedarse viejo.
 *
 * **Las mías, y «Todos» (F09/ADR-007 §1).** Por omisión se listan las propuestas
 * en las que quien mira paga o cobra, sin rótulo; un botón pequeño «Todos»
 * despliega debajo las de los demás —las propias se quedan, sin duplicarse—
 * y el mismo botón las vuelve a plegar (`accessibilityState.expanded`). Ver
 * las ajenas no da permiso para registrarlas: «Saldado» sigue sólo sobre las
 * mías, compacto, y registra ESE pago como hecho fuera de la app. **Aquí no
 * se escribe nada**: la fila avisa a quien compone la pantalla con la
 * propuesta y los saldos tal como se enseñaron, y el servidor decide bajo el
 * cerrojo (`SETTLEMENT_STALE` si ya no son ésos).
 *
 * **Los pares reabiertos con quien salió** llegan del servidor
 * (`reopened`) y entran en la propuesta como pagos fijos: sólo la parte
 * activa los ve como suyos y puede pulsar «Saldado» (F09/ADR-007 C6, excepción 2).
 *
 * Abierto o cerrado, y si están desplegadas las de los demás, es lo único que
 * esta pieza recuerda, y sólo mientras la pantalla vive.
 */
export function SuggestedPaymentsCard({
  balances,
  presenceOf,
  currency,
  reopened = [],
  onSettle,
  canSettle,
  settling = false,
}: {
  readonly balances: readonly GroupBalanceRow[];
  readonly presenceOf: (participantId: string) => ParticipantPresence | null;
  readonly currency: CurrencyDefinition;
  /** Los pares reabiertos publicados por el servidor para este grupo. */
  readonly reopened?: readonly ReopenedPair[];
  /**
   * «Saldado» sobre una propuesta MÍA: registrar ese pago. Sin esto —sin
   * identidad propia en el grupo, o sin sesión— no hay botón.
   */
  readonly onSettle?: (payment: SuggestedPayment) => void;
  /**
   * Si una propuesta MÍA se puede registrar: las dos partes con cuenta
   * (F09/ADR-007 C7: sin Personal no hay pago con caja; quien no tiene cuenta se
   * resuelve retirándolo). Sin esto, toda propuesta mía lleva «Saldado».
   */
  readonly canSettle?: (payment: SuggestedPayment) => boolean;
  /** Mientras un pago se está registrando: ningún otro «Saldado» responde. */
  readonly settling?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  /* Si las propuestas de los demás están desplegadas bajo las mías. */
  const [others, setOthers] = useState(false);
  /* Mi identidad contextual en este grupo, por la lectura real (`is_self`). */
  const me = balances.find((one) => one.isSelf)?.participantId ?? null;

  /*
   * Se calcula SÓLO con la tarjeta abierta y una vez por lectura de saldos:
   * el exacto cuesta unos milisegundos en el límite (medido en node; en el
   * iPhone, con Hermes, más — validación pendiente), y no hay por qué pagarlo
   * en cada render de la pantalla con la tarjeta cerrada. `useMemo` es una
   * derivación de `balances`, no un dato guardado: cambia la lectura, cambia
   * la propuesta; no hay nada que pueda quedarse viejo.
   */
  const suggestion = useMemo(
    () => (open ? suggestionOf(balances, presenceOf, reopened) : null),
    [open, balances, presenceOf, reopened],
  );
  const names = new Map(balances.map((one) => [one.participantId, one.displayName]));
  const nameOf = (id: string) => names.get(id) ?? t('group.suggestSomeone');
  const isMine = (payment: SuggestedPayment) =>
    me !== null && (payment.from === me || payment.to === me);

  return (
    <View style={styles.block}>
      <ActionButton
        label={t('group.suggestTitle')}
        hint={t(open ? 'group.suggestHide' : 'group.suggestShow')}
        tone="brand"
        onPress={() => {
          setOpen((value) => !value);
        }}
      />

      {suggestion !== null ? (
        <GlassSurface level="regular" depth="flat" radius={Radius.lg} style={styles.card}>
          {suggestion.kind === 'ready' ? (
            <>
              {/*
               * Sólo se promete el mínimo cuando el cálculo exacto lo garantiza
               * (hasta 14 personas con saldo); el voraz dice «propuesta», sin
               * prometer una reducción que no ha comparado.
               */}
              <ThemedText variant="caption" themeColor="textSecondary">
                {t(suggestion.exact ? 'group.suggestExact' : 'group.suggestGreedy')}
              </ThemedText>
              <View style={styles.rows}>
                {/*
                 * Primero las mías (sin rótulo); las de los demás sólo al
                 * desplegar «Todos», detrás y sin repetir las mías. Sin
                 * identidad propia en el grupo, todas son «de los demás».
                 */}
                {[
                  ...suggestion.payments.filter(isMine),
                  ...(others || me === null
                    ? suggestion.payments.filter((one) => !isMine(one))
                    : []),
                ].map((payment) => (
                  <PaymentRow
                    key={`${payment.from}>${payment.to}`}
                    payment={payment}
                    from={nameOf(payment.from)}
                    to={nameOf(payment.to)}
                    currency={currency}
                    onSettle={
                      onSettle !== undefined &&
                      isMine(payment) &&
                      (canSettle === undefined || canSettle(payment)) &&
                      !settling
                        ? () => {
                            onSettle(payment);
                          }
                        : undefined
                    }
                  />
                ))}
                {/*
                 * Sin propuesta que me nombre no hay nada que pagar: con neto
                 * cero se sale (F09/ADR-007 C8), aunque queden pares por persona;
                 * la salida los reasigna sin dinero.
                 */}
                {me !== null && !suggestion.payments.some(isMine) ? (
                  <ThemedText variant="body" themeColor="textSecondary">
                    {t('group.suggestNoneMine')}
                  </ThemedText>
                ) : null}
              </View>
              {me !== null && suggestion.payments.some((one) => !isMine(one)) ? (
                <View style={styles.others}>
                  <ActionButton
                    label={t(others ? 'group.suggestOthersHide' : 'group.suggestAll')}
                    hint={t(others ? 'group.suggestOthersHideHint' : 'group.suggestOthersHint')}
                    expanded={others}
                    size="compact"
                    onPress={() => {
                      setOthers((value) => !value);
                    }}
                  />
                </View>
              ) : null}
            </>
          ) : suggestion.kind === 'settled' ? (
            <ThemedText variant="body" themeColor="textSecondary">
              {t('group.allSettled')}
            </ThemedText>
          ) : suggestion.kind === 'inactive' ? (
            /*
             * Quien salió con saldo pendiente (estado anterior a F09/ADR-007, que
             * hoy no se puede producir: no se sale con pares) no se propone ni
             * se excluye en silencio. Se nombra.
             */
            <ThemedText variant="body" themeColor="textSecondary">
              {t('group.suggestInactive', {
                names: suggestion.participantIds.map(nameOf).join(', '),
              })}
            </ThemedText>
          ) : (
            <ThemedText variant="body" themeColor="textSecondary">
              {t('group.suggestUnavailable')}
            </ThemedText>
          )}
        </GlassSurface>
      ) : null}
    </View>
  );
}

/**
 * Una fila: `quien paga → quien cobra  [Saldado]  importe`. Los nombres ceden
 * y se recortan; el importe nunca: va aparte, sin encoger, alineado a la
 * derecha. «Saldado» —el mismo oblongo compacto que usaba la fila de Saldos—
 * va inmediatamente a la izquierda de la cifra, sólo en las propuestas mías.
 */
function PaymentRow({
  payment,
  from,
  to,
  currency,
  onSettle,
}: {
  readonly payment: SuggestedPayment;
  readonly from: string;
  readonly to: string;
  readonly currency: CurrencyDefinition;
  readonly onSettle?: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();
  const amount = format.money(money(payment.minor, currency));

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={t('group.suggestPayment', { from, to, amount })}>
      <View style={styles.names}>
        <ThemedText variant="body" numberOfLines={1} style={styles.name}>
          {from}
        </ThemedText>
        <Icon name={Symbols.arrowRight} size={14} colour={theme.textSecondary} />
        <ThemedText variant="body" numberOfLines={1} style={styles.name}>
          {to}
        </ThemedText>
      </View>
      {onSettle === undefined ? null : (
        <ActionButton
          label={t('group.settleAction')}
          hint={t('group.suggestSettleHint', { from, to, amount })}
          onPress={onSettle}
          tone="brand"
          size="compact"
        />
      )}
      <ThemedText variant="bodyStrong" numberOfLines={1} style={styles.amount}>
        {amount}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Spacing.sm,
    paddingTop: Spacing.md,
  },
  card: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  rows: {
    gap: Spacing.xs,
  },
  /** El botón «Todos», pequeño y a la izquierda, bajo las propuestas propias. */
  others: {
    flexDirection: 'row',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 32,
  },
  /**
   * Los nombres, con la flecha en medio. `flex: 1` y `minWidth: 0` para que
   * un nombre largo se recorte aquí y nunca empuje al importe.
   */
  names: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  name: {
    flexShrink: 1,
    minWidth: 0,
  },
  amount: {
    flexShrink: 0,
    textAlign: 'right',
  },
});
