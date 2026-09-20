import { StyleSheet, View } from 'react-native';

import { pluralCategory, useTranslation } from '@/lib/i18n';
import { GlassPressable, Icon, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

/**
 * THE CONTEXTUAL LINE ON INICIO, only while something waits.
 *
 * Renders nothing with nothing pending: it is not a section of the home,
 * it is a pointer to the proposals screen that exists exactly as long as a
 * proposal wants an answer or is waiting for one. Incoming ones come first
 * in the copy because those need the person; outgoing ones are just news.
 */
export function PendingTransfersBanner({
  incoming,
  outgoing,
  onOpen,
}: {
  readonly incoming: number;
  readonly outgoing: number;
  readonly onOpen: () => void;
}) {
  const { t, locale } = useTranslation();
  const theme = useTheme();

  if (incoming === 0 && outgoing === 0) return null;

  const line =
    incoming > 0
      ? t(
          pluralCategory(locale, incoming) === 'one'
            ? 'transfer.bannerIncomingOne'
            : 'transfer.bannerIncomingOther',
          { count: incoming },
        )
      : t(
          pluralCategory(locale, outgoing) === 'one'
            ? 'transfer.bannerOutgoingOne'
            : 'transfer.bannerOutgoingOther',
          { count: outgoing },
        );

  return (
    <GlassPressable
      label={`${line}. ${t('transfer.bannerOpen')}`}
      depth="well"
      rim="soft"
      radius={Radius.lg}
      onPress={onOpen}>
      <View style={styles.banner}>
        <View style={[styles.badge, { backgroundColor: theme.surfaceRaised }]}>
          <Icon
            name={Symbols.transfer}
            size={16}
            colour={incoming > 0 ? theme.accent : theme.textSecondary}
          />
        </View>
        <ThemedText variant="body" style={styles.line} numberOfLines={2}>
          {line}
        </ThemedText>
        <Icon name={Symbols.forward} size={16} colour={theme.textTertiary} />
      </View>
    </GlassPressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: {
    flex: 1,
    minWidth: 0,
  },
});
