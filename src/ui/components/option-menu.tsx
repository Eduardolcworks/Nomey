import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { StyleSheet } from 'react-native';

import type { OptionMenuProps } from './option-menu-props';

/**
 * UN MENÚ DEL SISTEMA SOBRE UN DISPARADOR CUALQUIERA. **Android.**
 *
 * Es el control del sistema, no una imitación: `MenuView` de
 * `@expo/ui/community/menu` monta un `DropdownMenu` de Jetpack Compose. Es la
 * misma mecánica que el selector de categorías del Modo Personal, generalizada
 * para que un segundo y un tercer selector no tengan que volver a escribirla.
 *
 * ═══════════ EL DISPARADOR VA DENTRO, Y ESO NO ES NEGOCIABLE ═══════════
 *
 * Hubo un intento de dejarlo fuera y poner el `MenuView` **encima** con
 * `absoluteFill`, para que el flexbox de React Native repartiera el ancho de los
 * dos oblongos. Repartía el ancho y **rompía el control**: medido en el
 * emulador, ni un solo toque abría el menú, en ninguna de las tres formas de
 * tocar —`input tap`, `motionevent` y un gesto de 100 ms—. La razón es que lo
 * que se pulsa no es la vista de Android sino el nodo de Compose que hay dentro,
 * y una capa vacía no tiene nada pulsable por mucho que la vista mida lo que
 * mida. Un objetivo accesible presente no demuestra que responda.
 *
 * Así que el disparador vuelve dentro, que es como está aprobado el de
 * categorías. El ancho se resuelve con `flex: 1` más un alto declarado, sin
 * medir nada y sin capas intermedias.
 *
 * **Se abre con un toque.** `shouldOpenOnLongPress` queda sin poner, y su valor
 * por defecto es `false`, verificado en los tipos de `@expo/ui` 57.0.11.
 *
 * **No se le dice dónde salir.** El menú va anclado a su disparador y es el
 * sistema quien decide si lo abre hacia arriba o hacia abajo según el hueco que
 * quede; la API no expone —ni debe— una forma de forzarlo.
 *
 * **Sin iconos en las opciones.** `MenuAction.image` admite un nombre de SF
 * Symbol —que sólo pinta iOS— o un recurso de dibujo. Un participante no tiene
 * ninguno de los dos, así que el menú va con texto, que es lo que hace su propio
 * sistema, y no con un icono roto.
 */
export function OptionMenu({ title, options, onSelect, height, children }: OptionMenuProps) {
  const actions: MenuAction[] = options.map((option) => ({
    id: option.id,
    title: option.title,
    /*
     * EL ESTADO LO EXPONE LA API NATIVA, no un color.
     *
     * `'on'` pinta el check del sistema, que es además lo que TalkBack lee como
     * seleccionado. Marcarlo con un tono habría dejado la elección invisible
     * para quien no ve la pantalla.
     */
    state: option.selected ? 'on' : 'off',
  }));

  return (
    <MenuView
      title={title}
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        /*
         * El identificador vuelve tal cual se mandó —`action.id`—, así que no se
         * reconstruye por posición: reordenar la lista no puede elegir a otra
         * persona ni otro método.
         */
        onSelect(nativeEvent.event);
      }}
      style={height === undefined ? styles.trigger : [styles.slot, { height }]}>
      {/*
       * ═══ CÓMO SE REPARTE EL ANCHO SIN MEDIR NADA ═══
       *
       * `MenuView` es una vista nativa, y con `alignSelf: 'flex-start'` —lo que
       * pide un círculo de lado fijo— se mide por su contenido: dos oblongos así
       * salían con el ancho de sus palabras, 486 px «Elige quién pagó» y 392
       * «Igualmente», y el primero se metía 76 px por debajo del segundo.
       *
       * Estirándose dentro de una columna de React Native —que sí reparte— y con
       * un ALTO DECLARADO, el marco queda definido en las dos direcciones sin
       * depender del contenido, y ahí el reparto funciona: medido, dos oblongos
       * iguales y sin solaparse. El alto sale del token del propio oblongo, no de
       * una cifra suelta.
       *
       * Sin `height` el montaje es el de siempre, que es lo que quiere el
       * círculo de categoría: su aspecto aprobado no cambia ni un punto.
       */}
      {children}
    </MenuView>
  );
}

const styles = StyleSheet.create({
  /** El montaje de siempre: el disparador mide lo que mide. */
  trigger: {
    alignSelf: 'flex-start',
  },
  /**
   * El hueco del control dentro de su columna. Quien reparte el ancho de la fila
   * es esa columna —una vista de React Native—; aquí sólo hay que estirarse: el
   * menú nativo no repartiría nada, porque se mide por su contenido.
   */
  slot: {
    alignSelf: 'stretch',
  },
});
