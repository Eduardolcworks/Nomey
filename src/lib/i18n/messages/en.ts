import type { MessageKey } from './es-ES';

/**
 * The English catalogue.
 *
 * Typed as a complete record of the Spanish keys, so adding a key to `es-ES`
 * without translating it here is a typecheck failure, not a string that
 * quietly ships in the wrong language.
 */
export const en: Record<MessageKey, string> = {
  'nav.home': 'Home',
  'nav.groups': 'Groups',
  'nav.notifications': 'Notifications',
  'nav.profile': 'Profile',

  'scope.personal': 'Personal',
  'scope.couple': 'Couple',
  'scope.label': 'Scope',

  'action.addTo': 'Add to {scope}',
  'action.addToGroups': 'Add to a group',
  'action.close': 'Close',
  'action.soon': 'Coming soon',

  'home.available': 'Available',
  'home.activity': 'Recent activity',
  'home.activityEmpty': 'No movements yet.',
  'home.activityHint': 'Use the add button to record the first one.',

  'groups.title': 'Groups',
  'groups.empty': 'You have no groups yet.',
  'groups.emptyHint': 'Trips, flatshares and shared expenses will show up here.',
  'groups.create': 'Create group',

  'notifications.empty': 'Nothing to see here.',

  'profile.account': 'Account',
  'profile.language': 'Language',
  'profile.appearance': 'Appearance',
  'profile.diagnostics': 'Diagnostics',

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
