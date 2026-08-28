import { StyleSheet, View } from 'react-native';

import { currencyDefinition, money } from '@/domain';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { GlassSurface, IconButton, ThemedText } from '@/ui/components';
import { Spacing } from '@/ui/theme';

import { toMinor } from './statistics';

export type BalanceCardProps = {
  /** Exacto, en unidad mínima. `null` mientras no se pueda afirmar. */
  readonly amount: string | null;
  readonly currencyCode: string;
  readonly currencyScale: number;
  /** Ajustar el saldo. La escritura llega en F6.F. */
  readonly onAdjust: () => void;
};

/**
 * El `Disponible` del Modo Personal.
 *
 * **La cifra viene de `api.personal_balance` y no se calcula aquí.** El
 * servidor la deriva de la proyección canónica; el cliente no descarga
 * movimientos para sumarlos, que es lo que ADR-025 existe para evitar.
 *
 * **`null` no es cero.** Mientras el saldo no se pueda afirmar se pinta un
 * marcador de posición sin cifra, en vez de un `0` que se leería como un dato.
 * La vista devuelve **siempre una fila** —con `0` cuando el ámbito no tiene
 * efectos—, así que la ausencia sólo significa que todavía no ha llegado o que
 * no hay ámbito, y ninguna de las dos cosas es «tienes cero euros».
 *
 * **Sin deudas todavía.** El Modo Personal no tiene dimensión de deuda: ésa es
 * la de Grupos, y llega con F9. No se pinta un `0 €` de deuda que sería una
 * afirmación sobre algo que no existe.
 */
export function BalanceCard({ amount, currencyCode, currencyScale, onAdjust }: BalanceCardProps) {
  const { t } = useTranslation();
  const format = useFormat();

  const definition = currencyDefinition({
    id: 'personal-base',
    code: currencyCode,
    scale: currencyScale,
  });

  return (
    <GlassSurface level="regular" style={styles.card}>
      <View style={styles.head}>
        <ThemedText variant="caption" themeColor="textTertiary">
          {t('home.available')}
        </ThemedText>
        <IconButton name="pencil" label={t('home.adjustBalance')} onPress={onAdjust} size={18} />
      </View>

      {amount === null ? (
        <ThemedText variant="amountHero" themeColor="textDisabled">
          {t('home.amountPending')}
        </ThemedText>
      ) : (
        <ThemedText variant="amountHero" numberOfLines={1} adjustsFontSizeToFit>
          {format.money(money(toMinor(amount), definition))}
        </ThemedText>
      )}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
