import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { type MessageKey, useTranslation } from '@/lib/i18n';
import { IconButton, ThemedText } from '@/ui/components';
import { Spacing } from '@/ui/theme';

import { ScopeSwitch } from './scope-switch';

const MARK = require('../../../assets/splash/splash-icon.png') as number;

/**
 * The header both root destinations share.
 *
 * The right-hand cluster - notifications and profile - is identical on Inicio
 * and on Grupos, and that is deliberate rather than incidental. The
 * notifications a shared-expense app actually produces are born in Grupos:
 * someone added an expense, someone settled up. A bell that only exists on
 * Inicio turns reading them into a detour through the tab bar, and breaks a
 * rule that is otherwise teachable in one sentence - your account and your
 * alerts live top right.
 *
 * Only the left side changes: Inicio carries the mark, the wordmark and the
 * signature, because it is where the app introduces itself; Grupos carries its
 * section title, because by then the user knows what app they are in.
 *
 * Inicio adds a second row - the greeting and the scope switch - so the row
 * that identifies the app and the row that says whose money is on screen never
 * compete for the same line.
 */
export type AppHeaderProps = {
  title?: MessageKey;
  greeting?: boolean;
  /**
   * The name to greet, when there is one.
   *
   * It arrives as a prop rather than being read here, and that is the
   * architecture rather than a preference: `features/shell` may not import
   * `features/session` - ESLint enforces cross-feature isolation - so the
   * route composes the two. That is what `src/app/` is for.
   *
   * `null` or empty means greet without a name. It must NOT fall back to a
   * placeholder: showing an invented name to someone who is signed in is
   * worse than greeting them plainly.
   */
  greetingName?: string | null;
};

export function AppHeader({ title, greeting, greetingName }: AppHeaderProps) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <View style={styles.header}>
      <View style={styles.topRow}>
        {title === undefined ? (
          <View style={styles.brand}>
            <Image source={MARK} style={styles.mark} contentFit="contain" />
            <View>
              <ThemedText variant="heading">Nomey</ThemedText>
              {/*
               * The signature, and deliberately quiet: two roles down from the
               * wordmark and in tertiary grey, which still measures 6.1:1 on
               * the ground. It reads as a maker's mark rather than as a second
               * title competing with the first.
               */}
              <ThemedText variant="caption" themeColor="textTertiary" style={styles.signature}>
                {t('brand.signature')}
              </ThemedText>
            </View>
          </View>
        ) : (
          <ThemedText variant="title">{t(title)}</ThemedText>
        )}

        <View style={styles.actions}>
          <IconButton
            name="bell"
            label={t('nav.notifications')}
            onPress={() => {
              router.push('/notifications');
            }}
          />
          <IconButton
            name="person.crop.circle"
            label={t('nav.profile')}
            onPress={() => {
              router.push('/profile');
            }}
          />
        </View>
      </View>

      {greeting === true ? (
        <View style={styles.greetingRow}>
          <ThemedText variant="title" style={styles.greeting} numberOfLines={1}>
            {greetingName === null || greetingName === undefined || greetingName === ''
              ? t('home.greetingPlain')
              : t('home.greeting', { name: greetingName })}
          </ThemedText>
          <ScopeSwitch />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  mark: {
    width: 30,
    height: 30,
  },
  signature: {
    marginTop: -2,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  greeting: {
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
});
