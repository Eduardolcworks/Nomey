import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';

import { IconButton, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, Tactile, Typography, useTheme } from '@/ui/theme';

import {
  FIELD_BORDER_WIDTH,
  fieldBorder,
  nextRevealed,
  revealPresentation,
} from './field-appearance';

/**
 * A labelled text field, local to this feature on purpose.
 *
 * `src/ui/` is the design system, and a component earns a place there by
 * having more than one consumer - `ui/components/README` and the primitives
 * test both say so. Right now the only screens with a form are the two in
 * this folder. When a third appears somewhere else, this moves; guessing now
 * would be inventing a second consumer rather than answering one.
 */

export type AuthFieldProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  readonly label: string;
  /**
   * Añade el botón de ojo dentro del extremo derecho del campo.
   *
   * **Es opcional y se pide expresamente.** Sólo lo usa la contraseña de
   * `Entrar`; el alta y el resto de formularios siguen exactamente como
   * estaban, que es lo que se acordó. Cuando está activo, este componente pasa
   * a mandar sobre `secureTextEntry`: el texto se oculta de partida y sólo el
   * botón lo cambia.
   */
  readonly revealable?: boolean;
};

export const AuthField = forwardRef<TextInput, AuthFieldProps>(function AuthField(
  { label, editable = true, revealable = false, ...input },
  ref,
) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  // Oculta de partida, y este componente manda mientras `revealable` esté
  // puesto: si el llamante pasara `secureTextEntry` a la vez, el botón seguiría
  // siendo la única cosa que decide.
  const reveal = revealPresentation(revealed, revealable, input.secureTextEntry);
  const border = fieldBorder(focused, theme);

  return (
    <View style={styles.field}>
      <ThemedText variant="label" themeColor="textSecondary">
        {label}
      </ThemedText>
      {/*
       * The depth lives on the wrapper rather than on the input. React
       * Native's `TextStyle` types `boxShadow` as a string, so the token - an
       * array of shadow objects - only type-checks on a `ViewStyle`. Putting
       * it here is also the more honest structure: the surface is a box, the
       * input is the text inside it.
       */}
      <View
        style={[
          styles.surface,
          {
            backgroundColor: theme.surface,
            // Focus is not signalled by colour alone: the surface sinks as
            // well, so the field reads as active without depending on hue.
            borderColor: border.color,
            borderWidth: border.width,
            boxShadow: focused ? Tactile.pressed : Tactile.raised,
          },
        ]}>
        <TextInput
          ref={ref}
          {...input}
          secureTextEntry={reveal.secure}
          editable={editable}
          // The label is already next to the field visually; naming it here is
          // what makes the two one control for a screen reader.
          accessibilityLabel={label}
          onFocus={(event) => {
            setFocused(true);
            input.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            input.onBlur?.(event);
          }}
          placeholderTextColor={theme.textDisabled}
          style={[
            styles.input,
            Typography.body,
            // Hueco para el ojo, para que el texto no acabe por debajo de él.
            revealable && styles.inputWithReveal,
            { color: editable ? theme.text : theme.textSecondary },
          ]}
        />

        {revealable ? (
          /*
           * DENTRO DEL CAMPO, Y SIN ROBARLE EL FOCO.
           *
           * `IconButton` ya trae el rol de botón, el nombre accesible y un
           * blanco de 44×44 con `hitSlop`, así que el glifo sigue siendo
           * pequeño mientras lo que se toca es honesto. Va posicionado en
           * absoluto para que aparecer o desaparecer no mueva el texto.
           *
           * El nombre cambia con el estado —«Mostrar» cuando está oculta,
           * «Ocultar» cuando se ve— porque un icono que cambia de dibujo no le
           * dice nada a un lector de pantalla, y `selected` lo acompaña para
           * que el estado se anuncie además de leerse.
           */
          <View style={styles.reveal} pointerEvents="box-none">
            <IconButton
              name={Symbols[reveal.icon]}
              label={t(reveal.labelKey)}
              selected={reveal.selected}
              size={20}
              colour={theme.textSecondary}
              onPress={() => setRevealed(nextRevealed)}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
});

/** Lo que ocupa el ojo, y por tanto lo que el texto no puede invadir. */
const REVEAL_WIDTH = 44;

const styles = StyleSheet.create({
  field: { gap: Spacing.xs },
  surface: {
    borderWidth: FIELD_BORDER_WIDTH,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  input: {
    // 52pt, comfortably over the 44pt minimum touch target.
    minHeight: 52,
    paddingHorizontal: Spacing.md,
  },
  inputWithReveal: {
    paddingRight: REVEAL_WIDTH + Spacing.xs,
  },
  reveal: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: REVEAL_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
