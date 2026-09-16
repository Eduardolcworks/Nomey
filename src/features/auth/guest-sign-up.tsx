import { useRef, useState } from 'react';
import { StyleSheet, type TextInput, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { ActionButton, Section, ThemedText } from '@/ui/components';
import { Spacing } from '@/ui/theme';

import { AuthField } from './auth-field';
import { convertGuest } from './auth-service';
import {
  missingFields,
  normaliseEmail,
  PASSWORD_MIN_LENGTH,
  registrationReady,
} from './credentials';
import { useAuthSubmit } from './use-auth-submit';

/**
 * «CREA TU CUENTA»: la ÚNICA vía de cuenta para un invitado.
 *
 * Inicio, para una sesión anónima, es esta pieza y nada más: nombre (precargado
 * con el que dio al entrar), email, contraseña y un botón amarillo. No es una
 * pantalla de login —sin «Entrar», sin recuperar, sin «Entrar como invitado»,
 * sin proveedores—: un invitado no entra en otra cuenta desde dentro de su
 * sesión; para eso cierra sesión y usa Entrar (F05/ADR-003 §4). Aquí convierte
 * al MISMO usuario anónimo en cuenta (`convertGuest` → `updateUser`, nunca
 * `signUp`), así que grupos, participantes, gastos, pagos, deudas e historia
 * siguen siendo suyos.
 *
 * Al enviar, el correo queda pendiente de confirmar y la sesión sigue siendo
 * de invitado hasta que el servidor lo diga: esta pieza muestra «Revisa tu
 * correo» en su sitio, sin navegar. Quién decide que ya no es invitado es el
 * ciclo de sesión, que pregunta al servidor (`getUser`) al restaurar, al
 * volver al primer plano y mientras la conversión siga pendiente, y refresca
 * la sesión cuando la respuesta es que ya hay cuenta; entonces esta pieza
 * desaparece con el estado.
 */
export function GuestSignUp({
  initialName,
  pendingEmail,
}: {
  readonly initialName: string | null;
  /**
   * The address the server is waiting to confirm (`new_email` on the stored
   * user), if any: «check your email» survives a reload. Presentation only —
   * whether this is still a guest is decided by the session state, which the
   * lifecycle refreshes from the server, and this piece unmounts with it.
   */
  readonly pendingEmail: string | null;
}) {
  const { t } = useTranslation();
  const { state, submit, clearError, running } = useAuthSubmit();

  const [displayName, setDisplayName] = useState(initialName ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [incomplete, setIncomplete] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(pendingEmail);

  const emailField = useRef<TextInput>(null);
  const passwordField = useRef<TextInput>(null);

  /*
   * THE BUTTON SAYS WHETHER THE FORM CAN BE SENT. Grey while a field is
   * missing or the password is under the server's minimum; yellow once name,
   * email and password satisfy the rules Nomey can state up front
   * (`registrationReady`). The keyboard's «go» respects the same rule.
   */
  const ready = registrationReady({ displayName, email, password });

  async function onSubmit() {
    if (!ready) return;
    const missing = missingFields({ displayName, email, password });
    setIncomplete(missing.length > 0);
    if (missing.length > 0) return;

    clearError();
    const result = await submit(() => convertGuest({ displayName, email, password }));
    // Only a conversion that is now WAITING shows «check your email»; one the
    // server had already confirmed refreshes the session and this unmounts.
    if (result?.ok === true && 'pendingConfirmation' in result) setSentTo(normaliseEmail(email));
  }

  if (sentTo !== null) {
    return (
      <View style={styles.stack}>
        <View style={styles.heading}>
          <ThemedText variant="display">{t('auth.checkEmailTitle')}</ThemedText>
          <ThemedText variant="body" themeColor="textSecondary">
            {t('auth.checkEmailBody', { email: sentTo })}
          </ThemedText>
        </View>
        <Section title={t('auth.checkEmailTitle')}>
          <ThemedText variant="body" themeColor="textSecondary">
            {t('auth.guestCheckEmailStep')}
          </ThemedText>
        </Section>
      </View>
    );
  }

  const error =
    state.status === 'failed'
      ? t(state.messageKey)
      : incomplete
        ? t('auth.missingFields')
        : undefined;

  return (
    <View style={styles.stack}>
      <View style={styles.heading}>
        <ThemedText variant="display">{t('auth.guestSignUpTitle')}</ThemedText>
        {/* La misma pareja titulo/subtitulo que Entrar: cuerpo, secundario, pegado al titulo. */}
        <ThemedText variant="body" themeColor="textSecondary">
          {t('auth.guestSignUpSubtitle')}
        </ThemedText>
      </View>

      <View style={styles.form}>
        <AuthField
          label={t('auth.name')}
          placeholder={t('auth.namePlaceholder')}
          value={displayName}
          onChangeText={setDisplayName}
          editable={!running}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          onSubmitEditing={() => emailField.current?.focus()}
          submitBehavior="submit"
        />
        <AuthField
          ref={emailField}
          label={t('auth.email')}
          placeholder={t('auth.emailPlaceholder')}
          value={email}
          onChangeText={setEmail}
          editable={!running}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordField.current?.focus()}
          submitBehavior="submit"
        />
        <AuthField
          ref={passwordField}
          label={t('auth.password')}
          placeholder={t('auth.passwordPlaceholder')}
          value={password}
          onChangeText={setPassword}
          editable={!running}
          // El ojo de Entrar, tal cual: oculta de partida y el boton alterna
          // (`field-appearance`). Aqui se pide expresamente, como alli.
          revealable
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void onSubmit()}
          hint={t('auth.passwordMinimum', { count: PASSWORD_MIN_LENGTH })}
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

      {/*
       * `brand`, no `primary`: `primary` es la superficie neutra elevada (gris),
       * y este es EL amarillo de la app. Deshabilitado se pinta gris y apagado;
       * en cuanto `ready`, amarillo (`action-button-style`).
       */}
      <ActionButton
        label={running ? t('auth.working') : t('auth.signUpAction')}
        onPress={() => void onSubmit()}
        tone="brand"
        disabled={running || !ready}
        busy={running}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.lg },
  heading: { gap: Spacing.xs },
  form: { gap: Spacing.md },
});
