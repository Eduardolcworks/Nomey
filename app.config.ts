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

// Placeholder brand colours. Nomey's identity is black and yellow; the exact
// palette is pending. Icon and splash artwork are still the Expo template's.
const BACKGROUND_COLOR = '#000000';

const config: ExpoConfig = {
  name: IS_DEV ? 'Nomey Dev' : 'Nomey',
  slug: 'nomey',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icons/icon.png',
  scheme: SCHEME,
  userInterfaceStyle: 'automatic',

  // Nomey is a mobile-only product. Web is deliberately not a target.
  platforms: ['ios', 'android'],

  ios: {
    bundleIdentifier: BUNDLE_ID,
  },

  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: BACKGROUND_COLOR,
      foregroundImage: './assets/icons/android-icon-foreground.png',
      backgroundImage: './assets/icons/android-icon-background.png',
      monochromeImage: './assets/icons/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },

  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: BACKGROUND_COLOR,
        image: './assets/splash/splash-icon.png',
        imageWidth: 76,
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
