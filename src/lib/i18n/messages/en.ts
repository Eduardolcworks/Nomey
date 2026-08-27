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

  'auth.welcomeTitle': 'Nomey',
  'auth.welcomeBody': 'Your money and the shared kind, in one place.',
  'auth.comingSoon': 'Access',
  'auth.comingSoonHint': 'Signing in and creating an account arrive in the next block.',

  'session.unavailableTitle': 'We could not check your session',
  'session.unavailableBody': 'It may be the connection. Try again.',

  'home.greeting': 'Hi, {name}',
  'home.namePlaceholder': 'your name',
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
  'probe.session': 'With no session, answers empty',
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
