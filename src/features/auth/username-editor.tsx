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
 * `@username` en Perfil (F12/ADR-001 §9, F12.A3).
 *
 * El mismo gesto que el nombre: se edita en su sitio, sin hoja, y el texto se
 * sustituye por un campo del mismo rol tipográfico. Lo que se enseña es lo que
 * `core` dice (`api.my_account_handle` por el proveedor de identidad): ni
 * historial, ni handles retenidos, ni nada interno.
 *
 * El cooldown se enseña, no se esconde: mientras `can_change_at` esté en el
 * futuro, esto no entra en edición aunque el lápiz de la cabecera lo abra, y
 * debajo del handle se lee «Podrás cambiarlo a partir del …». Si aun así el
 * servidor rehusara con `USERNAME_CHANGE_COOLDOWN` (otro dispositivo cambió
 * entre medias), la frase lleva la fecha que él dice.
 *
 * **Quién abre es la pantalla, desde F12.E.C.** Tuvo lápiz propio, y con el
 * del nombre al lado eran dos controles para una misma intención. Lo demás
 * sigue siendo suyo: el borrador, la validación, el envío y cuándo cierra.
 *
 * Recuperar el handle anterior es escribirlo: el servidor lo reconoce como
 * propio y retenido y lo reactiva; para la app es un cambio más.
 */
export function UsernameEditor({
  identity,
  editing,
  onEditingChange,
}: {
  readonly identity: AccountIdentity;
  /**
   * Lo mismo que en `DisplayNameEditor`: el ÚNICO lápiz de Perfil abre los
   * dos, y cada uno sigue siendo dueño de su borrador, su validación, su
   * cooldown y cuándo se cierra.
   *
   * **El cooldown no se relaja por esto.** Si el handle no se puede cambiar
   * todavía, abrir la edición no lo abre: se sigue viendo la fecha, como
   * antes, y quien decide es `canChangeUsername`.
   */
  readonly editing: boolean;
  readonly onEditingChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const { date } = useFormat();
  const theme = useTheme();
  const { apply } = useAccountIdentity();
  const { state, submit, clearError, running } = useAuthSubmit();

  const [touched, setTouched] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);
  const draft = touched ?? identity.handle ?? '';

  const canChange = canChangeUsername(identity, new Date());
  const cooldownDay = (iso: string | null) => (iso === null ? null : calendarDayOf(iso));
  const shownCooldown = cooldownDay(cooldownUntil ?? (canChange ? null : identity.canChangeAt));

  function close() {
    clearError();
    setTouched(null);
    onEditingChange(false);
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
    if (result?.ok === true) {
      setTouched(null);
      onEditingChange(false);
    }
  }

  if (!editing || !canChange) {
    return (
      <View style={styles.reading}>
        <View style={styles.row}>
          <ThemedText variant="body" themeColor="textSecondary" numberOfLines={1}>
            {identity.handle === null ? t('identity.noUsername') : `@${identity.handle}`}
          </ThemedText>
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
      : problem === 'at'
        ? t('authError.usernameNoAtSign')
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
          onChangeText={setTouched}
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
  // A la izquierda, por el mismo motivo que el editor del nombre: los dos
  // empiezan en el mismo eje X dentro de la columna de identidad.
  reading: { alignItems: 'flex-start', gap: Spacing.xxs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: Spacing.xxs,
  },
  editing: { alignSelf: 'stretch', gap: Spacing.xs },
  input: {
    flex: 1,
    minHeight: 40,
    textAlign: 'left',
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: 1,
    borderRadius: Radius.sm,
  },
});
