import { BlurTargetView } from 'expo-blur';
import type { RefObject } from 'react';
import { StyleSheet, type View } from 'react-native';

/**
 * LO QUE HAY QUE DESENFOCAR, declarado — y en Android hace falta declararlo.
 *
 * Su método no desenfoca «lo de detrás» por composición como iOS: dibuja a
 * partir de una vista concreta, y sin ella avisa y degrada a `none`, que es un
 * relleno semitransparente y no un desenfoque.
 *
 * **Sólo existe en Android.** iOS conserva su árbol anterior, sin este
 * envoltorio: `blur-target.tsx` devuelve sus hijos tal cual.
 */
export function BlurTarget({
  target,
  children,
}: {
  readonly target: RefObject<View | null>;
  readonly children: React.ReactNode;
}) {
  return (
    <BlurTargetView ref={target} style={styles.fill}>
      {children}
    </BlurTargetView>
  );
}

const styles = StyleSheet.create({
  /** Mide la pantalla, igual que medía el fragmento que envuelve. */
  fill: {
    flex: 1,
  },
});
