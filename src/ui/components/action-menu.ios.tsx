import { Button, Host, Menu, RNHostView } from '@expo/ui/swift-ui';
import { buttonStyle, menuIndicator, menuStyle } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet, View } from 'react-native';

import type { LongPressMenuProps } from './long-press-menu-props';

/**
 * UN MENÚ NATIVO DE ACCIONES QUE SE ABRE AL TOCAR. Las mismas acciones que
 * `LongPressMenu` —título, símbolo, rol destructivo—, con el gesto de
 * `OptionMenu`: un toque, no una pulsación larga. Es `Menu` de SwiftUI con
 * `Button`s, y no con `Toggle`s, porque son acciones y no una elección.
 */
export function ActionMenu({ actions, onSelect, children }: LongPressMenuProps) {
  return (
    <View style={styles.trigger}>
      {/* `ignoreSafeArea`: la posición la pone React Native — ver `option-menu.ios.tsx`. */}
      <Host matchContents colorScheme="dark" ignoreSafeArea="all">
        <Menu
          label={
            <RNHostView matchContents>
              <View style={styles.trigger}>{children}</View>
            </RNHostView>
          }
          modifiers={[menuStyle('button'), buttonStyle('plain'), menuIndicator('hidden')]}>
          {actions.map((action) => (
            <Button
              key={action.id}
              label={action.title}
              systemImage={action.icon.ios as never}
              role={action.destructive === true ? 'destructive' : 'default'}
              onPress={() => {
                onSelect(action.id);
              }}
            />
          ))}
        </Menu>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignSelf: 'stretch',
    flex: 1,
    minWidth: 0,
  },
});
