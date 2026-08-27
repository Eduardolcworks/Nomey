export { AuthField, type AuthFieldProps } from './auth-field';
export { signInErrorKey, signUpErrorKey, type AuthErrorKey, type AuthFailure } from './auth-errors';
export { signIn, signUp, type AuthResult } from './auth-service';
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
