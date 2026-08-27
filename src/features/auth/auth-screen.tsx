import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedView } from '@/ui/components';
import { Spacing } from '@/ui/theme';

/**
 * The scaffold both auth screens sit in, and the fix for the keyboard jitter.
 *
 * WHAT WAS WRONG. The previous version had two systems moving the same
 * content vertically, each one's output feeding the other's input:
 *
 * 1. `KeyboardAvoidingView behavior="padding"` shrank the container in JS and
 *    animated the change with `LayoutAnimation`.
 * 2. The scroll content was `flexGrow: 1` + `justifyContent: 'center'`, so
 *    every field's position was a function of the container height. Shrinking
 *    the container moved the fields.
 * 3. The scroll view then moved again to keep the focused field visible.
 * 4. Because (1) animates, the measurements feeding (2) and (3) arrived
 *    mid-animation, and the whole thing went round again.
 *
 * And an amplifier that made it worse rather than caused it: `SafeAreaView`
 * with no `edges` applies all four, so the container's bottom sat 34pt above
 * the screen. `KeyboardAvoidingView` compares its own frame against the
 * keyboard in SCREEN coordinates, so it over-padded by exactly that inset -
 * which is what `keyboardVerticalOffset` exists to correct, and it was not
 * set.
 *
 * WHAT IT DOES NOW. It removes machinery rather than adding more:
 *
 * - **No `KeyboardAvoidingView`.** `automaticallyAdjustKeyboardInsets` is a
 *   native `UIScrollView` contentInset adjustment. It changes an inset, not a
 *   layout, so there is no JS measure/animate round trip to feed back. On
 *   Android the same job is done by `windowSoftInputMode`, which Expo sets to
 *   resize - which is why nothing platform-specific is needed here.
 * - **No centring.** Field positions no longer depend on the container height,
 *   which is what closed the loop. Top-aligned is also better with a keyboard
 *   up on a small phone: a centred form gets pushed into what is left.
 * - **`edges` without `bottom`.** The bottom is the scroll view's business
 *   now, and the inset is added to the content instead, so nothing
 *   double-counts.
 *
 * `keyboardShouldPersistTaps="handled"` stays and has a real reason: without
 * it the first tap on another field while the keyboard is open is swallowed by
 * the dismissal, so moving between fields takes two taps. That is one of the
 * symptoms this is fixing.
 *
 * `keyboardDismissMode="on-drag"` is gone. On a form this short, scrolling
 * usually means reaching for a field, and closing the keyboard mid-reach is
 * the opposite of what was wanted. Tapping outside a field still dismisses.
 */
export function AuthScreen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            // The bottom inset is content padding rather than a container
            // edge, so the last control clears the home indicator without
            // giving anything a second inset to measure against.
            { paddingBottom: insets.bottom + Spacing.xxl },
          ]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets>
          {children}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xxl,
    gap: Spacing.lg,
  },
});
