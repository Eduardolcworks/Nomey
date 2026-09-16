import { useRef } from 'react';
import { StyleSheet, type TextInput, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { ActionButton, ThemedText } from '@/ui/components';
import { Spacing } from '@/ui/theme';

import { AuthField } from './auth-field';

/**
 * EL FORMULARIO DE ENTRAR, como presentacion pura.
 *
 * Lo que aqui hay es exactamente lo que `sign-in.tsx` pintaba: cabecera, los
 * dos campos, el error, el boton principal y los enlaces. Lo que NO hay es
 * ninguna decision sobre como se autentica: los valores, el envio, el estado
 * ocupado y el error llegan por props, y quien monta el formulario decide que
 * significa «Entrar».
 *
 * **Por que se separa.** La pantalla de Entrar decide que significa «Entrar»
 * contra el Auth real; el formulario solo pinta. Un invitado no ve este
 * formulario dentro de su sesion —Inicio es «Crea tu cuenta» (`GuestSignUp`) y
 * entrar en otra cuenta exige cerrar sesion antes—, y el servicio falla
 * cerrado si algo lo intenta igualmente (F05/ADR-003 §4).
 *
 * `onGuest` es un hueco opcional: la pantalla de Entrar lo pasa (la sesion
 * anonima real, F05). Los proveedores externos (Apple, Google) son de F8.B:
 * hasta entonces no hay hueco para ellos.
 */
export type SignInFormProps = {
  readonly email: string;
  readonly password: string;
  readonly onEmailChange: (value: string) => void;
  readonly onPasswordChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly busy: boolean;
  /** Ya traducido; `undefined` cuando no hay nada que decir. */
  readonly error?: string;
  readonly onCreateAccount: () => void;
  readonly onForgotPassword: () => void;
  /** Un enlace gris, al nivel de «¿Has olvidado tu contrasena?». Ausente por defecto. */
  readonly onGuest?: () => void;
};

export function SignInForm({
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  busy,
  error,
  onCreateAccount,
  onForgotPassword,
  onGuest,
}: SignInFormProps) {
  const { t } = useTranslation();
  const passwordField = useRef<TextInput>(null);

  return (
    <>
      <View style={styles.heading}>
        <ThemedText variant="display">{t('auth.signInTitle')}</ThemedText>
        <ThemedText variant="body" themeColor="textSecondary">
          {t('auth.signInSubtitle')}
        </ThemedText>
      </View>

      <View style={styles.form}>
        <AuthField
          label={t('auth.email')}
          placeholder={t('auth.emailPlaceholder')}
          value={email}
          onChangeText={onEmailChange}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          // Makes "next" mean something. Moving focus from the keyboard
          // instead of tapping is also one fewer chance for the layout to
          // shift under the user's finger.
          onSubmitEditing={() => passwordField.current?.focus()}
          submitBehavior="submit"
        />
        <AuthField
          ref={passwordField}
          label={t('auth.password')}
          placeholder={t('auth.passwordPlaceholder')}
          value={password}
          onChangeText={onPasswordChange}
          editable={!busy}
          revealable
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />
      </View>

      {/*
       * The message is a live region so a screen reader announces a failed
       * attempt, which otherwise happens silently. It is text, never a colour
       * on its own.
       */}
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
        label={busy ? t('auth.working') : t('auth.signInAction')}
        onPress={onSubmit}
        tone="primary"
        disabled={busy}
        busy={busy}
      />

      <ThemedText
        variant="bodySmall"
        themeColor="accent"
        accessibilityRole="link"
        onPress={onCreateAccount}
        style={styles.switch}>
        {t('auth.toSignUp')}
      </ThemedText>

      {/*
       * Los enlaces grises, y en este orden: la puerta de invitado (si la hay)
       * y recuperar el acceso. Los dos con el color terciario: son salidas,
       * no una tercera y cuarta cosa que considerar.
       */}
      {onGuest === undefined ? null : (
        <ThemedText
          variant="bodySmall"
          themeColor="textTertiary"
          accessibilityRole="link"
          onPress={onGuest}
          style={styles.switch}>
          {t('auth.guestAction')}
        </ThemedText>
      )}

      <ThemedText
        variant="bodySmall"
        themeColor="textTertiary"
        accessibilityRole="link"
        onPress={onForgotPassword}
        style={styles.switch}>
        {t('auth.forgotAction')}
      </ThemedText>
    </>
  );
}

const styles = StyleSheet.create({
  heading: { gap: Spacing.xs },
  form: { gap: Spacing.md },
  switch: { textAlign: 'center', paddingVertical: Spacing.sm },
});
