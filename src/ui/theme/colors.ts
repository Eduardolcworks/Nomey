/**
 * Nomey colour tokens.
 *
 * Nomey is dark-first. `dark` is the shipped experience and the only palette
 * validated for contrast; `light` is kept as scaffolding so a future light
 * theme is not blocked, but it has NOT been designed or measured and no screen
 * is validated against it. Do not treat it as a second supported experience.
 *
 * Rule: components never hardcode a colour. They read from here via
 * useTheme(), so a rebrand or a light theme stays a single edit.
 *
 * Measured contrast (WCAG 2.1, sRGB) of the dark palette:
 *
 *   text / background .................. 21.0 : 1   AAA
 *   text / surfaceRaised ............... 18.3 : 1   AAA
 *   textSecondary / surfaceRaised ....... 7.7 : 1   AAA
 *   textTertiary / surfaceRaised ........ 5.3 : 1   AA
 *   accent / background ................ 13.2 : 1   AAA
 *   onAccent / accent (primary button) . 12.4 : 1   AAA
 *   positive / surfaceRaised ............ 9.2 : 1   AAA
 *   negative / surfaceRaised ............ 6.6 : 1   AA
 *   neutralFlow / surfaceRaised ......... 7.3 : 1   AAA
 *   borderInteractive / background ...... 4.2 : 1   >= 3:1 for non-text
 *
 * `textDisabled` measures 2.8 : 1 and is deliberately below AA. WCAG 1.4.3
 * exempts inactive controls, and lifting it would make disabled read as
 * enabled. It is the ONLY token allowed below the threshold, and it may never
 * carry information that is not repeated by an enabled element.
 */

/**
 * Nomey brand yellow.
 *
 * The flat brand token, deliberately separated from the gloss and gradients of
 * the logo artwork: the logo is an asset, not an interface material. The
 * gradient is never extrapolated to the UI.
 *
 * Measured, not assumed: 13.2:1 as a foreground on black and 12.4:1 as a
 * background under `onAccent`. No adjustment was required.
 */
const BRAND_YELLOW = '#FDC506';

export const Colors = {
  light: {
    // Unvalidated scaffolding. See the note at the top of this file.
    background: '#FFFFFF',
    surface: '#F7F7F7',
    surfaceRaised: '#FFFFFF',
    surfaceSunken: '#EDEDED',

    text: '#0A0A0A',
    textSecondary: '#4A4A4A',
    textTertiary: '#6B6B6B',
    textDisabled: '#A3A3A3',

    border: '#E2E2E2',
    borderStrong: '#CFCFCF',
    borderInteractive: '#8A8A8A',

    accent: '#B98C00',
    accentPressed: '#916E00',
    onAccent: '#FFFFFF',

    positive: '#1A7F4B',
    negative: '#C62828',
    /** Traslado: ni entra ni sale, cambia de sitio. 6.2:1 sobre blanco. */
    neutralFlow: '#0A5FBF',
  },

  dark: {
    /** True black. Chosen for OLED and because it is the logo's own ground. */
    background: '#000000',
    /** First lift away from the ground: sections, inert containers. */
    surface: '#0C0C0C',
    /** Content that sits above a surface: rows, panels, opaque cards. */
    surfaceRaised: '#151515',
    /** Recessed wells: inputs, tracks, pressed floors. */
    surfaceSunken: '#080808',

    text: '#FFFFFF',
    textSecondary: '#A8A8A8',
    textTertiary: '#8A8A8A',
    /** Below AA on purpose. See the note at the top of this file. */
    textDisabled: '#545454',

    /** Hairline separators. Decorative: never the only signal of anything. */
    border: '#2A2A2A',
    /** Stronger division between blocks. Still decorative. */
    borderStrong: '#3D3D3D',
    /**
     * The only border allowed to identify an interactive control, at 4.2:1
     * against the background. Even so, a border is never the sole affordance -
     * design-direction.md section 8 requires a second, non-visual-effect signal.
     */
    borderInteractive: '#707070',

    accent: BRAND_YELLOW,
    /** Pressed / active accent. 9.6:1 on background, 9.0:1 under onAccent. */
    accentPressed: '#D9A800',
    /** The only foreground permitted on top of `accent`. */
    onAccent: '#0A0A0A',

    /**
     * Financial semantics. Money in / money out.
     *
     * Colour must NEVER be the only signal: roughly 1 in 12 men has some form
     * of colour vision deficiency, and red/green is the worst possible pair.
     * Always pair with a sign, an icon or a label. This is not a style
     * preference - it is design-direction.md section 8.
     */
    positive: '#34D17E',
    negative: '#FF6B6B',
    /**
     * El tercer sentido del dinero: **traslado**. Ni ingreso ni gasto — la
     * misma cantidad en otro sitio.
     *
     * Existe porque el selector del `+` tiene tres opciones y las dos de
     * siempre sólo cubren dos. Reutilizar `accent` habría puesto el amarillo de
     * marca a significar una clase de operación, y el amarillo ya significa
     * «la acción principal de esta pantalla».
     *
     * Medido: **7.3:1 sobre `surfaceRaised`** y 8.4:1 sobre el fondo —por
     * encima de `negative`, que está en 6.6—, tono 210°, separado 61° de
     * `positive` y 163° de `accent`.
     *
     * Y vale lo mismo que para los otros dos: **el color nunca es la única
     * señal**. Siempre acompañado de glifo o etiqueta.
     */
    neutralFlow: '#4FA8FF',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * The tokens a piece of text is allowed to be painted with.
 *
 * `ThemeColor` covers every token, grounds and borders included, so a text
 * component typed with it accepts `themeColor="border"` - #2A2A2A on black,
 * 1.5:1 - and both the typecheck and the lint pass. The only place that
 * failure shows up is on a device.
 *
 * The discipline is documented all over this file; this makes the compiler
 * hold it. `textDisabled` stays in, under its stated exemption.
 */
export type TextColor = Extract<
  ThemeColor,
  | 'text'
  | 'textSecondary'
  | 'textTertiary'
  | 'textDisabled'
  | 'accent'
  | 'onAccent'
  | 'positive'
  | 'negative'
>;
