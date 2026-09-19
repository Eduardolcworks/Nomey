import { useRef, useState } from 'react';
import { StyleSheet, type TextInput, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { ActionButton, ThemedText } from '@/ui/components';
import { Spacing } from '@/ui/theme';

import { AuthField } from './auth-field';
import { AuthScreen } from './auth-screen';
import { normaliseDisplayName, usernameProblem } from './credentials';
import { chooseUsername } from './identity-service';
import { useAccountIdentity } from './use-account-identity';
import { useAuthSubmit } from './use-auth-submit';
import { UsernameField } from './username-field';

/**
 * EL GATE: una cuenta normal sin username definitivo elige uno antes de las
 * pestañas (F12/ADR-001 §7, F12.A3).
 *
 * Quién llega aquí: la cuenta que el servidor rehusó reclamar con
 * `USERNAME_REQUIRED` — una cuenta anterior a F12, que nunca tuvo identidad,
 * o una cuya reserva provisional caducó sin abrir la app. Nunca un invitado
 * (el ciclo no le pregunta) y nunca una cuenta con reserva viva (el ciclo la
 * reclama solo).
 *
 * Qué pide: el username y, para que `core.account_identity` nazca con nombre,
 * el nombre público, precargado con el `display_name` de la sesión — el que
 * la cuenta ya enseña de sí misma, nunca derivado del correo ni inventado.
 * Sin «Saltar» ni «Más tarde»: sin username no hay identidad pública, y sin
 * ella nada de F12 puede dirigirse a esta cuenta.
 *
 * Cómo sale: `reserve_username` (una cuenta normal reclama en el acto) y, si
 * el servidor devolviera una reserva, `claim_username`; el estado que vuelve
 * se aplica al proveedor de identidad y la guarda del navegador cambia de
 * rama sola. Aquí no se navega.
 */
export function UsernameGate({ initialName }: { readonly initialName: string | null }) {
  const { t } = useTranslation();
  const { apply } = useAccountIdentity();
  const { state, submit, clearError, running } = useAuthSubmit();

  const [publicName, setPublicName] = useState(initialName ?? '');
  const [username, setUsername] = useState('');
  const usernameField = useRef<TextInput>(null);

  const ready = normaliseDisplayName(publicName) !== '' && usernameProblem(username) === null;

  async function onSubmit() {
    if (!ready || running) return;
    clearError();
    const result = await submit(async () => {
      const outcome = await chooseUsername(username, publicName);
      if (outcome.ok) {
        apply(outcome.identity);
        return { ok: true } as const;
      }
      // A refusal to reserve when the account has no username is not a state
      // this screen can show: the generic sentence, and the person retries.
      if (outcome.required === true) return { ok: false, messageKey: 'authError.generic' } as const;
      return { ok: false, messageKey: outcome.messageKey } as const;
    });
    void result;
  }

  const error = state.status === 'failed' ? t(state.messageKey) : undefined;

  return (
    <AuthScreen>
      <View style={styles.heading}>
        <ThemedText variant="display">{t('identity.gateTitle')}</ThemedText>
        <ThemedText variant="body" themeColor="textSecondary">
          {t('identity.gateBody')}
        </ThemedText>
      </View>

      <View style={styles.form}>
        <AuthField
          label={t('identity.publicName')}
          placeholder={t('auth.namePlaceholder')}
          value={publicName}
          onChangeText={setPublicName}
          editable={!running}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          onSubmitEditing={() => usernameField.current?.focus()}
          submitBehavior="submit"
          hint={t('identity.publicNameHint')}
        />
        <UsernameField
          ref={usernameField}
          value={username}
          onChangeText={setUsername}
          editable={!running}
          autoFocus={initialName !== null && initialName !== ''}
          returnKeyType="go"
          onSubmitEditing={() => void onSubmit()}
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

      <ActionButton
        label={running ? t('auth.working') : t('identity.gateAction')}
        onPress={() => void onSubmit()}
        tone="brand"
        disabled={running || !ready}
        busy={running}
      />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: Spacing.xs },
  form: { gap: Spacing.md },
});
