import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { StyleSheet } from 'react-native';

import type { LongPressMenuProps } from './long-press-menu-props';

/**
 * UN MENÚ CONTEXTUAL DEL SISTEMA AL MANTENER PULSADO. **Android.**
 *
 * Es el mismo `MenuView` de `@expo/ui/community/menu` que ya aloja los
 * selectores —el mismo `DropdownMenu` de Compose—, con una diferencia:
 * `shouldOpenOnLongPress`. El toque normal sigue llegando al hijo, que es la
 * tarjeta con su `Pressable`; sólo la pulsación prolongada abre el menú.
 *
 * **El disparador va dentro**, por lo medido en `option-menu.tsx`: lo que se
 * pulsa es el nodo de Compose, y una capa encima no responde.
 *
 * **Sin imagen en Android.** `MenuAction.image` como cadena es un SF Symbol y
 * se ignora aquí; un recurso de dibujo exigiría empaquetar bitmaps, que no se
 * añaden. Las acciones van con texto y con el estado destructivo del sistema.
 *
 * **Sin comprobar en el emulador en esta tanda** —cerrado por consumo—; la
 * validación de esta plataforma queda pendiente y se dice.
 */
export function LongPressMenu({ actions, onSelect, children }: LongPressMenuProps) {
  const items: MenuAction[] = actions.map((action) => ({
    id: action.id,
    title: action.title,
    attributes: action.destructive === true ? { destructive: true } : undefined,
  }));

  return (
    <MenuView
      actions={items}
      shouldOpenOnLongPress
      onPressAction={({ nativeEvent }) => {
        onSelect(nativeEvent.event);
      }}
      style={styles.host}>
      {children}
    </MenuView>
  );
}

const styles = StyleSheet.create({
  host: {
    alignSelf: 'stretch',
  },
});
