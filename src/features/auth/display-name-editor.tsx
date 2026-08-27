import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { IconButton, ThemedText } from '@/ui/components';
import { Radius, Spacing, Typography, useTheme } from '@/ui/theme';

import { updateDisplayName } from './auth-service';
import { normaliseDisplayName } from './credentials';
import { useAuthSubmit } from './use-auth-submit';

/**
 * The name, and the pencil that changes it.
 *
 * **Edited in place rather than in a sheet.** It is one short field with no
 * validation branching and nothing destructive behind it; a sheet would be a
 * push, a form and a dismissal for a change that is usually a typo fix. The
 * text swaps for an input at the same typographic role so nothing under it
 * jumps when the mode changes.
 *
 * The pencil sits immediately after the name inside the same target rather
 * than pinned to the far right of the row. At the edge it reads as an action
 * on the whole block - which, on a screen whose block also contains a photo,
 * is genuinely ambiguous about what would be edited.
 *
 * **The write is not optimistic**, and that matters more here than it looks.
 * The screen shows what the session says, the session says what the server
 * answered, and the input closes only once that answer has arrived. Painting
 * the new name immediately would show a value that a failed request then
 * silently reverts - and the person would have no way to tell which of the two
 * names is now real.
 *
 * Nothing here pushes the new name anywhere. `updateDisplayName` produces a
 * `USER_UPDATED` event, the session provider is the single subscriber, and
 * both this and Inicio's greeting re-render from it. There is no second copy
 * to keep in step.
 */
export function DisplayNameEditor({ name }: { name: string | null }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { state, submit, clearError, running } = useAuthSubmit();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function open() {
    setDraft(name ?? '');
    clearError();
    setEditing(true);
  }

  function close() {
    clearError();
    setEditing(false);
  }

  async function save() {
    const result = await submit(() => updateDisplayName(draft));
    // `undefined` means the guard skipped a second submission; the first is
    // still running and owns the outcome.
    if (result?.ok === true) setEditing(false);
  }

  if (!editing) {
    return (
      <View style={styles.reading}>
        <ThemedText variant="title" numberOfLines={1} style={styles.name}>
          {name ?? t('account.noName')}
        </ThemedText>
        <IconButton
          name="pencil"
          label={t('profile.editName')}
          size={16}
          colour={theme.textSecondary}
          onPress={open}
        />
      </View>
    );
  }

  // Empty is refused before it is sent, so the control that would send it is
  // off. The service refuses it too - this is the affordance, not the rule.
  const empty = normaliseDisplayName(draft) === '';
  const error = state.status === 'failed' ? t(state.messageKey) : undefined;

  return (
    <View style={styles.editing}>
      <View style={styles.row}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          editable={!running}
          autoFocus
          selectTextOnFocus
          accessibilityLabel={t('auth.name')}
          placeholder={t('auth.namePlaceholder')}
          placeholderTextColor={theme.textDisabled}
          returnKeyType="done"
          onSubmitEditing={() => void save()}
          maxLength={64}
          style={[
            styles.input,
            Typography.title,
            { color: theme.text, borderBottomColor: running ? theme.border : theme.accent },
          ]}
        />
        <IconButton
          name="xmark"
          label={t('action.cancel')}
          size={16}
          colour={theme.textSecondary}
          onPress={close}
        />
        <IconButton
          name="checkmark"
          label={t('action.save')}
          size={18}
          colour={empty || running ? theme.textDisabled : theme.text}
          onPress={() => {
            if (empty || running) return;
            void save();
          }}
        />
      </View>

      {error === undefined ? null : (
        <ThemedText
          variant="bodySmall"
          themeColor="negative"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert">
          {error}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  reading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xxs,
    // Keeps the two modes the same height, so swapping does not shift the
    // sections below.
    minHeight: 44,
  },
  name: {
    flexShrink: 1,
    textAlign: 'center',
  },
  editing: {
    alignSelf: 'stretch',
    gap: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    minHeight: 44,
  },
  input: {
    flex: 1,
    minHeight: 44,
    textAlign: 'center',
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: 1,
    borderRadius: Radius.sm,
  },
});
