import { StyleSheet, TextInput, View } from 'react-native';

import { HANDLE_MAX_LENGTH } from '@/domain';
import { type MessageKey, useTranslation } from '@/lib/i18n';
import { GlassPressable, GlassSurface, Icon, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import type { CandidateState } from './friend-candidate';
import type { CandidateLookup } from './use-lookup-candidate';

/** Same height as the concept row of the movement form: one control size in the app. */
const CIRCLE = 52;

const STATE_KEY: Readonly<
  Record<Exclude<CandidateState['kind'], 'found' | 'idle' | 'invalid'>, MessageKey>
> = {
  searching: 'friends.searching',
  not_found: 'friends.notFound',
  self: 'friends.self',
  throttled: 'friends.throttled',
  offline: 'friends.searchOffline',
  failed: 'friends.searchFailed',
};

/**
 * THE EXACT `@username` FIELD, and nothing more.
 *
 * No autocomplete, no global listing, no partial match, no e-mail and no
 * uid: the only thing Nomey can be asked is «is there an account with
 * EXACTLY this handle», and the person asks it explicitly (F12/ADR-005 §5).
 * The `@` is painted rather than typed, so pasting `@ana` and typing `ana`
 * behave the same.
 *
 * A minimal field of this feature's own, over the same primitives the
 * transfers field uses: a feature may not import another, and what must not
 * be duplicated is the RULE — the handle's shape and the reserved names come
 * from `domain/username`, through `friend-candidate.ts`.
 *
 * Whoever was found is NOT painted here: the result and what can be done
 * about it are `CandidateResult`'s, because the same identity can mean five
 * different offers depending on the relation.
 */
export function CandidateField({ lookup }: { readonly lookup: CandidateLookup }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { state } = lookup;

  const problem =
    state.kind === 'invalid'
      ? state.problem === 'reserved'
        ? 'friends.searchReserved'
        : 'friends.searchInvalid'
      : null;
  const line: MessageKey | null =
    state.kind === 'idle' || state.kind === 'found'
      ? null
      : (problem ?? STATE_KEY[state.kind as keyof typeof STATE_KEY]);
  const negative =
    state.kind === 'invalid' ||
    state.kind === 'not_found' ||
    state.kind === 'self' ||
    state.kind === 'failed';

  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <GlassSurface
          material="control"
          level="regular"
          depth="well"
          rim="soft"
          radius={Radius.full}
          nativeEffect={false}
          style={styles.box}>
          <ThemedText variant="body" themeColor="textSecondary" style={styles.at}>
            @
          </ThemedText>
          <TextInput
            value={lookup.text}
            onChangeText={lookup.setText}
            onSubmitEditing={lookup.search}
            placeholder={t('friends.searchPlaceholder')}
            placeholderTextColor={theme.textDisabled}
            accessibilityLabel={t('friends.searchLabel')}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            keyboardType="ascii-capable"
            returnKeyType="search"
            maxLength={HANDLE_MAX_LENGTH + 1}
            editable={state.kind !== 'searching'}
            style={[styles.input, { color: theme.text }]}
          />
        </GlassSurface>

        <GlassPressable
          label={t('friends.searchAction')}
          depth="well"
          disabled={!lookup.canSearch}
          busy={state.kind === 'searching'}
          onPress={lookup.search}>
          <View style={styles.circle}>
            <Icon
              name={Symbols.search}
              size={20}
              colour={lookup.canSearch ? theme.accent : theme.textDisabled}
              shape="circle"
            />
          </View>
        </GlassPressable>
      </View>

      {line === null ? (
        <ThemedText variant="caption" themeColor="textTertiary" style={styles.line}>
          {t('friends.searchHint')}
        </ThemedText>
      ) : (
        <ThemedText
          variant="caption"
          themeColor={negative ? 'negative' : 'textTertiary'}
          style={styles.line}
          accessibilityLiveRegion="polite">
          {t(line)}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  box: {
    flex: 1,
    height: CIRCLE,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.xxs,
  },
  at: {
    fontSize: 16,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: {
    textAlign: 'center',
  },
});
