import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { Radius } from '@/ui/theme';

export type IconProps = {
  name: SymbolViewProps['name'];
  size?: number;
  colour: string;
  /** A rounded square rather than a circle, for anything that is not an avatar. */
  shape?: 'square' | 'circle';
};

/**
 * An SF Symbol that always has somewhere to fall back to.
 *
 * `SymbolView` renders nothing outside iOS unless a `fallback` is supplied, so
 * every call site had grown its own little bordered `View` - eight of them,
 * each with slightly different dimensions and radii. The contract this
 * enforces is not the shape: it is that an icon can never silently disappear
 * on a platform that has no SF Symbols.
 *
 * The fallback is a plain outline on purpose. It is a placeholder that says
 * "an icon belongs here", not an attempt to redraw the symbol.
 */
export function Icon({ name, size = 22, colour, shape = 'square' }: IconProps) {
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={colour}
      fallback={
        <View
          style={[
            styles.fallback,
            {
              width: size * 0.8,
              height: size * 0.8,
              borderColor: colour,
              borderRadius: shape === 'circle' ? Radius.full : Radius.sm,
            },
          ]}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    borderWidth: 2,
  },
});
