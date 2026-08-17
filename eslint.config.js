// https://docs.expo.dev/guides/using-eslint/
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
 * Never the reverse, and never feature -> feature. If two features need the
 * same thing, it moves down into domain/ (business rules), lib/
 * (infrastructure) or ui/ (presentation).
 *
 * domain/ is the strictest layer: pure business logic with no React, no Expo,
 * no Supabase and no network. That is what makes the money, split, balance and
 * settlement rules exhaustively testable in milliseconds.
 *
 * Implemented with the core no-restricted-imports rule so this costs no extra
 * dependency. Within a feature, use relative imports ('./', '../').
 */
const boundaries = [
  {
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
                '@/app/*',
                '@/features/*',
                '@/lib/*',
                '@/ui/*',
              ],
              message:
                'src/domain must stay pure: no React, Expo, Supabase, network or upper layers. Move the impure part to lib/ or features/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/app/*', '@/features/*', '@/domain/*'],
              message:
                'src/ui is the design system: it must not know about screens, features or business rules.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/app/*', '@/features/*', '@/ui/*'],
              message: 'src/lib is infrastructure: it must not depend on features, screens or UI.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*'],
              message:
                'No feature-to-feature imports. Use relative imports inside a feature; move anything shared down to domain/, lib/ or ui/.',
            },
            {
              group: ['@/app/*'],
              message:
                'Features must not import from src/app (routes depend on features, not the reverse).',
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
