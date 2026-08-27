import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { Colors } from '@/ui/theme';

/**
 * Root layout.
 *
 * Deliberately a bare Stack: the navigation architecture is F4.C, and putting
 * a provisional tab bar here now would be the thing that is expensive to undo.
 *
 * What it does own is the ground colour. `app.config.ts` paints the native
 * root view black, and `contentStyle` paints the navigator's own container the
 * same black, so a push or a pop cannot reveal a white card underneath.
 */
export default function RootLayout() {
  return (
    <>
      {/*
       * Fixed light, not "auto". The app is dark-only, so the status bar
       * content is always light-on-dark; "auto" would resolve from the scheme
       * and add a branch that can only go one way.
       */}
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.dark.background },
        }}
      />
    </>
  );
}
