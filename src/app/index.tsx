import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { currencyDefinition, money, moneyFromMinorString } from '@/domain';
import { type IntlStatus, intlReport, useFormat } from '@/lib/format';
import {
  deviceLanguageTag,
  deviceRegionCode,
  type MessageKey,
  useLanguagePreference,
  useTranslation,
} from '@/lib/i18n';
import { ThemedText, ThemedView } from '@/ui/components';
import { Colors, Radius, Spacing, type TextColor, useTheme } from '@/ui/theme';

/**
 * Holding screen, and the diagnostic F4.B is validated through.
 *
 * TEMPORARY, and replaced wholesale by the navigation shell in F4.C. It exists
 * so the foundation can be checked on a real device, which is the only place a
 * black is actually black, a yellow is the brand yellow, and `Intl` either has
 * a capability or does not.
 *
 * **Nothing here may take the app down.** Every formatted sample renders
 * through `Safe`, which shows the failure instead of unmounting the tree. That
 * is not defensive habit leaking into product code: a screen whose whole job
 * is to report what a runtime cannot do is useless if a missing capability
 * blanks it, which is exactly what happened the first time this ran on an
 * iPhone.
 *
 * It renders no product surface and fakes no feature: the amounts are fixed
 * samples that exercise the formatter, not anybody's money. Swatch and
 * capability labels are identifiers rather than interface copy, which is why
 * they stay literal; every actual string comes from the catalogues.
 *
 * `Section`, `Row` and `Safe` are local and unexported on purpose. Reusable
 * primitives are F4.D, against a real consumer.
 */

const EUR = currencyDefinition({ id: 'sample-eur', code: 'EUR', scale: 2 });
const JPY = currencyDefinition({ id: 'sample-jpy', code: 'JPY', scale: 0 });

/** Colour tokens whose rendering on an OLED panel is worth seeing directly. */
const PROBE: readonly (keyof typeof Colors.dark)[] = [
  'text',
  'textSecondary',
  'textTertiary',
  'accent',
  'positive',
  'negative',
];

const STATUS: Readonly<Record<IntlStatus, { key: MessageKey; colour: TextColor; mark: string }>> = {
  ok: { key: 'runtime.available', colour: 'positive', mark: '✓' },
  'optional-absent': { key: 'runtime.fallbackOk', colour: 'accent', mark: '•' },
  failed: { key: 'runtime.missing', colour: 'negative', mark: '✕' },
};

