import { Host, Menu, RNHostView, Toggle } from '@expo/ui/swift-ui';
import { buttonStyle, menuIndicator, menuStyle } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet, View } from 'react-native';

import { categorySymbol } from '@/ui/theme/category-palette';

import type { OptionMenuProps } from './option-menu-props';

/**
 * UN MENÚ DEL SISTEMA SOBRE UN DISPARADOR CUALQUIERA. **iOS.**
 *
 * Entero en SwiftUI, por la misma razón medida que el selector de categorías:
 * alojar el disparador con `MenuView` deja un halo rectangular difuminado cerca
 * de un segundo al cerrar (expo/expo#44126, cerrada aguas arriba sin arreglo).
 * `Menu` con el disparador como etiqueta no lo tiene.
 *
 * **Los tres modificadores que quitan el cromo del sistema.** Sin ellos SwiftUI
 * envuelve la etiqueta en su propio botón y le añade su galón de despliegue —y
 * el oblongo ya lleva el suyo—. `'plain'` es la ausencia de estilo, no cristal.
 *
 * **Un solo elemento accesible**, y lo anuncia el propio disparador: el oblongo
 * lleva su rol y su etiqueta, igual que en Android, para que la misma pieza diga
 * lo mismo en las dos plataformas y no haya dos sitios donde mantenerlo.
 *
 * **`Toggle` y no `Button`** porque el check de selección es lo que el sistema
 * lee como «elegido». Se ignora el valor que devuelve: esto no es un
 * interruptor, es una elección entre iguales — apagar la vigente no es una
 * intención que el borrador sepa representar, así que tocar cualquiera de ellas
 * significa elegir ésa.
 */
export function OptionMenu({ title, options, onSelect, height, children }: OptionMenuProps) {
  void title;

  return (
    /*
     * El alto declarado también aquí, para que la fila de dos reparta igual en
     * las dos plataformas. `Host matchContents` se ajusta a su contenido, así
     * que sin el hueco de alto conocido los dos oblongos no compartirían línea
     * base. Sin `height` el montaje es el de siempre.
     */
    <View style={height === undefined ? styles.trigger : [styles.slot, { height }]}>
      {/*
       * `ignoreSafeArea="all"`: LA POSICIÓN LA PONE REACT NATIVE, no SwiftUI.
       *
       * Un anfitrión de SwiftUI aplica por defecto el área segura del sistema
       * —indicador de inicio, teclado— según dónde caiga su marco en la
       * ventana. La hoja modal nace fuera de la pantalla, por abajo, y entra
       * con una TRANSFORMACIÓN: UIKit no recalcula el área segura al
       * transformar, así que el contenido quedaba maquetado con la inserción
       * del borde inferior y el oblongo se pintaba encima de su rótulo.
       * Medido en el iPhone al pasar la entrada de la hoja a `fall`. Aquí no
       * hay borde de pantalla que respetar: la caja la decide el layout de
       * fuera, y SwiftUI sólo rellena.
       */}
      <Host matchContents colorScheme="dark" ignoreSafeArea="all">
        <Menu
          label={<RNHostView matchContents>{children}</RNHostView>}
          modifiers={[menuStyle('button'), buttonStyle('plain'), menuIndicator('hidden')]}>
          {options.map((option) => (
            <Toggle
              key={option.id}
              label={option.title}
              systemImage={option.icon === undefined ? undefined : categorySymbol(option.icon).ios}
              isOn={option.selected}
              onIsOnChange={() => {
                onSelect(option.id);
              }}
            />
          ))}
        </Menu>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * ═══════ SIN ALTO DECLARADO, EL DISPARADOR MIDE LO QUE MIDE ═══════
   *
   * **Aquí ponía `flex: 1`, y eso es lo que convertía el círculo de categoría en
   * un oblongo en iPhone.** El caso sin `height` es el del disparador de lado
   * fijo —el círculo—, y con `flex: 1` esta vista se llevaba su parte de la
   * fila; dentro, `Host matchContents` y `RNHostView matchContents` se ajustan a
   * lo que se les dé, así que el `GlassSurface` del disparador se estiraba a
   * todo el ancho y dejaba el icono centrado en una pastilla. El icono nunca se
   * deformó: lo que crecía era su superficie.
   *
   * `alignSelf: 'flex-start'` es **exactamente lo que ya hacía Android** con el
   * mismo nombre. Las dos plataformas dicen ahora lo mismo para el mismo caso,
   * que es la única forma de que el control no se dibuje distinto en cada una.
   *
   * Y el ancho que suelta no se pierde: el concepto es `flex: 1` en esa misma
   * fila, así que lo ocupa él sin tocar ni un estilo suyo.
   */
  trigger: {
    alignSelf: 'flex-start',
  },
  /**
   * ═══════ EL HUECO CON ALTO DECLARADO RESERVA ESE ALTO, Y NO CERO ═══════
   *
   * **Aquí ponía `flex: 1`, y eso es lo que dejaba a «Repartir entre» encima
   * de los oblongos.** El hueco vive dentro de una COLUMNA —rótulo arriba,
   * control debajo—, y en una columna el eje principal es el vertical: `flex:
   * 1` fija `flexBasis: 0` en ese eje, que **manda sobre el `height`
   * declarado**. Como la columna mide por su contenido, no hay espacio sobrante
   * que repartir, y el hueco quedaba en cero puntos de alto. El anfitrión de
   * SwiftUI de dentro se ajusta a su contenido y pintaba sus 52 puntos igual,
   * pero **fuera de la caja**: la fila sólo reservaba el rótulo, y lo siguiente
   * de la hoja arrancaba justo debajo de él.
   *
   * `alignSelf: 'stretch'` es exactamente lo que ya hacía Android con este
   * mismo nombre: ocupar el ancho de la columna y dejar que el `height`
   * declarado sea el alto de verdad. Con eso la fila reserva rótulo + hueco +
   * oblongo, y la separación de debajo se mide desde el borde real.
   *
   * El ancho no lo pierde: quien reparte la fila mitad y mitad es la columna de
   * React Native, no este hueco.
   */
  slot: {
    alignSelf: 'stretch',
  },
});
