import type { ExpoConfig } from 'expo/config';

/**
 * Nomey app configuration.
 *
 * Migrated from app.json to TypeScript so the config can branch on the
 * environment. The environment is selected with `APP_VARIANT`, and the three
 * variants, their identities and their update channels are fixed by
 * ADR-031 - `docs/adr/ADR-031-environments-and-variants.md`.
 *
 * Bundle identifiers are permanent once an app is published to the App Store
 * or Play Store. `es.lcworks.nomey` is reverse DNS of `lcworks.es`, a domain
 * Nomey's owner controls, and it is final; the `.dev` and `.staging` ones are
 * only a reinstall away from changing.
 */

/** The three environments of ADR-031 §1. There is no fourth. */
type VariantName = 'development' | 'staging' | 'production';

/**
 * What a variant is allowed to change.
 *
 * Read the field list as the contract it is: a variant may change **who the
 * binary is** and **which update channel it listens to**, and nothing else.
 * Product behaviour is identical in the three, which is why no branch of the
 * source code ever asks which environment it is running in - ADR-031 §2.
 */
type Variant = {
  readonly displayName: string;
  readonly bundleIdentifier: string;
  readonly scheme: string;
  readonly updatesEnabled: boolean;
  readonly channel: 'staging' | 'production' | null;
};

/**
 * Deep link schemes are split per variant like the bundle identifier.
 *
 * With a single shared scheme, a device holding two builds resolves `nomey://`
 * ambiguously and the OS picks a winner: a staging deep link can open
 * production, or the reverse. That is precisely the kind of bug that shows up
 * once and is never reproducible. Nomey's auth recovery arrives by deep link,
 * so the winner would be deciding which app receives a password reset.
 */
const VARIANTS: Readonly<Record<VariantName, Variant>> = {
  development: {
    displayName: 'Nomey Dev',
    bundleIdentifier: 'es.lcworks.nomey.dev',
    scheme: 'nomey-dev',
    // Development is served by Metro and must never fetch a published update:
    // a development binary listening on a channel would silently replace the
    // code under test with whatever was last published.
    updatesEnabled: false,
    channel: null,
  },
  staging: {
    displayName: 'Nomey Staging',
    bundleIdentifier: 'es.lcworks.nomey.staging',
    scheme: 'nomey-staging',
    updatesEnabled: true,
    channel: 'staging',
  },
  production: {
    displayName: 'Nomey',
    bundleIdentifier: 'es.lcworks.nomey',
    scheme: 'nomey',
    updatesEnabled: true,
    channel: 'production',
  },
};

const VARIANT_NAMES = Object.keys(VARIANTS) as readonly VariantName[];

/**
 * What an absent `APP_VARIANT` means, and why it is not production.
 *
 * A missing variable is the normal state of a shell that has just been opened,
 * of a fresh clone and of a CI job nobody configured. If that state resolved to
 * production, the accident would be silent in every one of them: the config
 * would carry the production identity and, once updates exist, the production
 * channel. Defaulting to `development` makes the same accident inert - the
 * artefact is `Nomey Dev`, it fetches nothing, and it is obvious on the device.
 *
 * Production is therefore reachable **only** by asking for it by name.
 */
const DEFAULT_VARIANT: VariantName = 'development';

function resolveVariant(raw: string | undefined): VariantName {
  const requested = (raw ?? '').trim();

  if (requested === '') {
    return DEFAULT_VARIANT;
  }

  // A typo must not fall back to anything. Resolving `stagin` to the default
  // would hand back a development identity to someone who believes they are
  // looking at staging, and the config would be internally consistent while
  // answering the wrong question.
  if (!VARIANT_NAMES.includes(requested as VariantName)) {
    throw new Error(
      `Nomey: APP_VARIANT="${requested}" is not a known variant. ` +
        `Use one of: ${VARIANT_NAMES.join(', ')}. ` +
        `Leaving it unset selects "${DEFAULT_VARIANT}"; production is never implicit. ` +
        `See docs/adr/ADR-031-environments-and-variants.md.`,
    );
  }

  return requested as VariantName;
}

const VARIANT = resolveVariant(process.env.APP_VARIANT);
const variant = VARIANTS[VARIANT];

/**
 * The EAS project, created as `@lcworks/nomey`.
 *
 * Neither value is a secret: the project id travels in every binary as part of
 * the update URL, and the account name is public. They are written out here
 * rather than read from the environment because they are properties of the
 * project, not of the machine building it - a build that resolved a different
 * project id would publish to somewhere else without saying so.
 */
const EAS_ACCOUNT = 'lcworks';
const EAS_PROJECT_ID = 'a5640f9f-b248-4fbe-8e9c-94ad9ed338a6';

/**
 * Nomey's ground colour, for the native chrome.
 *
 * It MUST equal `Colors.dark.background`. It is duplicated here rather than
 * imported because this file is transpiled and loaded as CommonJS by the Expo
 * config loader, which does not resolve a relative TypeScript import -
 * measured: `npx expo config` fails with "Cannot find module".
 *
 * A comment is not a guarantee, so the equality is asserted by
 * `tests/infra/brand-chrome.test.ts`. If the two drift apart, the native root
 * view and the first React frame paint different blacks and the seam shows on
 * every launch.
 */
const BACKGROUND_COLOR = '#000000';

