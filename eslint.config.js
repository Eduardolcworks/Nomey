// https://docs.expo.dev/guides/using-eslint/
const fs = require('node:fs');
const path = require('node:path');

const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');

/**
 * Architecture boundaries.
 *
 * Dependency direction is one-way:
 *
 *   app/  ->  features/  ->  domain/ + lib/ + ui/
 *
 * with lib/ allowed to use domain/, and domain/ depending on nothing.
 *
 * Enforced with import/no-restricted-paths, which resolves each import to the
 * file it actually points at. That matters: a rule based on import *strings*
 * (no-restricted-imports) only catches '@/lib/x' and is trivially bypassed by
 * writing '../lib/x'. These zones are location-based, so both spellings fail.
 *
 * import/no-restricted-paths ships with eslint-config-expo via
 * eslint-plugin-import, so this costs no extra dependency.
 */

const SRC = path.join(__dirname, 'src');

/** Layers that may not be imported by each layer, keyed by importing layer. */
const FORBIDDEN = {
  // The strictest layer: pure business rules, depends on nothing internal.
  domain: ['app', 'features', 'lib', 'ui'],
  // Design system: no screens, no features, no business rules, and no
  // infrastructure either - a component must not reach for supabase or env.
  ui: ['app', 'features', 'domain', 'lib'],
  // Infrastructure may use domain, but nothing above it.
  lib: ['app', 'features', 'ui'],
  // Features compose everything below them; routes depend on features, not the
  // reverse.
  features: ['app'],
};

const REASON = {
  domain:
    'src/domain must stay pure: no React, Expo, Supabase, network or upper layers. Move the impure part to lib/ or features/.',
  ui: 'src/ui is the design system: it must not know about screens, features, business rules or infrastructure.',
  lib: 'src/lib is infrastructure: it must not depend on features, screens or UI.',
  features: 'Features must not import from src/app (routes depend on features, not the reverse).',
};

const layerZones = Object.entries(FORBIDDEN).flatMap(([layer, forbidden]) =>
  forbidden.map((from) => ({
    target: path.join(SRC, layer),
    from: path.join(SRC, from),
    message: REASON[layer],
  })),
);

/**
 * Cross-feature isolation.
 *
 * Discovered from disk so the zones stay correct as features are added,
 * without anyone having to remember to edit this file. Each feature is barred
 * from every sibling while keeping its own internal imports legal.
 */
const featuresDir = path.join(SRC, 'features');
const featureNames = fs.existsSync(featuresDir)
  ? fs
      .readdirSync(featuresDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];

const featureZones = featureNames.map((name) => ({
  target: path.join(featuresDir, name),
  from: featuresDir,
  except: [`./${name}`],
  message:
    'No feature-to-feature imports. Use relative imports inside a feature; move anything shared down to domain/, lib/ or ui/.',
}));

const MONEY_PURITY =
  'No binary floating point in monetary arithmetic (ADR-003). Use bigint and the helpers in domain/money.';

const boundaries = [
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'import/no-restricted-paths': ['error', { zones: [...layerZones, ...featureZones] }],
    },
  },
  {
    // No binary floating point in monetary arithmetic. ADR-003 forbids number
    // for values of record, and the failure it prevents is silent: a wrong
    // amount that never throws. A lint rule makes it checkable instead of
    // declarative. Number.isInteger and friends stay legal - only the
    // conversions and the float helpers are banned.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='Number']",
          message: MONEY_PURITY,
        },
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: MONEY_PURITY,
        },
        {
          selector: "CallExpression[callee.name='parseInt']",
          message: MONEY_PURITY,
        },
        {
          selector:
            "MemberExpression[object.name='Math'][property.name=/^(round|floor|ceil|trunc|abs|pow)$/]",
          message: MONEY_PURITY,
        },
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message: MONEY_PURITY,
        },
      ],
    },
  },
  {
    // Package-level purity for domain/. no-restricted-paths only governs paths
    // inside the project, so external packages still need a string rule.
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-*',
                'react-native',
                'react-native/*',
                'expo',
                'expo-*',
                '@expo/*',
                '@supabase/*',
                // No disk, no network, no Node runtime. AGENTS.md is explicit
                // that domain/ touches neither, and 'node:fs' slipped through
                // the list above until an audit probe caught it.
                'node:*',
                'fs',
                'net',
                'http',
                'https',
                'child_process',
              ],
              message: REASON.domain,
            },
          ],
        },
      ],
    },
  },
];

module.exports = defineConfig([
  expoConfig,
  ...boundaries,
  // Must stay last: turns off stylistic rules that would fight Prettier.
  prettierConfig,
  {
    ignores: ['dist/*', 'node_modules/*', '.expo/*'],
  },
]);
