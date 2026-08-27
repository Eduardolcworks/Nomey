import type { SFSymbol } from 'expo-symbols';

import type { MessageKey } from '@/lib/i18n';

/**
 * The two root destinations, and the only place they are listed.
 *
 * Reordering them, renaming their labels or changing their icons is an edit to
 * this array. Adding or removing one is this array plus a route file. Neither
 * touches the bar, the screens or the router - which is what "the navigation
 * is provisional" has to mean in practice, since it will be judged on a device
 * and probably changed.
 */
export interface Destination {
  /** The route file inside the `(tabs)` group. */
  readonly route: 'index' | 'groups';
  readonly label: MessageKey;
  readonly symbol: SFSymbol;
}

export const DESTINATIONS: readonly Destination[] = [
  { route: 'index', label: 'nav.home', symbol: 'house' },
  { route: 'groups', label: 'nav.groups', symbol: 'person.2' },
];

/** Which world the action button is adding to, from the active route name. */
export function destinationFor(routeName: string): 'home' | 'groups' {
  return routeName === 'groups' ? 'groups' : 'home';
}
