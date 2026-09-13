import { Button, ContextMenu, Host, RNHostView } from '@expo/ui/swift-ui';
import { StyleSheet, View } from 'react-native';

import type { LongPressMenuProps } from './long-press-menu-props';

/**
 * UN MENÚ CONTEXTUAL DEL SISTEMA AL MANTENER PULSADO. **iOS.**
 *
 * `ContextMenu` de SwiftUI, con la tarjeta como `Trigger` y las acciones como
 * `Button` del sistema: icono por `systemImage` —el mismo par de símbolos que
 * el resto de la aplicación— y la destructiva con `role="destructive"`, que es
 * lo que iOS pinta en rojo. No hay un menú flotante propio ni una dependencia
 * nueva: es la pieza del sistema, como los selectores.
 *
 * **El toque normal sigue siendo de la tarjeta.** El `Pressable` de dentro
 * recibe el toque; el menú sólo reclama la pulsación prolongada. Y al abrirse,
 * el sistema NO despacha además el toque: es el contrato del gesto.
 *
 * **La anchura se declara.** Un `Host` con `matchContents` mide por su
 * contenido, y una tarjeta de lista tiene que medir lo que mide su fila. El
 * envoltorio se estira y el anfitrión toma su ancho.
 */
export function LongPressMenu({ actions, onSelect, children }: LongPressMenuProps) {
  return (
    <View style={styles.host}>
      {/* `ignoreSafeArea`: la posición la pone React Native — ver `option-menu.ios.tsx`. */}
      <Host matchContents style={styles.host} colorScheme="dark" ignoreSafeArea="all">
        <ContextMenu>
          <ContextMenu.Items>
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
          </ContextMenu.Items>
          <ContextMenu.Trigger>
            <RNHostView matchContents>
              <View style={styles.host}>{children}</View>
            </RNHostView>
          </ContextMenu.Trigger>
        </ContextMenu>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    alignSelf: 'stretch',
    width: '100%',
  },
});
