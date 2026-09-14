import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { StyleSheet } from 'react-native';

import type { LongPressMenuProps } from './long-press-menu-props';

/** El menú de acciones al TOCAR, en Android: el mismo `MenuView` sin pulsación larga. */
export function ActionMenu({ actions, onSelect, children }: LongPressMenuProps) {
  const items: MenuAction[] = actions.map((action) => ({
    id: action.id,
    title: action.title,
    attributes: action.destructive === true ? { destructive: true } : undefined,
  }));

  return (
    <MenuView
      actions={items}
      onPressAction={({ nativeEvent }) => {
        onSelect(nativeEvent.event);
      }}
      style={styles.trigger}>
      {children}
    </MenuView>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignSelf: 'stretch',
    flex: 1,
    minWidth: 0,
  },
});
