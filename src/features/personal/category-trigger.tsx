import { StyleSheet, View } from 'react-native';

import { GlassSurface, Icon } from '@/ui/components';
import { categorySymbol } from '@/ui/theme/category-palette';
import { Radius, useTheme } from '@/ui/theme';

/**
 * EL BOTÓN DE CATEGORÍA. Uno solo, y lo montan las dos plataformas.
 *
 * Vive aparte porque iOS y Android lo colocan en sitios distintos —etiqueta de
 * un `Menu` de SwiftUI allí, hijo de `MenuView` aquí— y lo único que no puede
 * pasar es que cada una lo dibuje a su manera. Sus estilos se escriben una vez.
 *
 * **Sin cristal nativo**, que es la estética aprobada de los controles: los dos
 * caminos de `GlassSurface` pintan los mismos tokens y éste se queda con el
 * relieve, sin la refracción en vivo.
 *
 * **Y sin interacción propia.** El gesto pertenece al menú que lo aloja; un
 * `Pressable` aquí se lo disputaría.
 */
export function CategoryTrigger({
  icon,
  chosen,
  size,
  castsShadow = true,
}: {
  /** La clave semántica de ADR-027, sin resolver. */
  readonly icon: string;
  /** Si hay categoría elegida: decide el tono del icono, no la forma. */
  readonly chosen: boolean;
  readonly size: number;
  /**
   * **Sólo iOS lo pone en `false`.** Allí este círculo es la etiqueta de un
   * `Menu` de SwiftUI, que se recompone al cerrarse; una sombra exterior dentro
   * de esa etiqueta es lo que aparecía aplanada durante cerca de un segundo. El
   * relieve interior se queda aquí y la sombra la pinta un hermano estable, con
   * la otra mitad del mismo token.
   */
  readonly castsShadow?: boolean;
}) {
  const theme = useTheme();

  return (
    <GlassSurface
      level="regular"
      depth="well"
      rim="catch"
      radius={Radius.full}
      nativeEffect={false}
      castsShadow={castsShadow}>
      <View style={[styles.circle, { width: size, height: size }]}>
        <Icon
          name={categorySymbol(icon)}
          size={20}
          colour={chosen ? theme.text : theme.textSecondary}
          shape="circle"
        />
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
