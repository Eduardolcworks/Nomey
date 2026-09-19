import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { IconButton, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, Typography, useTheme } from '@/ui/theme';

import { usernameProblem } from './credentials';
import { changeUsername } from './identity-service';
import { type AccountIdentity, calendarDayOf, canChangeUsername } from './identity-state';
import { useAccountIdentity } from './use-account-identity';
import { useAuthSubmit } from './use-auth-submit';

/**
 * `@username` en Perfil, y el lápiz que lo cambia (F12/ADR-001 §9, F12.A3).
 *
 * El mismo gesto que el nombre: se edita en su sitio, sin hoja, y el texto se
 * sustituye por un campo del mismo rol tipográfico. Lo que se enseña es lo que
 * `core` dice (`api.my_account_handle` por el proveedor de identidad): ni
 * historial, ni handles retenidos, ni nada interno.
 *
 * El cooldown se enseña, no se esconde: mientras `can_change_at` esté en el
 * futuro, el lápiz no está y debajo del handle se lee «Podrás cambiarlo a
 * partir del …». Si aun así el servidor rehusara con `USERNAME_CHANGE_COOLDOWN`
 * (otro dispositivo cambió entre medias), la frase lleva la fecha que él dice.
 *
 * Recuperar el handle anterior es escribirlo: el servidor lo reconoce como
 * propio y retenido y lo reactiva; para la app es un cambio más.
 */
export function UsernameEditor({ identity }: { readonly identity: AccountIdentity }) {
  const { t } = useTranslation();
  const { date } = useFormat();
  const theme = useTheme();
  const { apply } = useAccountIdentity();
  const { state, submit, clearError, running } = useAuthSubmit();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);

  const canChange = canChangeUsername(identity, new Date());
  const cooldownDay = (iso: string | null) => (iso === null ? null : calendarDayOf(iso));
  const shownCooldown = cooldownDay(cooldownUntil ?? (canChange ? null : identity.canChangeAt));

  function open() {
    setDraft(identity.handle ?? '');
    clearError();
    setEditing(true);
  }
  function close() {
    clearError();
    setEditing(false);
  }

  async function save() {
    const result = await submit(async () => {
      const outcome = await changeUsername(draft);
      if (outcome.ok) {
        apply(outcome.identity);
        return { ok: true } as const;
      }
      if (outcome.required === true) return { ok: false, messageKey: 'authError.generic' } as const;
      if (outcome.availableAt !== undefined) setCooldownUntil(outcome.availableAt);
      return { ok: false, messageKey: outcome.messageKey } as const;
    });
    if (result?.ok === true) setEditing(false);
  }

  if (!editing) {
    return (
      <View style={styles.reading}>
        <View style={styles.row}>
          <ThemedText variant="body" themeColor="textSecondary" numberOfLines={1}>
            {identity.handle === null ? t('identity.noUsername') : `@${identity.handle}`}
          </ThemedText>
          {canChange ? (
            <IconButton
              name={Symbols.edit}
              label={t('identity.editUsername')}
              size={16}
              colour={theme.textSecondary}
              onPress={open}
            />
          ) : null}
        </View>
        {shownCooldown === null ? null : (
          <ThemedText variant="bodySmall" themeColor="textSecondary">
            {t('identity.cooldownUntil', { date: date(shownCooldown, 'long') })}
          </ThemedText>
        )}
      </View>
    );
  }

  const problem = draft === '' ? 'empty' : usernameProblem(draft);
  const sendable = problem === null && !running;
  const error =
    state.status === 'failed'
      ? state.messageKey === 'authError.usernameCooldown' && shownCooldown !== null
        ? t('identity.cooldownUntil', { date: date(shownCooldown, 'long') })
        : t(state.messageKey)
      : problem === 'invalid'
        ? t('authError.usernameInvalid')
        : problem === 'reserved'
          ? t('authError.usernameReserved')
          : undefined;

  return (
    <View style={styles.editing}>
      <View style={styles.row}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          editable={!running}
          autoFocus
          selectTextOnFocus
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('auth.username')}
          placeholder={t('auth.usernamePlaceholder')}
          placeholderTextColor={theme.textDisabled}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (sendable) void save();
          }}
          maxLength={24}
          style={[
            styles.input,
            Typography.body,
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
          colour={sendable ? theme.text : theme.textDisabled}
          onPress={() => {
            if (sendable) void save();
          }}
        />
      </View>
      <ThemedText
        variant="bodySmall"
        themeColor={error === undefined ? 'textSecondary' : 'negative'}
        accessibilityLiveRegion="polite"
        accessibilityRole={error === undefined ? undefined : 'alert'}>
        {error ?? t('identity.changeHint')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  reading: { alignItems: 'center', gap: Spacing.xxs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xxs },
  editing: { alignSelf: 'stretch', gap: Spacing.xs },
  input: {
    flex: 1,
    minHeight: 40,
    textAlign: 'center',
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: 1,
    borderRadius: Radius.sm,
  },
});
