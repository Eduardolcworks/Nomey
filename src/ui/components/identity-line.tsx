import { StyleSheet, View } from 'react-native';

import { type PlatformSymbol, Radius, Spacing, useTheme } from '@/ui/theme';

import { Icon } from './icon';
import { ThemedText } from './themed-text';

/**
 * A PUBLIC IDENTITY: the name, and the handle that makes it verifiable.
 *
 * A name alone does not say WHO (F12/ADR-001 §10): two accounts may share
 * one. The handle is the fact the person can check, so it is always painted
 * next to the name and never hidden behind it. When the name is missing the
 * handle carries the line; when both are missing the caller says what to
 * show instead — this component has no language of its own.
 *
 * Domain-agnostic on purpose: it knows nothing of transfers, groups or
 * accounts. The glyph is optional and passed in, so a screen can lend it
 * the meaning it has there.
 */
export type IdentityLineProps = {
  readonly name: string | null;
  readonly handle: string | null;
  /** Shown when neither name nor handle exists. */
  readonly fallback: string;
  readonly glyph?: PlatformSymbol;
  readonly emphasis?: 'regular' | 'strong';
};

export function IdentityLine({
  name,
  handle,
  fallback,
  glyph,
  emphasis = 'regular',
}: IdentityLineProps) {
  const theme = useTheme();
  const primary = name ?? (handle === null ? fallback : `@${handle}`);
  const secondary = name !== null && handle !== null ? `@${handle}` : null;

  return (
    <View
      style={styles.row}
      accessibilityLabel={secondary === null ? primary : `${primary} ${secondary}`}>
      {glyph === undefined ? null : (
        <View style={[styles.badge, { backgroundColor: theme.surfaceRaised }]}>
          <Icon name={glyph} size={16} colour={theme.textSecondary} />
        </View>
      )}
      <View style={styles.copy}>
        <ThemedText variant={emphasis === 'strong' ? 'title' : 'bodyStrong'} numberOfLines={1}>
          {primary}
        </ThemedText>
        {secondary === null ? null : (
          <ThemedText variant="caption" themeColor="textSecondary" numberOfLines={1}>
            {secondary}
          </ThemedText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minWidth: 0,
  },
  badge: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
});
