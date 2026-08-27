import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { Icon, type IconProps } from './icon';
import { Radius, Spacing, useTheme } from '@/ui/theme';

export type IconButtonProps = {
  name: IconProps['name'];
  /** Always required: an icon alone tells a screen reader nothing. */
  label: string;
  onPress: () => void;
  size?: number;
  colour?: string;
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
export function IconButton({ name, label, onPress, size = 22, colour, style }: IconButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={Spacing.sm}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && { backgroundColor: theme.border }, style]}>
      <Icon name={name} size={size} colour={colour ?? theme.text} shape="circle" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
});
