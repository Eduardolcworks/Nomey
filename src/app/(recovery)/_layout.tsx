import { Stack } from 'expo-router';

import { Colors } from '@/ui/theme';

/**
 * The recovery branch: one screen, and no way to reach anything else.
 *
 * It is a group of its own rather than a screen inside `(auth)` because the
 * two are mounted under different session states. `(auth)` belongs to
 * `signed-out`; this belongs to `recovering`, which is a real Supabase session
 * that has not yet earned the product. Putting them together would mean one
 * guard covering two very different levels of trust.
 */
export default function RecoveryLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.dark.background },
      }}
    />
  );
}
