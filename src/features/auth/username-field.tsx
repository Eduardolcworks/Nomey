import { forwardRef } from 'react';
import type { TextInput } from 'react-native';

import { useTranslation } from '@/lib/i18n';

import { AuthField, type AuthFieldProps } from './auth-field';
import { usernameProblem } from './credentials';

/**
 * The username as a form field (F12/ADR-001 §3), shared by «Crear cuenta» and
 * the guest's «CREA TU CUENTA».
 *
 * **El `@` ya no aparece en ninguna parte y tampoco se acepta.** Ni en el
 * marcador, ni delante del campo: lo que se escribe es el nombre a secas
 * (`aitor`). Y si alguien escribe `@aitor`, el campo lo dice y no se envía —
 * `usernameProblem` devuelve `at`—. **No se normaliza en silencio**: quitarle
 * el `@` por su cuenta enseñaría que forma parte del nombre.
 *
 * El resto de la pista sigue igual: `invalid` y `reserved` son la sintaxis
 * COMPARTIDA reflejada en `src/domain`, así que el formulario puede decirlos
 * antes del viaje de ida y vuelta. «Ya está en uso» no se dice aquí: sólo lo
 * sabe el servidor, y contesta al enviar.
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
    problem === 'at'
      ? t('authError.usernameNoAtSign')
      : problem === 'invalid'
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