export default function HoldingScreen() {
  const theme = useTheme();
  const { t, locale } = useTranslation();
  const format = useFormat();
  const [preference] = useLanguagePreference();

  const checks = intlReport();
  const exactness = checks.find((entry) => entry.id === 'exactitud > 2^53');

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText variant="display" themeColor="accent">
            Nomey
          </ThemedText>
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('foundation.caption')}
          </ThemedText>

          <Section title={t('locale.label')} theme={theme}>
            {/*
             * Las cuatro líneas que hacen visible la separación: la preferencia
             * elige catálogo, y el formato regional no se mueve con ella.
             */}
            <Row label={t('locale.preference')}>
              <ThemedText variant="bodySmall" themeColor="accent">
                {preference === 'system' ? t('locale.automatic') : preference}
              </ThemedText>
            </Row>
            <Row label={t('locale.device')}>
              <ThemedText variant="bodySmall" themeColor="textSecondary">
                {deviceLanguageTag()}
              </ThemedText>
            </Row>
            <Row label={t('locale.region')}>
              <ThemedText variant="bodySmall" themeColor="textSecondary">
                {deviceRegionCode()}
              </ThemedText>
            </Row>
            <Row label={t('locale.catalogue')}>
              <ThemedText variant="bodySmall" themeColor="textSecondary">
                {locale}
              </ThemedText>
            </Row>
            <Row label={t('locale.formatting')}>
              <ThemedText variant="bodySmall" themeColor="textSecondary">
                {format.locale}
              </ThemedText>
            </Row>
          </Section>

          <Section title={t('foundation.formatting')} theme={theme}>
            <Row label={t('sample.income')}>
              <Safe variant="amountRow" colour="positive">
                {() => format.money(money(125050n, EUR), { sign: 'always' })}
              </Safe>
            </Row>
            <Row label={t('sample.expense')}>
              <Safe variant="amountRow" colour="negative">
                {() => format.money(money(-4280n, EUR), { sign: 'always' })}
              </Safe>
            </Row>
            <Row label="JPY">
              <Safe variant="amountRow">{() => format.money(money(5000n, JPY))}</Safe>
            </Row>
            <Row label={t('sample.large')}>
              <Safe variant="bodySmall">
                {() => format.money(moneyFromMinorString('123456789012345678901', EUR))}
              </Safe>
            </Row>
            <Row label="2026-08-27">
              <Safe variant="bodySmall" colour="textSecondary">
                {() => format.date('2026-08-27', 'long')}
              </Safe>
            </Row>
          </Section>

          <Section title={t('foundation.palette')} theme={theme}>
            {PROBE.map((token) => (
              <Row key={token} label={token}>
                <View style={[styles.swatch, { backgroundColor: theme[token] }]} />
              </Row>
            ))}
          </Section>

          <Section title={t('foundation.typography')} theme={theme}>
            <ThemedText variant="body">Aa · body</ThemedText>
            <Safe variant="amountHero" colour="accent">
              {() => format.money(money(245830n, EUR))}
            </Safe>
          </Section>

          <Section title={t('foundation.runtime')} theme={theme}>
            {checks.map((entry) => {
              const status = STATUS[entry.status];
              return (
                <View key={entry.id} style={styles.check}>
                  <Row label={entry.id}>
                    <ThemedText variant="caption" themeColor={status.colour}>
                      {`${status.mark} ${t(status.key)}`}
                    </ThemedText>
                  </Row>
                  <ThemedText variant="caption" themeColor="textTertiary" numberOfLines={2}>
                    {entry.detail}
                  </ThemedText>
                </View>
              );
            })}
            <ThemedText variant="caption" themeColor="textTertiary">
              {t('runtime.exactPath', { path: exactness?.detail ?? '' })}
            </ThemedText>
          </Section>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Section({
  title,
  theme,
  children,
}: {
  title: string;
  theme: ReturnType<typeof useTheme>;
  children: ReactNode;
}) {
  return (
    <View style={[styles.section, { borderColor: theme.border }]}>
      <ThemedText variant="subheading">{title}</ThemedText>
      {children}
    </View>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <ThemedText variant="bodySmall" themeColor="textTertiary" style={styles.rowLabel}>
        {label}
      </ThemedText>
      {children}
    </View>
  );
}

/** Renders a formatted value, or the reason it could not be formatted. */
function Safe({
  variant,
  colour,
  children,
}: {
  variant: 'amountRow' | 'amountHero' | 'bodySmall';
  colour?: TextColor;
  children: () => string;
}) {
  // Sólo el cálculo va dentro del try. Envolver el JSX no capturaría nada: un
  // elemento es un objeto, y el render de sus hijos ocurre después, fuera de
  // este bloque. Es lo que señala `react-hooks/error-boundaries`.
  let text: string;
  let failed = false;

  try {
    text = children();
  } catch (error) {
    text = error instanceof Error ? error.message : String(error);
    failed = true;
  }

  return (
    <ThemedText
      variant={failed ? 'bodySmall' : variant}
      themeColor={failed ? 'negative' : colour}
      style={styles.value}>
      {text}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.xs,
  },
  section: {
    marginTop: Spacing.xl,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  rowLabel: {
    flexShrink: 1,
  },
  check: {
    gap: Spacing.xxs,
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
  },
  swatch: {
    width: Spacing.lg,
    height: Spacing.lg,
    borderRadius: Radius.sm,
  },
});
