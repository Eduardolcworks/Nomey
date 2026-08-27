import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { PlaceholderScreen } from '@/features/shell';
import { type MessageKey, useTranslation } from '@/lib/i18n';
import { Icon, Section, ThemedText } from '@/ui/components';
import { Radius, Spacing, Tactile, useTheme } from '@/ui/theme';

/**
 * Profile: where the account and the settings live.
 *
 * Cuenta now leads to a real surface; language and appearance are still rows
 * that say so and do nothing. The hierarchy was judged on a device before any
 * of it worked, which is why the shape did not have to change to make one row
 * functional.
 *
 * `Row` stays local. It has exactly one screen using it, so lifting it into
 * the design system would be a guess about a second consumer rather than a
 * solution to a duplication that exists.
 */
const INERT_ROWS: readonly MessageKey[] = ['profile.language', 'profile.appearance'];

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <PlaceholderScreen title="nav.profile">
      <Section title={t('profile.section')}>
        <View style={styles.rows}>
          {/*
           * Cuenta is the one row that leads somewhere. The other two stay
           * inert on purpose: the language preference has an API but no
           * persistence, and a row that changed the language until the next
           * launch would be worse than one that does nothing. Both arrive
           * with Ajustes, which owns that storage decision.
           */}
          <Row
            label={t('profile.account')}
            onPress={() => {
              router.push('/account');
            }}
          />
          {INERT_ROWS.map((row) => (
            <Row key={row} label={t(row)} hint={t('action.soon')} />
          ))}
        </View>
      </Section>

      {__DEV__ ? (
        <Section title={t('dev.states')}>
          <View style={styles.rows}>
            <Row
              label={t('profile.diagnostics')}
              onPress={() => {
                router.push('/diagnostics');
              }}
            />
            <Row
              label={t('dev.states')}
              onPress={() => {
                router.push('/states');
              }}
            />
            <Row
              label={t('dev.sessionProbe')}
              onPress={() => {
                router.push('/session-probe');
              }}
            />
          </View>
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('dev.statesHint')}
          </ThemedText>
        </Section>
      ) : null}
    </PlaceholderScreen>
  );
}

function Row({ label, hint, onPress }: { label: string; hint?: string; onPress?: () => void }) {
  const theme = useTheme();
  const interactive = onPress !== undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !interactive }}
      disabled={!interactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: theme.border,
          backgroundColor: pressed ? theme.surfaceSunken : theme.surface,
          boxShadow: pressed ? Tactile.pressed : Tactile.raised,
        },
      ]}>
      <ThemedText variant="body" themeColor={interactive ? 'text' : 'textSecondary'}>
        {label}
      </ThemedText>
      {hint === undefined ? (
        <Icon name="chevron.right" size={16} colour={theme.textTertiary} />
      ) : (
        <ThemedText variant="caption" themeColor="textDisabled">
          {hint}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
  },
});
