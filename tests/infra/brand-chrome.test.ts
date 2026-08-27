import { describe, expect, it } from 'vitest';

import APP_CONFIG from '../../app.config.ts?raw';
import { Colors } from '../../src/ui/theme/colors';

/**
 * Native chrome and the theme must agree on Nomey's two brand colours.
 *
 * `app.config.ts` cannot import the theme: the Expo config loader transpiles it
 * to CommonJS and does not resolve a relative TypeScript import - measured,
 * `npx expo config` fails with "Cannot find module". So the hexes are
 * necessarily restated there, and this test is what keeps the restatement
 * honest.
 *
 * What it prevents is specific and easy to reintroduce: the native root view,
 * the splash and the first React frame each paint their own black, and the
 * seam shows as a flash or a band on every launch. It is the kind of defect
 * that is obvious on a device and invisible in a diff.
 *
 * Read as text rather than imported, like `exposed-schemas.test.ts`: importing
 * the config would drag Expo's ambient types into this project, and checking
 * the source also proves the colours are not restated inline at each use.
 */

const GROUND = Colors.dark.background;
const ICON_GROUND = Colors.dark.accent;

/** The body of a `key: { ... }` block, for asserting what it paints with. */
function block(open: string): string {
  const start = APP_CONFIG.indexOf(open);
  expect(start, `app.config.ts must contain ${open}`).toBeGreaterThan(-1);
  return APP_CONFIG.slice(start, APP_CONFIG.indexOf('},', start));
}

describe('native chrome agrees with the theme', () => {
  it('declares the ground colour once, as the theme background', () => {
    const declared = APP_CONFIG.match(/^const BACKGROUND_COLOR = '(#[0-9A-Fa-f]{6})';$/m);

    expect(declared, 'app.config.ts must declare a single BACKGROUND_COLOR').not.toBeNull();
    expect(declared?.[1]).toBe(GROUND);
  });

  it("declares the icon's ground once, as the theme accent", () => {
    const declared = APP_CONFIG.match(/^const ICON_GROUND_COLOR = '(#[0-9A-Fa-f]{6})';$/m);

    expect(declared, 'app.config.ts must declare a single ICON_GROUND_COLOR').not.toBeNull();
    expect(declared?.[1]).toBe(ICON_GROUND);
  });

  it('holds no other colour literal, so nothing is painted from a stray hex', () => {
    expect(APP_CONFIG.match(/'#[0-9A-Fa-f]{6}'/g)).toHaveLength(2);
  });

  it('paints the root view with the ground colour', () => {
    expect(APP_CONFIG).toMatch(/^ {2}backgroundColor: BACKGROUND_COLOR,$/m);
  });

  it('paints the splash screen with the ground colour, not the accent', () => {
    expect(block("'expo-splash-screen',")).toMatch(/backgroundColor: BACKGROUND_COLOR,/);
  });

  it("paints the Android adaptive icon with the icon's ground", () => {
    expect(block('adaptiveIcon: {')).toMatch(/backgroundColor: ICON_GROUND_COLOR,/);
  });

  it('forces the dark appearance, because Nomey ships dark-only', () => {
    expect(APP_CONFIG).toMatch(/^ {2}userInterfaceStyle: 'dark',$/m);
  });
});
