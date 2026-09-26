import { StyleSheet, View } from 'react-native';

import { GlassSurface } from './glass-surface';
import { ThemedText } from './themed-text';
import { Radius } from '@/ui/theme';

/**
 * EL OBLONGO DE LA MONEDA. Uno solo, y lo montan las dos plataformas.
 *
 * Vive aparte por lo mismo que `CategoryTrigger`: iOS y Android lo colocan en
 * sitios distintos —etiqueta de un `Menu` de SwiftUI allí, hijo de `MenuView`
 * aquí— y lo único que no puede pasar es que cada una lo dibuje a su manera.
 *
 * **Es el mismo aspecto que tenía**, punto por punto: hasta ahora era un
 * `GlassPressable` con `depth="well"` y `rim="soft"`, y eso es exactamente un
 * `GlassSurface material="control" level="regular"` con esos dos tokens, que es
 * lo que aquel monta por dentro en reposo. No se ha reescrito ningún relieve.
 *
 * **Y sin interacción propia.** El gesto pertenece al menú que lo aloja; un
 * `Pressable` aquí se lo disputaría — medido en el selector de categorías.
 *
 * **Sólo el símbolo.** Las siglas viven en las opciones del menú, que es donde
 * hay sitio para leerlas; en un cuadrado de 56 puntos, `€` se lee de un vistazo
 * y `EUR` compite con la cifra que tiene al lado.
 */
export function CurrencyTrigger({
  symbol,
  size,
  castsShadow = true,
}: {
  /** Ya resuelto por el patrón regional. Nunca un `€` escrito a mano. */
  readonly symbol: string;
  readonly size: number;
  /**
   * **Sólo iOS lo pone en `false`.** Allí este oblongo es la etiqueta de un
   * `Menu` de SwiftUI, que se recompone al cerrarse, y una sombra exterior
   * dentro de esa etiqueta es lo que aparece aplanada durante cerca de un
   * segundo (expo/expo#44126). El relieve interior se queda aquí y la sombra la
   * pinta un hermano estable, con la otra mitad del mismo token.
   */
  readonly castsShadow?: boolean;
}) {
  return (
    <GlassSurface
      material="control"
      level="regular"
      depth="well"
      rim="soft"
      radius={Radius.lg}
      nativeEffect={false}
      castsShadow={castsShadow}>
      <View style={[styles.box, { width: size, height: size }]}>
        <ThemedText variant="title">{symbol}</ThemedText>
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
