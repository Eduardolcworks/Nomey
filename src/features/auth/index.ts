export { AccountAvatar } from './account-avatar';
export { AuthField, type AuthFieldProps } from './auth-field';
export { AuthScreen } from './auth-screen';
export {
  recoveryErrorKey,
  recoveryFailure,
  recoverySaveFailure,
  signInErrorKey,
  signOutErrorKey,
  signUpErrorKey,
  updateUserErrorKey,
  usernameRpcErrorKey,
  type AuthErrorKey,
  type AuthFailure,
  type RecoveryErrorTitleKey,
  type RecoveryFailure,
  type RecoverySaveFailure,
} from './auth-errors';
export {
  completeRecovery,
  convertGuest,
  forgetLocalSession,
  redeemRecovery,
  requestPasswordReset,
  signIn,
  signInAnonymously,
  signOut,
  signUp,
  updateDisplayName,
  type AuthResult,
  type RecoveryCompletion,
  type RecoveryRedemption,
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
  normaliseUsername,
  passwordProblem,
  usernameProblem,
  type Credentials,
  type PasswordProblem,
  type Registration,
} from './credentials';
export { createExclusiveRunner, SKIPPED, type ExclusiveRunner } from './submit-guard';
export { useAuthSubmit, type SubmitState } from './use-auth-submit';
export { RecoveryProvider, useRecovery } from './recovery-controller';
export {
  isRecoveryActive,
  RECOVERY_IDLE,
  type RecoveryState,
  type RedeemOutcome,
} from './recovery-state';
export { createRecoveryArrivalHandler, type RecoveryArrivalPorts } from './recovery-arrival';
export { readRecoveryLink, type RecoveryProof } from './recovery-link';
export { useRecoveryLink } from './use-recovery-link';
export { SignInForm, type SignInFormProps } from './sign-in-form';
export { GuestSignUp } from './guest-sign-up';
export { reserveUsername, type ReservationResult } from './username-reservation';
export { UsernameField, type UsernameFieldProps } from './username-field';
export {
  calendarDayOf,
  canChangeUsername,
  identityFromRow,
  IDENTITY_IDLE,
  IDENTITY_REQUIRED,
  IDENTITY_UNAVAILABLE,
  isIdentityPending,
  canEnterApp,
  needsUsernameGate,
  type AccountIdentity,
  type AccountIdentityRow,
  type IdentityState,
} from './identity-state';
export {
  changeUsername,
  chooseUsername,
  claimUsername,
  updatePublicName,
  type IdentityResult,
  type PublicNameResult,
} from './identity-service';
export {
  AccountIdentityProvider,
  IDENTITY_WATCHDOG_MS,
  useAccountIdentity,
} from './use-account-identity';
export { UsernameGate } from './username-gate';
export { UsernameEditor } from './username-editor';
export { onIdentityWake, wakeIdentity } from './identity-wake';
export {
  IDENTITY_CACHE_KEY,
  parseIdentity,
  recallIdentity,
  rememberIdentity,
  serializeIdentity,
} from './identity-cache';