/**
 * The app icon's ground, which is brand yellow and not the app's black.
 *
 * The primary brand variant is the yellow one, and an icon's job is to be
 * found on a crowded home screen - a black icon on a dark wallpaper is not.
 * This does not leak inward: inside the app the yellow stays a minority
 * accent over a black ground, and the splash uses the secondary variant so
 * the launch does not flash yellow before settling into a dark app.
 *
 * It MUST equal `Colors.dark.accent`, for the same reason and with the same
 * guard as `BACKGROUND_COLOR` above.
 */
const ICON_GROUND_COLOR = '#FDC506';

const config: ExpoConfig = {
  name: variant.displayName,
  slug: 'nomey',
  owner: EAS_ACCOUNT,

  /**
   * The application version, and the runtime it names.
   *
   * `runtimeVersion` uses the `appVersion` policy, so the runtime identity of a
   * binary is exactly this string. The consequence is the rule that matters:
   * **an update only reaches a binary whose runtime matches**, so any change to
   * the native side that the JavaScript depends on - a new module, a new
   * permission, an SDK upgrade - requires bumping `version` and shipping a new
   * binary. Publishing such a change to the old runtime would hand a binary
   * JavaScript that calls into native code it does not contain.
   *
   * The `fingerprint` policy computes that boundary automatically instead of
   * trusting a human to bump a string. It is deliberately not used while it is
   * still experimental: a wrong fingerprint is a silent mismatch, and this is
   * not the place to find out.
   */
  version: '1.0.0',
  runtimeVersion: { policy: 'appVersion' },

  orientation: 'portrait',
  icon: './assets/icons/icon.png',
  scheme: variant.scheme,

  /**
   * Nomey ships dark-only. Forcing it here means the OS, the native views and
   * React all start dark, instead of the app painting light chrome for a frame
   * before the theme resolves. A light theme is not blocked: it becomes
   * 'automatic' here plus one edit in `src/ui/theme/use-theme.ts`.
   *
   * https://docs.expo.dev/versions/v57.0.0/config/app/#userinterfacestyle
   */
  userInterfaceStyle: 'dark',

  /**
   * Root view background, behind every React view. It defaults to white, and
   * that white shows through between the splash disappearing and the first
   * frame painting.
   *
   * On iOS this requires `expo-system-ui`, which is installed. It cannot be
   * set at runtime - changing it needs a new native build.
   * https://docs.expo.dev/versions/v57.0.0/config/app/#backgroundcolor
   */
  backgroundColor: BACKGROUND_COLOR,

  // Nomey is a mobile-only product. Web is deliberately not a target.
  platforms: ['ios', 'android'],

  /**
   * EAS Update, and the channel each variant listens on.
   *
   * The channel is declared here rather than in a build profile because Nomey
   * does not use EAS Build: with a locally compiled binary, the only place the
   * channel can come from is `expo-channel-name` in the update request headers.
   *
   * `enabled` is false in development on purpose - see the variant table. The
   * URL is the same in all three because it identifies the project, not the
   * environment; what separates them is the channel.
   */
  updates: {
    enabled: variant.updatesEnabled,
    url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
    ...(variant.channel === null
      ? {}
      : { requestHeaders: { 'expo-channel-name': variant.channel } }),
  },

  ios: {
    bundleIdentifier: variant.bundleIdentifier,
    // No iOS binary exists yet, and it is set anyway: the App Store rejects an
    // upload whose build number is not greater than the previous one, and
    // starting at an explicit 1 makes the counter a decision rather than a
    // default discovered at submission time. Every later binary increments it.
    buildNumber: '1',
  },

  android: {
    package: variant.bundleIdentifier,
    // Same counter, same rule: Play refuses an APK whose versionCode is not
    // greater than one already uploaded. Every later binary increments it.
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: ICON_GROUND_COLOR,
      foregroundImage: './assets/icons/android-icon-foreground.png',
      monochromeImage: './assets/icons/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },

  plugins: [
    'expo-router',
    // Sets CFBundleAllowMixedLocalizations on iOS, without which the OS reports
    // only the app's development language and locale detection reads one value
    // for every device.
    'expo-localization',
    [
      'expo-splash-screen',
      {
        // Secondary variant on the app's own black: the launch settles into a
        // dark app, and coming from a full yellow screen would be a harsher
        // transition than the brand gains from it.
        backgroundColor: BACKGROUND_COLOR,
        image: './assets/splash/splash-icon.png',
        imageWidth: 120,
      },
    ],
    [
      /*
       * The session lives in SecureStore, and this plugin is what makes the
       * Android half of "this device only" true.
       *
       * `configureAndroidBackup` points `android:fullBackupContent` and
       * `android:dataExtractionRules` at the rules shipped by the module,
       * which exclude the SecureStore entries from Android Auto Backup and
       * from device-to-device transfer. Without it the refresh token is a
       * candidate for both. iOS gets the equivalent from the keychain
       * accessibility constant instead - see ADR-017.
       *
       * `faceIDPermission: false` deletes NSFaceIDUsageDescription rather than
       * accepting the module's default string. Nomey never passes
       * `requireAuthentication`, and shipping a Face ID purpose string for a
       * capability the binary does not use is a question at review time with
       * no answer.
       */
      'expo-secure-store',
      { configureAndroidBackup: true, faceIDPermission: false },
    ],
  ],

  extra: {
    eas: { projectId: EAS_PROJECT_ID },
  },

  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
