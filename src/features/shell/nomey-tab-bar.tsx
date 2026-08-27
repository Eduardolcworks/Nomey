import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/lib/i18n';
import { GlassSurface, ThemedText } from '@/ui/components';
import { Radius, Spacing, Tactile, useTheme } from '@/ui/theme';

import { DESTINATIONS, destinationFor } from './destinations';
import { DOCK } from './dock';
import { SCOPE_LABEL, useScope } from './scope-context';

/**
 * The dock: two destinations, and one action that is not a destination.
 *
 * **The `+` sits fully above the bar, with a real gap.** That is not a styling
 * preference. With two tabs the boundary between their touch areas falls dead
 * centre, which is exactly where a centred button wants to be - so a button
 * overlapping the bar would put its lower half on the seam between two tabs,
 * and a thumb aiming for the action would keep landing on a destination. Fully
 * above, the two never share a pixel.
 *
 * **The brand yellow appears exactly once on screen, and it is this button.**
 * The active tab is marked by contrast instead - full-strength text and icon
 * against tertiary grey. If the accent did both jobs, the `+` would look
 * permanently selected and the tab that is actually selected would lose its
 * only signal.
 */
export function NomeyTabBar({ state, navigation }: BottomTabBarProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const activeRoute = state.routes[state.index]?.name ?? '';

  return (
    <View style={styles.dock} pointerEvents="box-none">
      <AddButton activeRoute={activeRoute} />

      <GlassSurface
        level="bar"
        radius={0}
        style={[styles.bar, { paddingBottom: insets.bottom, height: DOCK.bar + insets.bottom }]}>
        {DESTINATIONS.map((destination, index) => {
          const focused = state.index === index;
          const colour = focused ? theme.text : theme.textTertiary;

          return (
            <Pressable
              key={destination.route}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={t(destination.label)}
              style={styles.tab}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: state.routes[index].key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(state.routes[index].name);
                }
              }}>
              <SymbolView
                name={destination.symbol}
                size={24}
                tintColor={colour}
                fallback={<View style={[styles.fallback, { borderColor: colour }]} />}
              />
              <ThemedText
                variant="caption"
                themeColor={focused ? 'text' : 'textTertiary'}
                style={focused ? styles.tabLabelActive : undefined}>
                {t(destination.label)}
              </ThemedText>
            </Pressable>
          );
        })}
      </GlassSurface>
    </View>
  );
}

/**
 * The action, and the only place the accent is filled.
 *
 * It carries the meaning "add something to where I am": on Inicio that is the
 * active scope, on Grupos it is a group. The sheet it opens states which,
 * rather than trusting the user to remember a selector behind it - misreading
 * that is how a couple's dinner lands in someone's personal books, and the
 * figure looks plausible in both places.
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
      style={({ pressed }) => [
        styles.add,
        {
          backgroundColor: pressed ? theme.accentPressed : theme.accent,
          boxShadow: pressed ? Tactile.pressed : Tactile.raised,
        },
      ]}>
      <SymbolView
        name="plus"
        size={30}
        tintColor={theme.onAccent}
        fallback={<View style={[styles.plusFallback, { backgroundColor: theme.onAccent }]} />}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dock: {
    alignItems: 'center',
  },
  add: {
    width: DOCK.add,
    height: DOCK.add,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: DOCK.gap,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    paddingTop: Spacing.sm,
    borderWidth: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingTop: Spacing.xxs,
  },
  tabLabelActive: {
    fontWeight: '600',
  },
  fallback: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderRadius: Radius.sm,
  },
  plusFallback: {
    width: 22,
    height: 3,
    borderRadius: Radius.sm,
  },
});
