import { describe, expect, it } from 'vitest';

import APP_CONFIG from '../../app.config.ts?raw';
import { Colors } from '../../src/ui/theme/colors';

/**
 * Native chrome and the theme must agree on Nomey's ground colour.
 *
 * `app.config.ts` cannot import the theme: the Expo config loader transpiles it
 * to CommonJS and does not resolve a relative TypeScript import - measured,
 * `npx expo config` fails with "Cannot find module". So the hex is necessarily
 * restated there, and this test is what keeps the restatement honest.
 *
 * What it prevents is specific and easy to reintroduce: the native root view,
 * the splash and the first React frame each paint their own black, and the
 * seam shows as a flash or a band on every launch. It is the kind of defect
 * that is obvious on a device and invisible in a diff.
 *
 * Read as text rather than imported, like `exposed-schemas.test.ts`: importing
 * the config would drag Expo's ambient types into this project, and checking
 * the source also proves the colour is not restated inline at each use.
 */

const GROUND = Colors.dark.background;

/** Every native surface that must start on the ground colour. */
const CONSUMERS = [
  ['root view', /^\s*backgroundColor: BACKGROUND_COLOR,$/m],
  ['Android adaptive icon', /adaptiveIcon: \{\s*\n\s*backgroundColor: BACKGROUND_COLOR,/],
  ['splash screen', /'expo-splash-screen',\s*\n\s*\{\s*\n\s*backgroundColor: BACKGROUND_COLOR,/],
] as const;

describe('native chrome agrees with the theme', () => {
  it('declares the ground colour exactly once, as the theme background', () => {
    const declaration = APP_CONFIG.match(/^const BACKGROUND_COLOR = '(#[0-9A-Fa-f]{6})';$/m);

    expect(declaration, 'app.config.ts must declare a single BACKGROUND_COLOR').not.toBeNull();
    expect(declaration?.[1]).toBe(GROUND);
  });

  it.each(CONSUMERS)('paints the %s from that single declaration', (_surface, pattern) => {
    expect(APP_CONFIG).toMatch(pattern);
  });

  it('forces the dark appearance, because Nomey ships dark-only', () => {
    expect(APP_CONFIG).toMatch(/^\s*userInterfaceStyle: 'dark',$/m);
  });
});
