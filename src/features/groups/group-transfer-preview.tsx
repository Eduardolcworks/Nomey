import { StyleSheet, View } from 'react-native';

import { type CurrencyDefinition, moneyFromMinorString } from '@/domain';
import { useFormat } from '@/lib/format';
import { type MessageKey, useTranslation } from '@/lib/i18n';
import { ThemedText } from '@/ui/components';
import { Spacing } from '@/ui/theme';

import { absoluteMinor, exceedsDebt, netAfterTransfer, standingOf } from './group-transfer';

/**
 * QUÉ LE VA A HACER ESTE IMPORTE A LA RELACIÓN, antes de pulsar nada.
 *
 * **Es la razón de ser de esta pantalla.** Una transferencia de grupo aplica
 * el importe COMPLETO al neto del par —`D_after = D − N`, F12/ADR-003 §9—, sin
 * tope y cruzando cero si toca. Eso significa que mandar 30 sobre una deuda de
 * 20 no «salda y sobra 10»: **invierte la deuda**, y ahora te deben 10. Sin
 * verlo antes, es exactamente el tipo de resultado que se descubre después.
 *
 * Dos frases, siempre las dos: cómo está ahora y cómo quedará. Y una
 * advertencia sólo cuando el importe supera lo que se debía, porque ése es el
 * único caso en que el resultado puede sorprender a alguien que creía estar
 * pagando.
 *
 * **El cálculo es local; el punto de partida, no.** El neto viene del
 * servidor —`sec.net_debt`, la única definición que existe— y la resta se hace
 * aquí sólo para que la cifra acompañe al teclado. Quien decide sigue siendo
 * el servidor, y nada de esto se persiste.
 */
export type GroupTransferPreviewProps = {
  /**
   * El neto del par en la dirección QUIEN ENVÍA → QUIEN RECIBE, con signo, en
   * unidades menores. Positivo: quien envía debe.
   */
  readonly netMinor: string;
  /** El importe tecleado, en unidades menores. Vacío o cero: sólo se dice cómo está ahora. */
  readonly amountMinor: string;
  readonly currency: CurrencyDefinition;
  /** El nombre visible del participante que recibe. Del grupo, nunca de la cuenta. */
  readonly receiverName: string;
};

const NOW: Readonly<Record<'owing' | 'owed' | 'settled', MessageKey>> = {
  owing: 'group.transferNowYouOwe',
  owed: 'group.transferNowTheyOwe',
  settled: 'group.transferNowSettled',
};

const AFTER: Readonly<Record<'owing' | 'owed' | 'settled', MessageKey>> = {
  owing: 'group.transferAfterYouOwe',
  owed: 'group.transferAfterTheyOwe',
  settled: 'group.transferAfterSettled',
};

export function GroupTransferPreview({
  netMinor,
  amountMinor,
  currency,
  receiverName,
}: GroupTransferPreviewProps) {
  const { t } = useTranslation();
  const format = useFormat();

  const money = (minor: string) => format.money(moneyFromMinorString(minor, currency));

  const now = standingOf(netMinor);
  const hasAmount = amountMinor !== '' && BigInt(amountMinor) > 0n;
  const after = hasAmount ? netAfterTransfer(netMinor, amountMinor) : null;
  const warns = hasAmount && exceedsDebt(netMinor, amountMinor);

  return (
    <View style={styles.block}>
      <ThemedText variant="bodySmall" themeColor="textSecondary">
        {t(NOW[now], { name: receiverName, amount: money(absoluteMinor(netMinor)) })}
      </ThemedText>

      {after === null ? null : (
        <ThemedText variant="bodyStrong">
          {t(AFTER[standingOf(after)], {
            name: receiverName,
            amount: money(absoluteMinor(after)),
          })}
        </ThemedText>
      )}

      {/*
       * NO IMPIDE NADA. Superar la deuda es una decisión legítima que el
       * servidor acepta y que las dos partes confirman; lo único que hace
       * falta es que quien la toma sepa que la está tomando.
       */}
      {warns ? (
        <ThemedText variant="bodySmall" themeColor="negative" accessibilityLiveRegion="polite">
          {t('group.transferExceeds')}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { alignSelf: 'stretch', gap: Spacing.xxs },
});
