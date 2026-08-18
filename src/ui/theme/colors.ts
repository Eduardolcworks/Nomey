/**
 * Nomey colour tokens.
 *
 * PROVISIONAL. Nomey's identity is black and yellow, but the exact brand
 * palette has not been supplied yet. The accent below is a placeholder and is
 * expected to change; everything else is a neutral scale that should survive.
 *
 * Rule: components must never hardcode hex values. Read from here via
 * useTheme() so dark mode and future rebranding stay a single edit.
 */

export const Colors = {
  light: {
    text: '#0A0A0A',
    textSecondary: '#60646C',
    background: '#FFFFFF',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    border: '#D8D9DE',

    /** Brand accent - PLACEHOLDER pending the real Nomey yellow. */
    accent: '#FFC700',
    onAccent: '#0A0A0A',

    /**
     * Financial semantics. Money in / money out.
     *
     * Colour must NEVER be the only signal: roughly 1 in 12 men has some form
     * of colour vision deficiency, and red/green is the worst possible pair.
     * Always pair with a sign (+/-), an icon or a label.
     */
    positive: '#1A7F4B',
    negative: '#C62828',
  },
  dark: {
    text: '#FFFFFF',
    textSecondary: '#B0B4BA',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    border: '#3A3D42',

    accent: '#FFD426',
    onAccent: '#0A0A0A',

    positive: '#4ADE80',
    negative: '#F87171',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
