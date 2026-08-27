import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { AccountAvatar, DisplayNameEditor } from '@/features/auth';
import { useSession } from '@/features/session';
import { PlaceholderScreen } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';
import { GlassSurface, Icon, type IconProps, Section, ThemedText } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

/**
 * Perfil: who you are, then what you can change.
 *
 * The screen reads top to bottom as identity, settings, plan, account. The
 * photo is the largest thing on it because identity is what the screen is
 * about; everything below is a list, and lists are for scanning rather than
 * for looking at.
 *
 * **General's options are visible, not behind a row.** A settings row that
 * opens a screen containing three more rows costs a tap and a push to show
 * what already fits on the surface the user is standing on.
 *
 * **One card per section, with hairline dividers inside** - not one bordered
 * box per option. At three items the stack-of-boxes pattern reads as noise and
 * as a generic settings list; a single material object with an icon rail gives
 * the eye one edge to follow instead of three.
 *
 * `OptionRow` and `OptionGroup` stay local. Exactly one screen uses them, and
 * a component earns its place in `ui/` by having a second consumer rather than
 * an anticipated one.
 */

type Option = {
  readonly icon: IconProps['name'];
  readonly label: string;
};

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { state } = useSession();

  /*
   * Derived on every render rather than copied into state, exactly like
   * Inicio's greeting. Editing the name emits `USER_UPDATED`, the session
   * provider re-renders, and this follows without anything pushing it.
   */
  const displayName = state.status === 'signed-in' ? state.identity.displayName : null;

  const general: readonly Option[] = [
    { icon: 'globe', label: t('profile.languageCurrency') },
    { icon: 'circle.lefthalf.filled', label: t('profile.appearance') },
    { icon: 'bolt', label: t('profile.shortcuts') },
  ];

  return (
    <PlaceholderScreen title="nav.profile">
      <View style={styles.identity}>
        <AccountAvatar name={displayName} />
        <DisplayNameEditor name={displayName} />
      </View>

      <Section title={t('profile.general')}>
        <OptionGroup>
          {general.map((option, index) => (
            <OptionRow
              key={option.label}
              icon={option.icon}
              label={option.label}
              first={index === 0}
              soon
            />
          ))}
        </OptionGroup>
      </Section>

      <Section title={t('profile.plans')}>
        <PlansCard />
      </Section>

      {/*
       * Cuenta stands alone, with no section title and space above it. It is
       * the only path here that leads somewhere consequential - the session
       * ends behind it - so it reads as a boundary rather than as a fourth
       * General option.
       */}
      <OptionGroup style={styles.account}>
        <OptionRow
          icon="person.crop.circle"
          label={t('profile.account')}
          first
          onPress={() => {
            router.push('/account');
          }}
        />
      </OptionGroup>

      {__DEV__ ? (
        <Section title={t('dev.states')}>
          <OptionGroup>
            <OptionRow
              icon="waveform.path.ecg"
              label={t('profile.diagnostics')}
              first
              onPress={() => {
                router.push('/diagnostics');
              }}
            />
            <OptionRow
              icon="square.on.square"
              label={t('dev.states')}
              onPress={() => {
                router.push('/states');
              }}
            />
            <OptionRow
              icon="key"
              label={t('dev.sessionProbe')}
              onPress={() => {
                router.push('/session-probe');
              }}
            />
          </OptionGroup>
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('dev.statesHint')}
          </ThemedText>
        </Section>
      ) : null}
    </PlaceholderScreen>
  );
}

/**
 * Planes y suscripciones, with nothing to sell yet.
 *
 * A card rather than a row, because a section title over a single row that
 * does nothing is the definition of dead weight. Two lines of real content say
 * what the section will hold, occupy the space honestly, and leave the slot
 * ready without a later change of layout.
 *
 * No plan name and no tier is invented here. Nomey has not decided what it
 * sells, and a card announcing "Gratis" would be a product claim written by
 * the screen that displays it.
 *
 * No yellow either. An accent call to action would compete with the floating
 * `+`, which is the one control in this app allowed to be filled with the
 * brand colour.
 */
function PlansCard() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <GlassSurface level="regular" style={styles.plans}>
      <View style={styles.plansHead}>
        <Icon name="sparkles" size={20} colour={theme.textSecondary} />
        <SoonPill />
      </View>
      <ThemedText variant="bodyStrong">{t('profile.plansTitle')}</ThemedText>
      <ThemedText variant="bodySmall" themeColor="textSecondary">
        {t('profile.plansBody')}
      </ThemedText>
    </GlassSurface>
  );
}

/** The material the options sit on: one surface per group, not one per row. */
function OptionGroup({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <GlassSurface level="regular" style={[styles.group, style]}>
      {children}
    </GlassSurface>
  );
}

function OptionRow({
  icon,
  label,
  first = false,
  soon = false,
  onPress,
}: {
  icon: IconProps['name'];
  label: string;
  /** Suppresses the divider, which belongs to the row below it. */
  first?: boolean;
  soon?: boolean;
  onPress?: () => void;
}) {
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
        first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
        pressed && interactive ? { backgroundColor: theme.surfaceSunken } : null,
      ]}>
      {/*
       * The icon keeps full strength even on an inert row. Dimming it as well
       * would make the whole line read as broken rather than as pending, and
       * the icon rail is what makes the group scannable in the first place.
       */}
      <Icon name={icon} size={20} colour={theme.textSecondary} />
      <ThemedText
        variant="body"
        themeColor={interactive ? 'text' : 'textSecondary'}
        style={styles.rowLabel}>
        {label}
      </ThemedText>
      {/*
       * Two non-colour signals for "not yet": the chevron is absent AND a pill
       * is present. Either one alone would be a guess.
       */}
      {soon ? <SoonPill /> : <Icon name="chevron.right" size={14} colour={theme.textTertiary} />}
    </Pressable>
  );
}

function SoonPill() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View
      style={[styles.pill, { borderColor: theme.border, backgroundColor: theme.surfaceSunken }]}>
      <ThemedText variant="caption" themeColor="textTertiary">
        {t('action.soon')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  group: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 56,
    paddingHorizontal: Spacing.md,
  },
  rowLabel: {
    flex: 1,
  },
  pill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  plans: {
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  plansHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  account: {
    marginTop: Spacing.sm,
  },
});
