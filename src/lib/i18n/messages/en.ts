import type { MessageKey } from './es-ES';

/**
 * The English catalogue.
 *
 * Typed as a complete record of the Spanish keys, so adding a key to `es-ES`
 * without translating it here is a typecheck failure, not a string that
 * quietly ships in the wrong language.
 */
export const en: Record<MessageKey, string> = {
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
