import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ScopeProvider } from '@/features/shell';
import { Colors } from '@/ui/theme';

/**
 * Root layout.
 *
 * A Stack over the tab group, which is what lets the surfaces that are not
 * destinations behave correctly: `add` is presented as a sheet because it is a
 * task the user starts and finishes, while notifications and profile are
 * pushed because they are places with content and a back affordance.
 *
 * `ScopeProvider` sits above the tabs on purpose. Personal and Pareja are two
 * different sets of books, not two filters, so the choice has to survive going
 * to Grupos and coming back.
 *
 * The ground colour is painted here as well as natively, so a push or a
 * dismissal never reveals a white card underneath.
 */
export default function RootLayout() {
  return (
    <ScopeProvider>
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
        }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="add" options={{ presentation: 'modal' }} />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="diagnostics" />
      </Stack>
    </ScopeProvider>
  );
}
