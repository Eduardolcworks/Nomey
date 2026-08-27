import type { ExpoConfig } from 'expo/config';

/**
 * Nomey app configuration.
 *
 * Migrated from app.json to TypeScript so the config can branch on the
 * environment. Set APP_VARIANT=development to build the dev variant, which
 * uses a separate bundle identifier and can therefore be installed alongside
 * production on the same device.
 *
 * Bundle identifiers are permanent once an app is published to the App Store
 * or Play Store. They are provisional only until the first store submission.
 */
const IS_DEV = process.env.APP_VARIANT === 'development';

const BUNDLE_ID = IS_DEV ? 'es.lcworks.nomey.dev' : 'es.lcworks.nomey';

/**
 * Deep link scheme, split per variant like the bundle identifier.
 *
 * With a single shared scheme, a device holding both builds resolves
 * `nomey://` ambiguously and the OS picks a winner: a dev deep link can open
 * production, or the reverse. That is precisely the kind of bug that shows up
 * once and is never reproducible.
 */
const SCHEME = IS_DEV ? 'nomey-dev' : 'nomey';

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
  name: IS_DEV ? 'Nomey Dev' : 'Nomey',
  slug: 'nomey',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icons/icon.png',
  scheme: SCHEME,

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

  ios: {
    bundleIdentifier: BUNDLE_ID,
  },

  android: {
    package: BUNDLE_ID,
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

  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
