/**
 * The shape of "are you sure?", built as data instead of fired as a side
 * effect.
 *
 * Signing out is one tap away from a screen the user reached by browsing, and
 * an accidental one costs them their typed password to get back. So it is
 * confirmed. What is NOT built here is a dialog system: there is exactly one
 * consumer, and a general-purpose overlay stack invented for a single caller
 * is a second navigation model nobody asked for.
 *
 * React Native's own `Alert` is the right primitive - it is native on both
 * platforms, it is already modal, it already handles the back button, and it
 * costs no dependency. But `Alert.alert` cannot be asserted on without a
 * renderer, and none is installed. So this module decides the CONTENT and the
 * ORDER, which is the part with rules in it, and the screen does nothing but
 * hand the result to `Alert`.
 *
 * The rules, all testable:
 *
 * - Cancel comes first and is the cancel role, so an accidental dismissal -
 *   tapping outside, the hardware back button - resolves to staying signed in.
 * - The confirming button is the destructive role. Destructive is the platform
 *   convention for "this ends something", and it is a role rather than a
 *   colour: the label still says what happens, so the meaning does not depend
 *   on seeing red.
 * - Only the confirming button carries a handler. Cancel does nothing at all,
 *   which is the correct amount of work for cancel.
 */

export type ConfirmationRole = 'cancel' | 'destructive';

export type ConfirmationButton = {
  readonly label: string;
  readonly role: ConfirmationRole;
  /** Present only on the button that actually does something. */
  readonly onPress?: () => void;
};

export type Confirmation = {
  readonly title: string;
  readonly body: string;
  readonly buttons: readonly ConfirmationButton[];
};

export type SignOutConfirmationLabels = {
  readonly title: string;
  readonly body: string;
  readonly cancel: string;
  readonly confirm: string;
};

export function buildSignOutConfirmation(
  labels: SignOutConfirmationLabels,
  onConfirm: () => void,
): Confirmation {
  return {
    title: labels.title,
    body: labels.body,
    buttons: [
      { label: labels.cancel, role: 'cancel' },
      { label: labels.confirm, role: 'destructive', onPress: onConfirm },
    ],
  };
}
