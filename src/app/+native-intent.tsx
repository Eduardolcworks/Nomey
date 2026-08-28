import { RECOVERY_PATH } from '@/features/auth/recovery-link';

/**
 * Where an incoming URL stops being the router's business.
 *
 * `/auth/recovery` is an AUTHENTICATION INTENT, not a screen. There is no route
 * file for it and there must not be: the link carries a single-use proof that
 * `features/auth` redeems, and a screen would mean the proof reaching
 * navigation state.
 *
 * Without this, both things happened at once. Expo Router installs its own
 * `Linking` listener alongside ours - measured in
 * `expo-router/build/link/linking.js` - so a recovery link reached our handler,
 * which correctly refused it and showed the notice, AND reached the router,
 * which tried to navigate to a path with no route behind it and rendered
 * "Unmatched Route". Two subscribers, one URL, one of them with no business
 * being there.
 *
 * Returning a falsy value is the documented way to say so: the type's own
 * comment reads "When a falsy value is returned (for example, `null`), no
 * redirection occurs and the app stays on the current path."
 *
 * **This does not take the URL away from anyone.** `redirectSystemPath` only
 * decides what the ROUTER does with a path it was handed; it never touches the
 * native module. `Linking.getInitialURL()` still reports the launch URL and the
 * `url` event still reaches every other subscriber, so `useRecoveryLink`
 * remains the sole owner of the intent in both a cold start and a running app.
 *
 * **No authentication logic lives here, deliberately.** It does not know what a
 * session is, never sees the token - the query string is discarded before the
 * comparison - and cannot redeem anything. It answers one question: is this
 * path a screen? Everything else is returned untouched so the router keeps its
 * ordinary behaviour.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  try {
    /*
     * The query is dropped first, so the token cannot participate in the
     * decision or be read here even by accident. What arrives is a full URL -
     * `nomey-dev://auth/recovery?…` from a build, `exp://<host>/--/auth/recovery?…`
     * from Expo Go - so the path is compared by suffix, which both forms share.
     */
    const withoutQuery = path.split('?')[0].replace(/\/+$/, '');
    if (withoutQuery.endsWith(RECOVERY_PATH)) return null;
  } catch {
    // The type's own note warns that throwing here can crash the app. Anything
    // unparseable is simply not our intent, and the router should carry on.
  }

  return path;
}
