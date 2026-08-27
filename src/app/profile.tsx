import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { PlaceholderScreen } from '@/features/shell';
import { type MessageKey, useTranslation } from '@/lib/i18n';
import { ThemedText } from '@/ui/components';
import { Radius, Spacing, Tactile, useTheme } from '@/ui/theme';

/**
 * Profile: where the account and the settings will live.
 *
 * Rows only, and none of them do anything yet. They exist so the hierarchy can
 * be judged on a device - is this the right place for language and appearance?
 * - without implying that any of it works. The language row in particular is
 * deliberately inert: the preference has an API but no persistence, and a row
 * that changed the language until the next launch would be worse than one that
 * does nothing.
 *
 * The diagnostics row is the only one that navigates, and only in development.
 */
const ROWS: readonly MessageKey[] = ['profile.account', 'profile.language', 'profile.appearance'];

export default function ProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  return (
    <PlaceholderScreen title="nav.profile">
      <View style={styles.rows}>
        {ROWS.map((row) => (
          <Row key={row} label={t(row)} hint={t('action.soon')} />
        ))}

        {__DEV__ ? (
          <Row
            label={t('profile.diagnostics')}
            onPress={() => {
              router.push('/diagnostics');
            }}
          />
        ) : null}
      </View>

      <View style={[styles.note, { borderColor: theme.border }]} />
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
        <SymbolView
          name="chevron.right"
          size={16}
          tintColor={theme.textTertiary}
          fallback={<View style={[styles.chevron, { borderColor: theme.textTertiary }]} />}
        />
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
  note: {
    marginTop: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  chevron: {
    width: 12,
    height: 12,
    borderWidth: 2,
    borderRadius: Radius.sm,
  },
});
