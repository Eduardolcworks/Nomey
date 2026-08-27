import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/lib/i18n';
import { GlassSurface, ThemedText } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

import { DESTINATIONS, type Destination, destinationFor } from './destinations';
import { DOCK } from './dock';
import { SCOPE_LABEL, useScope } from './scope-context';

/**
 * Two independent controls and one action, floating over the content.
 *
 * **There is no bar.** The container positions things and reserves the safe
 * area; it paints nothing. Inicio and Grupos are two separate pills, each with
 * its own surface, radius, depth and states, because they are two separate
 * places - a single capsule split into halves reads as one object with two
 * regions, which is the wrong model for two root destinations.
 *
 * **The action sits fully above them, with a real gap.** With two destinations
 * the space between them falls dead centre, exactly where a centred button
 * wants to be, so any overlap would put the action on the seam and a thumb
 * aiming for it would keep landing on a destination.
 *
 * **The brand yellow appears exactly once on screen, and it is that button.**
 * Selection is carried by the surface instead - a lifted glass pill with a
 * stronger edge against a recessed, quieter one - and reinforced by text
 * weight and colour. If the accent did both jobs the action would look
 * permanently selected and the selected destination would lose its signal.
 */
export function NomeyTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const activeRoute = state.routes[state.index]?.name ?? '';

  return (
    <View
      style={[styles.dock, { paddingBottom: insets.bottom + DOCK.edge }]}
      pointerEvents="box-none">
      <AddButton activeRoute={activeRoute} />

      <View style={styles.destinations} pointerEvents="box-none">
        {DESTINATIONS.map((destination, index) => (
          <DestinationButton
            key={destination.route}
            destination={destination}
            focused={state.index === index}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: state.routes[index].key,
                canPreventDefault: true,
              });
              if (state.index !== index && !event.defaultPrevented) {
                navigation.navigate(state.routes[index].name);
              }
            }}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * One destination, as its own object.
 *
 * Selected and unselected differ by surface, not only by text: the selected
 * pill is lifted with `Tactile.selected` and edged with `borderStrong`, the
 * unselected one is recessed into a well and edged with the quiet `border`.
 * Colour and weight then reinforce what the depth already said - which is the
 * rule that keeps the state readable for anyone who cannot see the depth.
 *
 * The unselected label stays at `textSecondary`, not `textTertiary`: discreet
 * is not the same as faint, and this is a navigation control.
 */
function DestinationButton({
  destination,
  focused,
  onPress,
}: {
  destination: Destination;
  focused: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const label = t(destination.label);

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.destination}>
      {({ pressed }) => (
        <GlassSurface
          level={focused ? 'regular' : 'bar'}
          depth={pressed ? 'pressed' : focused ? 'selected' : 'well'}
          radius={Radius.full}
          style={styles.pill}>
          <SymbolView
            name={destination.symbol}
            size={20}
            tintColor={focused ? theme.text : theme.textSecondary}
            fallback={
              <View
                style={[
                  styles.fallback,
                  { borderColor: focused ? theme.text : theme.textSecondary },
                ]}
              />
            }
          />
          <ThemedText
            variant="label"
            themeColor={focused ? 'text' : 'textSecondary'}
            style={focused ? null : styles.labelQuiet}>
            {label}
          </ThemedText>
        </GlassSurface>
      )}
    </Pressable>
  );
}

/**
 * The action, in the same material as the controls beside it.
 *
 * Yellow glass rather than a flat yellow disc: `Glass.action` is the brand
 * colour at 0.90, which measured 10:1 for near-black on it against a black
 * backdrop and 13:1 against a white one, so it keeps every bit of its
 * legibility while belonging to the same surface family as the pills. A flat
 * circle looked like an object borrowed from another design system.
 *
 * It carries the meaning "add something to where I am": on Inicio the active
 * scope, on Grupos a group. The sheet it opens restates which, rather than
 * trusting the user to remember the switch at the top of the screen.
 */
function AddButton({ activeRoute }: { activeRoute: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { scope } = useScope();

  const destination = destinationFor(activeRoute);
  const label =
    destination === 'groups'
      ? t('action.addToGroups')
      : t('action.addTo', { scope: t(SCOPE_LABEL[scope]) });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        router.push({ pathname: '/add', params: { from: destination } });
      }}
      style={styles.add}>
      {({ pressed }) => (
        <GlassSurface
          level="action"
          depth={pressed ? 'pressed' : 'flat'}
          radius={Radius.full}
          style={styles.addSurface}>
          {/*
           * The glyph carries the brand colour now that the body does not.
           * It is the brightest thing in the dock, which is what keeps this
           * an action rather than a third destination.
           */}
          <SymbolView
            name="plus"
            size={28}
            tintColor={theme.accent}
            fallback={<View style={[styles.plusFallback, { backgroundColor: theme.accent }]} />}
          />
        </GlassSurface>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dock: {
    alignItems: 'center',
    gap: DOCK.gap,
  },
  destinations: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  destination: {
    borderRadius: Radius.full,
    minWidth: DOCK.destinationWidth,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: DOCK.bar,
    paddingHorizontal: Spacing.lg,
  },
  labelQuiet: {
    fontWeight: '500',
  },
  add: {
    borderRadius: Radius.full,
  },
  addSurface: {
    width: DOCK.add,
    height: DOCK.add,
    // A full point rather than a hairline: on a 56pt disc a half-pixel rim is
    // not a rim, and the rim is most of what says "surface" instead of "fill".
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderRadius: Radius.sm,
  },
  plusFallback: {
    width: 22,
    height: 3,
    borderRadius: Radius.sm,
  },
});
