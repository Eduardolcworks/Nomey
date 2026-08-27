export { AuthField, type AuthFieldProps } from './auth-field';
export { AuthScreen } from './auth-screen';
export {
  signInErrorKey,
  signOutErrorKey,
  signUpErrorKey,
  type AuthErrorKey,
  type AuthFailure,
} from './auth-errors';
export { forgetLocalSession, signIn, signOut, signUp, type AuthResult } from './auth-service';
export {
  buildSignOutConfirmation,
  type Confirmation,
  type ConfirmationButton,
  type ConfirmationRole,
  type SignOutConfirmationLabels,
} from './sign-out-confirmation';
export {
  missingFields,
  normaliseCredentials,
  normaliseDisplayName,
  normaliseEmail,
  normaliseRegistration,
  type Credentials,
  type Registration,
} from './credentials';
export { createExclusiveRunner, SKIPPED, type ExclusiveRunner } from './submit-guard';
export { useAuthSubmit, type SubmitState } from './use-auth-submit';
