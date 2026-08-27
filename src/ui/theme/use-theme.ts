import { Colors } from './colors';

/**
 * Nomey ships dark-only.
 *
 * `app.config.ts` pins `userInterfaceStyle: 'dark'`, so the device scheme is
 * already forced before React sees it and reading `useColorScheme()` here
 * would add a branch that can only ever resolve one way. Rather than keep a
 * read whose result is fixed, the resolution is stated once, here.
 *
 * This hook exists so that the day a light theme ships - device scheme, or a
 * stored user preference, or both - it is this function that changes and
 * nothing else. No screen and no component reads a palette directly.
 *
 * https://docs.expo.dev/versions/v57.0.0/config/app/#userinterfacestyle
 */
const ActiveScheme = 'dark' as const;

export function useTheme() {
  return Colors[ActiveScheme];
}
