export { AccountAvatar } from './account-avatar';
export { AuthField, type AuthFieldProps } from './auth-field';
export { AuthScreen } from './auth-screen';
export {
  signInErrorKey,
  signOutErrorKey,
  signUpErrorKey,
  updateUserErrorKey,
  type AuthErrorKey,
  type AuthFailure,
} from './auth-errors';
export {
  forgetLocalSession,
  signIn,
  signOut,
  signUp,
  updateDisplayName,
  type AuthResult,
} from './auth-service';
export { initialsFrom } from './display-name';
export { DisplayNameEditor } from './display-name-editor';
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
