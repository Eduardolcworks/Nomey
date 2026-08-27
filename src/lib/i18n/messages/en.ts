import type { MessageKey } from './es-ES';

/**
 * The English catalogue.
 *
 * Typed as a complete record of the Spanish keys, so adding a key to `es-ES`
 * without translating it here is a typecheck failure, not a string that
 * quietly ships in the wrong language.
 */
export const en: Record<MessageKey, string> = {
  'brand.signature': 'by LCWorks',

  'nav.home': 'Home',
  'nav.groups': 'Groups',
  'nav.notifications': 'Notifications',
  'nav.profile': 'Profile',

  'scope.personal': 'Personal',
  'scope.couple': 'Couple',
  'scope.label': 'Scope',
  'scope.switchTo': 'Switch to {scope}',

  'action.addTo': 'Add to {scope}',
  'action.addToGroups': 'Add to a group',
  'action.close': 'Close',
  'action.soon': 'Coming soon',
  'action.retry': 'Try again',

  'auth.signInTitle': 'Sign in',
  'auth.signInSubtitle': 'Welcome back.',
  'auth.signUpTitle': 'Create account',
  'auth.signUpSubtitle': 'Start putting your money in order.',
  'auth.name': 'Name',
  'auth.namePlaceholder': 'What should we call you',
  'auth.email': 'Email',
  'auth.emailPlaceholder': 'you@email.com',
  'auth.password': 'Password',
  'auth.passwordPlaceholder': 'Your password',
  'auth.signInAction': 'Sign in',
  'auth.signUpAction': 'Create account',
  'auth.toSignUp': 'No account yet? Create one',
  'auth.toSignIn': 'Already have an account? Sign in',
  'auth.working': 'One moment…',
  'auth.missingFields': 'Fill in every field.',

  'auth.checkEmailTitle': 'Check your email',
  'auth.checkEmailBody': 'We have sent a confirmation link to {email}.',
  'auth.checkEmailStep': 'Confirm it and come back here to sign in with your password.',
  'auth.checkEmailBack': 'Back to sign in',

  'authError.invalidCredentials': 'Wrong email or password.',
  'authError.emailNotConfirmed': 'You have not confirmed your email yet. Check your inbox.',
  'authError.accountUnavailable': 'This account is not available.',
  'authError.weakPassword': 'That password does not meet the requirements.',
  'authError.invalidEmail': 'That email does not look valid.',
  'authError.rateLimited': 'Too many attempts. Wait a moment.',
  'authError.signUpDisabled': 'Sign-up is not available right now.',
  'authError.checkYourEmail': 'Check your email to continue.',
  'authError.network': 'No connection. Try again.',
  'authError.generic': 'Something went wrong. Try again.',

  'session.unavailableTitle': 'We could not check your session',
  'session.unavailableBody': 'It may be the connection. Try again.',

  'home.greeting': 'Hi, {name}',
  'home.greetingPlain': 'Hi',
  'state.loading': 'Loading…',
  'state.errorTitle': 'Could not load',
  'state.errorBody': 'Give it another try in a moment.',
  'state.retry': 'Try again',

  'home.available': 'Available',
  'home.activity': 'Recent activity',
  'home.activityEmpty': 'No movements yet.',
  'home.activityHint': 'Use the add button to record the first one.',

  'groups.title': 'Groups',
  'groups.empty': 'You have no groups yet.',
  'groups.emptyHint': 'Trips, flatshares and shared expenses will show up here.',
  'groups.create': 'Create group',

  'notifications.empty': 'Nothing to see here.',
  'notifications.emptyHint': 'Alerts from your groups will show up here.',

  'profile.section': 'Settings',
  'profile.account': 'Account',
  'profile.language': 'Language',
  'profile.appearance': 'Appearance',
  'profile.diagnostics': 'Diagnostics',

  'dev.states': 'Common states',
  'dev.statesHint': 'Development only. For checking them on the device.',
  'dev.sessionProbe': 'Session probe',

  'probe.hint': 'Checks on the device what Vitest cannot check.',
  'probe.secureStore': 'SecureStore available',
  'probe.largeValue': 'Large value, round trip',
  'probe.cleared': 'Cleared completely',
  'probe.client': 'Supabase client created',
  'probe.session': 'The session answers without error',
  'probe.payload': 'Real session payload',
  'probe.run': 'Run',
  'probe.rerun': 'Run again',

  'foundation.caption': 'Visual foundation',
  'foundation.palette': 'Palette',
  'foundation.typography': 'Typography',
  'foundation.formatting': 'Formatting',
  'foundation.runtime': 'Intl on this device',

  'locale.label': 'Language',
  'locale.preference': 'Preference',
  'locale.automatic': 'Automatic',
  'locale.device': 'System language',
  'locale.region': 'System region',
  'locale.catalogue': 'Active catalogue',
  'locale.formatting': 'Regional formatting',

  'runtime.available': 'Available',
  'runtime.missing': 'Unavailable',
  'runtime.fallbackOk': 'Absent · fallback OK',
  'runtime.exactPath': 'Exact path: {path}',

  'sample.income': 'Income',
  'sample.expense': 'Expense',
  'sample.large': 'Large amount',
};
