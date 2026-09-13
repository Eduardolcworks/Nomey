import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/ui/components';
import { Spacing } from '@/ui/theme';

/**
 * LA FILA DE TÍTULO DE UN DESTINO RAÍZ. Una sola, para los dos.
 *
 * Debajo de [`AppTopBar`](./app-top-bar.tsx) y **dentro del contenido**, no de
 * la barra: se desplaza con la pantalla, como cualquier otra cosa. La barra
 * identifica la aplicación y se queda quieta; esto dice qué se está mirando.
 *
 * **Existe para que Inicio y Grupos no puedan separarse.** Antes había dos
 * composiciones distintas —Inicio ponía el saludo aquí y Grupos metía su título
 * dentro de la barra, sustituyendo a la marca—, así que el nivel jerárquico, la
 * tipografía, los márgenes y el alto eran una coincidencia que el primer retoque
 * habría roto. Ahora son el mismo componente: cambiar esta fila cambia las dos.
 *
 * El `trailing` es lo que Inicio pone a la derecha —el selector de ámbito— y
 * Grupos no pone nada. **No es un hueco decorativo**: sin él el selector tendría
 * que vivir fuera de la fila, y separarlo del texto es exactamente el defecto
 * que `HomeGreeting` documentaba y evitaba.
 */
export type ScreenTitleProps = {
  /** El texto del título, ya traducido. */
  readonly children: string;
  /** Lo que va a la derecha en la misma fila, si algo va. */
  readonly trailing?: ReactNode;
};

export function ScreenTitle({ children, trailing }: ScreenTitleProps) {
  return (
    <View style={styles.row}>
      <ThemedText variant="title" style={styles.text} numberOfLines={1}>
        {children}
      </ThemedText>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * El relleno lateral es el mismo que traía la cabecera cuando el saludo vivía
   * dentro de ella, y el `paddingBottom` es el que separaba la cabecera de
   * `Disponible`. Los trae esta fila porque entra en contenedores que no ponen
   * márgenes propios: sumados a los del contenedor, el título se metería hacia
   * dentro y la distancia hasta la primera tarjeta crecería.
   */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    /**
     * EL ALTO NO DEPENDE DE SI HAY ALGO A LA DERECHA.
     *
     * Sin esto la fila mide lo que mida su contenido: 44 en Inicio, donde el
     * selector de ámbito es una píldora de 44, y 34 en Grupos, donde sólo hay
     * texto. **Medido en el emulador**: el título de Grupos salía 9 px más
     * arriba que el saludo de Inicio, y todo lo de debajo con él.
     *
     * 44 no es un número nuevo: es el alto que esta fila ya tiene en Inicio, y
     * el mismo objetivo táctil que la píldora declara. Fijándolo aquí, las dos
     * pantallas alinean su título en la misma línea con y sin acompañante.
     *
     * **Y se le suma el relleno, porque en Yoga la altura mínima lo incluye.**
     * Con `minHeight: 44` a secas no pasaba nada: el contenido (34) más el
     * relleno inferior (16) ya son 50, así que el mínimo nunca llegaba a
     * aplicarse y la fila seguía midiendo 9,5 dp menos que la de Inicio —medido
     * con la caja pintada—. Es el mismo detalle que `AppTopBar` ya documenta
     * para su propia fila.
     */
    minHeight: 44 + Spacing.md,
  },
  text: {
    flexShrink: 1,
  },
});
