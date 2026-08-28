export { AccountAvatar } from './account-avatar';
export { AuthField, type AuthFieldProps } from './auth-field';
export { AuthScreen } from './auth-screen';
export {
  recoveryErrorKey,
  recoveryFailure,
  recoveryPasswordErrorKey,
  signInErrorKey,
  signOutErrorKey,
  signUpErrorKey,
  updateUserErrorKey,
  type AuthErrorKey,
  type AuthFailure,
  type RecoveryErrorTitleKey,
  type RecoveryFailure,
} from './auth-errors';
export {
  completeRecovery,
  forgetLocalSession,
  redeemRecovery,
  requestPasswordReset,
  signIn,
  signOut,
  signUp,
  updateDisplayName,
  type AuthResult,
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
  passwordProblem,
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
