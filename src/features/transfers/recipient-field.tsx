import { StyleSheet, TextInput, View } from 'react-native';

import { HANDLE_MAX_LENGTH } from '@/domain';
import { type MessageKey, useTranslation } from '@/lib/i18n';
import { GlassPressable, GlassSurface, Icon, IdentityLine, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import type { RecipientState } from './recipient';
import type { RecipientLookup } from './use-resolve-recipient';

/** Same height as the concept row of the movement form: this sheet is that sheet. */
const CIRCLE = 52;

const STATE_KEY: Readonly<Record<Exclude<RecipientState['kind'], 'found' | 'idle'>, MessageKey>> = {
  invalid: 'transfer.recipientInvalid',
  searching: 'transfer.recipientSearching',
  not_found: 'transfer.recipientNotFound',
  throttled: 'transfer.recipientThrottled',
  self: 'transfer.recipientSelf',
  offline: 'transfer.recipientOffline',
  failed: 'transfer.recipientFailed',
};

/**
 * THE `@username` FIELD, and what the server said about it.
 *
 * A minimal field of this feature's own, over the same primitives the
 * movement form uses (`GlassSurface` well, `GlassPressable` circle): the
 * sign-up field lives in `features/auth` and a feature may not import
 * another. What is NOT duplicated is the rule: the handle's shape and the
 * reserved names come from `domain/username`, through `recipient.ts`.
 *
 * The `@` is painted, not typed: pasting `@ana` or typing `ana` resolve the
 * same, and nobody has to remember which one Nomey wants.
 */
export function RecipientField({
  lookup,
  onChange,
  onPickFriend,
}: {
  readonly lookup: RecipientLookup;
  /** The person wants to pick someone else after a `found`. */
  readonly onChange: () => void;
  /**
   * OPENS THE FRIENDS PICKER (F12.E.E). Absent, the row is exactly what it
   * was: field plus lens.
   *
   * The lens does NOT change meaning — it still finds ANY account by exact
   * `@username`, friend or not. This is a shortcut over the friends already
   * loaded, not a restriction on who can receive a transfer.
   */
  readonly onPickFriend?: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { state } = lookup;

  /*
   * FOUND: the same row, with the identity where the text was and an X where
   * the lens was. Same geometry as the search state — the well and the
   * circle keep their size — so nothing jumps and nothing overflows: a text
   * button next to the well was wider than the space it had. The X clears
   * the recipient and goes back to searching; the amount and the concept
   * live in the form, not here, and stay as they were.
   */
  if (state.kind === 'found') {
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
            style={styles.box}
            accessibilityRole="summary">
            <View style={styles.identity}>
              <IdentityLine
                name={state.publicName}
                handle={state.handle}
                fallback={t('transfer.recipientUnknown')}
              />
            </View>
          </GlassSurface>

          <GlassPressable label={t('transfer.recipientChange')} depth="well" onPress={onChange}>
            <View style={styles.circle}>
              <Icon name={Symbols.close} size={20} colour={theme.textSecondary} shape="circle" />
            </View>
          </GlassPressable>
        </View>
      </View>
    );
  }

  const problem =
    state.kind === 'invalid' && state.problem === 'reserved' ? 'transfer.recipientReserved' : null;
  const line: MessageKey | null = state.kind === 'idle' ? null : (problem ?? STATE_KEY[state.kind]);
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
            placeholder={t('transfer.recipientPlaceholder')}
            placeholderTextColor={theme.textDisabled}
            accessibilityLabel={t('transfer.recipientLabel')}
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
          label={t('transfer.recipientSearch')}
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

        {/*
         * EL SEGUNDO CAMINO, en la misma fila y con el mismo peso visual que
         * la lupa: mismo `GlassPressable`, mismo círculo de 52, mismo tamaño
         * de icono. Son dos maneras de llegar al mismo destinatario, así que
         * ninguna de las dos puede parecer la principal.
         *
         * En gris secundario y no en amarillo: el acento de la lupa dice
         * «hay algo que buscar con lo que has escrito», que es un estado del
         * campo. Éste no depende de lo escrito y está siempre disponible.
         */}
        {onPickFriend === undefined ? null : (
          <GlassPressable
            label={t('transfer.recipientFriends')}
            depth="well"
            disabled={state.kind === 'searching'}
            onPress={onPickFriend}>
            <View style={styles.circle}>
              <Icon name={Symbols.friends} size={20} colour={theme.textSecondary} shape="circle" />
            </View>
          </GlassPressable>
        )}
      </View>

      {line === null ? null : (
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
  identity: {
    flex: 1,
    minWidth: 0,
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
