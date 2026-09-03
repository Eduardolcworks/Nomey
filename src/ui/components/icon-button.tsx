import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { ControlMaterial } from './control-material';
import { Icon, type IconProps } from './icon';
import { Radius, Spacing, useTheme } from '@/ui/theme';

export type IconButtonProps = {
  name: IconProps['name'];
  /** Always required: an icon alone tells a screen reader nothing. */
  label: string;
  onPress: () => void;
  size?: number;
  colour?: string;
  /**
   * Paints the circular container instead of leaving it invisible until press.
   *
   * Off by default, so every call site that predates this keeps its bare glyph.
   * It exists for the one case where the button sits ON a card rather than in a
   * header: without a container the icon floats in the middle of a surface with
   * nothing saying it is a control, and `design-direction.md` §8 does not let an
   * affordance rest on a glyph alone.
   */
  filled?: boolean;
  /**
   * Apagado: no responde y lo anuncia.
   *
   * `accessibilityState` va con la opacidad y no en su lugar: un control que
   * sólo se ve más tenue sigue pareciendo pulsable a quien no lo ve.
   */
  disabled?: boolean;
  style?: ViewStyle;
};

/**
 * An icon that can be tapped, at a size a thumb can actually hit.
 *
 * The target is 44pt because that is Apple's minimum, not a rounding of it,
 * and the symbol inside stays small so the control reads light while the thing
 * being hit stays honest. Four call sites had each built this by hand.
 *
 * `label` is not optional. An icon button with no accessible name is a button
 * that announces itself as "button" and nothing else, and the visible glyph
 * cannot fill that gap.
 */
export function IconButton({
  name,
  label,
  onPress,
  size = 22,
  colour,
  filled = false,
  disabled = false,
  style,
}: IconButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={Spacing.sm}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        filled && {
          backgroundColor: theme.surfaceRaised,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.border,
        },
        pressed && { backgroundColor: theme.border },
        disabled && styles.disabled,
        style,
      ]}>
      {/*
       * El material neutro de Android, sobre el relleno del tema. En iOS no
       * monta nada, asi que este boton conserva alli lo que ya tenia.
       */}
      {filled ? <ControlMaterial radius={Radius.full} /> : null}
      <Icon name={name} size={size} colour={colour ?? theme.text} shape="circle" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disabled: {
    opacity: 0.4,
  },
  button: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
});
