import { forwardRef } from 'react';
import type { TextInput } from 'react-native';

import { useTranslation } from '@/lib/i18n';

import { AuthField, type AuthFieldProps } from './auth-field';
import { usernameProblem } from './credentials';

/**
 * The username as a form field (F12/ADR-001 §3), shared by «Crear cuenta» and
 * the guest's «CREA TU CUENTA».
 *
 * `@` is presentation: the placeholder shows it, typing it is tolerated, and
 * the stored form never has it. The hint under the field says the rule while
 * the value is fine and turns into the problem the moment it is not —
 * `invalid` and `reserved` are the SHARED syntax mirrored in `src/domain`, so
 * the form can say them before the round trip. «Taken» is never said here:
 * only the server knows, and it answers through the submit.
 *
 * Deliberately no lowercasing while typing: what the person typed stays on
 * screen; the normalized form is what gets sent.
 */
export type UsernameFieldProps = Omit<
  AuthFieldProps,
  | 'label'
  | 'placeholder'
  | 'hint'
  | 'autoCapitalize'
  | 'autoCorrect'
  | 'autoComplete'
  | 'textContentType'
> & {
  readonly value: string;
};

export const UsernameField = forwardRef<TextInput, UsernameFieldProps>(function UsernameField(
  { value, ...input },
  ref,
) {
  const { t } = useTranslation();
  const problem = value === '' ? null : usernameProblem(value);
  const hint =
    problem === 'invalid'
      ? t('authError.usernameInvalid')
      : problem === 'reserved'
        ? t('authError.usernameReserved')
        : t('auth.usernameHint');

  return (
    <AuthField
      ref={ref}
      label={t('auth.username')}
      placeholder={t('auth.usernamePlaceholder')}
      value={value}
      hint={hint}
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="username"
      textContentType="username"
      {...input}
    />
  );
});
