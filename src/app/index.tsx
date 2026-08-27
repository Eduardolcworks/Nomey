import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { currencyDefinition, money, moneyFromMinorString } from '@/domain';
import { intlReport, useFormat } from '@/lib/format';
import { deviceLanguageTag, useTranslation } from '@/lib/i18n';
import { ThemedText, ThemedView } from '@/ui/components';
import { Colors, Radius, Spacing, useTheme } from '@/ui/theme';

/**
 * Holding screen.
 *
 * TEMPORARY, and replaced wholesale by the navigation shell in F4.C. It exists
 * so the foundation can be checked on a real device, which is the only place a
 * black is actually black, a yellow is the brand yellow, and `Intl` either has
 * the locale data or does not.
 *
 * It renders no product surface and fakes no feature: the amounts below are
 * fixed samples that prove the formatter, not anybody's money. The swatch
 * labels are token identifiers rather than interface copy, which is why they
 * stay literal; every actual string comes from the catalogues.
 *
 * `Section` is local and unexported on purpose. Reusable primitives are F4.D,
 * against a real consumer.
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

export default function HoldingScreen() {
  const theme = useTheme();
  const { t, locale } = useTranslation();
  const format = useFormat();

  const checks = intlReport();

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
            <ThemedText variant="bodySmall" themeColor="textSecondary">
              {t('locale.device', { tag: deviceLanguageTag() })}
            </ThemedText>
            <ThemedText variant="bodySmall" themeColor="textSecondary">
              {locale}
            </ThemedText>
          </Section>

          <Section title={t('foundation.formatting')} theme={theme}>
            <Row label={t('sample.income')}>
              <ThemedText variant="amountRow" themeColor="positive">
                {format.money(money(125050n, EUR), { sign: 'always' })}
              </ThemedText>
            </Row>
            <Row label={t('sample.expense')}>
              <ThemedText variant="amountRow" themeColor="negative">
                {format.money(money(-4280n, EUR), { sign: 'always' })}
              </ThemedText>
            </Row>
            <Row label="JPY">
              <ThemedText variant="amountRow">{format.money(money(5000n, JPY))}</ThemedText>
            </Row>
            <Row label={t('sample.large')}>
              <ThemedText variant="bodySmall">
                {format.money(moneyFromMinorString('123456789012345678901', EUR))}
              </ThemedText>
            </Row>
            <Row label="2026-08-27">
              <ThemedText variant="bodySmall" themeColor="textSecondary">
                {format.date('2026-08-27', 'long')}
              </ThemedText>
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
            <ThemedText variant="title">Aa</ThemedText>
            <ThemedText variant="body">Aa · body</ThemedText>
            <ThemedText variant="amountHero" themeColor="accent">
              {format.money(money(245830n, EUR))}
            </ThemedText>
          </Section>

          <Section title={t('foundation.runtime')} theme={theme}>
            {checks.map((entry) => (
              <Row key={entry.id} label={entry.id}>
                <ThemedText
                  variant="caption"
                  themeColor={entry.ok ? 'positive' : 'negative'}
                  style={styles.checkValue}>
                  {(entry.ok ? '✓ ' : '✕ ') + t(entry.ok ? 'runtime.available' : 'runtime.missing')}
                </ThemedText>
              </Row>
            ))}
            <ThemedText variant="caption" themeColor="textTertiary">
              {t('runtime.exactPath', {
                path: checks.find((entry) => entry.id === 'exact > 2^53')?.detail ?? '',
              })}
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
  checkValue: {
    flexShrink: 0,
  },
  swatch: {
    width: Spacing.lg,
    height: Spacing.lg,
    borderRadius: Radius.sm,
  },
});
