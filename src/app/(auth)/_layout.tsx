import { Stack } from 'expo-router';

import { Colors } from '@/ui/theme';

/**
 * The public branch.
 *
 * It has its own Stack so the root sees one screen, `(auth)`, and so F5.C has
 * somewhere to add sign-up and recovery without touching the root's guards.
 */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.dark.background },
      }}>
      <Stack.Screen name="sign-in" />
    </Stack>
  );
}
