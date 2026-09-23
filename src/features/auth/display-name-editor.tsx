import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { IconButton, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, Typography, useTheme } from '@/ui/theme';

import { type AuthResult, updateDisplayName } from './auth-service';
import { normaliseDisplayName } from './credentials';
import { useAuthSubmit } from './use-auth-submit';

/**
 * The name, and the field that changes it.
 *
 * **Edited in place rather than in a sheet.** It is one short field with no
 * validation branching and nothing destructive behind it; a sheet would be a
 * push, a form and a dismissal for a change that is usually a typo fix. The
 * text swaps for an input at the same typographic role so nothing under it
 * jumps when the mode changes.
 *
 * **The pencil is no longer this component's**, since F12.E.C. It sat right
 * after the name, the username editor had one of its own, and two pencils in
 * a two-line identity block were two controls for one intention - "change my
 * details". Profile's header now has a single one that opens both. What is
 * still this component's is everything else: the draft, the validation, the
 * write and when it closes.
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
 *
 * **Since F12.A3 the write is pluggable.** Profile hands in `updatePublicName`
 * — `api.set_public_name` FIRST, the Auth metadata copy second (F12/ADR-001
 * §10) — and shows the name `core` holds. The default stays the metadata
 * write, for a caller that has no public identity to keep in step. `notice`
 * is the one sentence the caller may add under the name once saved: «guardado
 * aquí; el saludo se pondrá al día» when the metadata copy failed.
 */
export function DisplayNameEditor({
  name,
  onSave = updateDisplayName,
  notice,
  editing,
  onEditingChange,
}: {
  name: string | null;
  /** The write. Resolves to an `AuthResult`; the editor closes only on `ok`. */
  onSave?: (draft: string) => Promise<AuthResult>;
  readonly notice?: string;
  /**
   * SI ESTÁ EN EDICIÓN, Y LO DECIDE QUIEN LO MONTA.
   *
   * Tuvo su propio estado y su propio lápiz. Desde F12.E.C la cabecera de
   * Perfil tiene UN solo lápiz para los dos campos —el nombre y el
   * `@username`—, así que quien abre la edición es la pantalla; este
   * componente sigue siendo el dueño de todo lo demás: el borrador, la
   * validación, el envío y cuándo se cierra.
   *
   * El borrador **se deriva** del nombre mientras nadie haya escrito
   * (`draft === null`), así que abrir no necesita sembrar nada desde un
   * efecto —que es lo que `react-hooks/set-state-in-effect` prohíbe— y la
   * primera pulsación ya encuentra el valor correcto.
   */
  readonly editing: boolean;
  readonly onEditingChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { state, submit, clearError, running } = useAuthSubmit();

  const [touched, setTouched] = useState<string | null>(null);
  const draft = touched ?? name ?? '';

  function close() {
    clearError();
    setTouched(null);
    onEditingChange(false);
  }

  async function save() {
    const result = await submit(() => onSave(draft));
    // `undefined` means the guard skipped a second submission; the first is
    // still running and owns the outcome.
    if (result?.ok === true) {
      setTouched(null);
      onEditingChange(false);
    }
  }

  if (!editing) {
    return (
      <View style={styles.block}>
        <View style={styles.reading}>
          {/*
           * Sin lápiz propio: lo sustituye el ÚNICO de la cabecera de Perfil,
           * que abre este editor y el del `@username` a la vez. Dos lápices
           * en un bloque de identidad de dos líneas eran dos controles para
           * una misma intención — «cambiar mis datos».
           */}
          <ThemedText variant="title" numberOfLines={1} style={styles.name}>
            {name ?? t('account.noName')}
          </ThemedText>
        </View>
        {notice === undefined ? null : (
          <ThemedText variant="bodySmall" themeColor="textSecondary" style={styles.notice}>
            {notice}
          </ThemedText>
        )}
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
          onChangeText={setTouched}
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
          name={Symbols.close}
          label={t('action.cancel')}
          size={16}
          colour={theme.textSecondary}
          onPress={close}
        />
        <IconButton
          name={Symbols.confirm}
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
  /*
   * A LA IZQUIERDA, no centrado. La cabecera de Perfil pasó de una columna
   * centrada a una fila —avatar a la izquierda, identidad a su derecha— y un
   * nombre centrado dentro de su columna se habría despegado del eje del
   * `@username` de debajo, que es justo lo que el bloque de identidad tiene
   * que compartir. Perfil es el único consumidor de este editor.
   */
  block: { alignItems: 'flex-start', gap: Spacing.xxs },
  notice: { textAlign: 'left' },
  reading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: Spacing.xxs,
    // Keeps the two modes the same height, so swapping does not shift the
    // sections below.
    minHeight: 44,
  },
  name: {
    flexShrink: 1,
    textAlign: 'left',
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
    textAlign: 'left',
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: 1,
    borderRadius: Radius.sm,
  },
});
