import { Tabs } from 'expo-router/tabs';

import { DESTINATIONS, NomeyTabBar } from '@/features/shell';

/**
 * The two root destinations.
 *
 * The bar is entirely Nomey's - the default one cannot hold an action that is
 * not a tab, and the action is the point. Screens are declared from the same
 * array the bar renders from, so the two cannot disagree about what exists.
 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <NomeyTabBar {...props} />}>
      {DESTINATIONS.map((destination) => (
        <Tabs.Screen key={destination.route} name={destination.route} />
      ))}
    </Tabs>
  );
}
