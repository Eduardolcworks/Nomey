import { Host, Menu, RNHostView, Toggle } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  menuIndicator,
  menuStyle,
} from '@expo/ui/swift-ui/modifiers';
import { StyleSheet, View } from 'react-native';

import { categoryOptions } from './category';
import type { CategoryMenuProps } from './category-menu-props';
import { CategoryTrigger } from './category-trigger';
import { useTranslation } from '@/lib/i18n';
import { castShadow, Radius } from '@/ui/theme';
import { categorySymbol } from '@/ui/theme/category-palette';

/**
 * EL MENÚ DE CATEGORÍAS EN iOS.
 *
 * **El círculo vuelve a ser la etiqueta del `Menu`, y la sombra se queda
 * fuera.** Ésa es toda la composición, y separa dos cosas que hasta ahora
 * viajaban juntas sin necesidad:
 *
 * - lo que SwiftUI TRANSFORMA al abrir —el círculo con su tinte, su borde, su
 *   rim y su relieve interior, más el icono— tiene que estar dentro de la
 *   etiqueta, o el menú no nace de él;
 * - lo que SwiftUI RECOMPONE mal al cerrar —la sombra exterior— no.
 *
 * Y son separables de verdad: las dos mitades de `Tactile.well` son entradas
 * distintas del mismo token, así que `castShadow` e `innerShading` las reparten
 * filtrando los mismos valores. No hay una sombra reescrita ni aproximada en
 * ninguna parte; en reposo las dos capas suman exactamente el aspecto aprobado.
 *
 * **Las tres vías anteriores, medidas sobre el aparato, para que nadie las
 * desande:**
 *
 * - el círculo entero como etiqueta —de `MenuView` o alojado con `RNHostView`—:
 *   el menú nacía bien, pero al cerrar dejaba la placa rectangular difuminada
 *   cerca de un segundo (expo/expo#44126, cerrada aguas arriba sin arreglo);
 * - `buttonStyle('glass')` sobre el `Menu`: sin artefacto, pero sustituía la
 *   estética de Nomey por la de Apple, y reproducir los tokens en SwiftUI no es
 *   posible — `shadow()` es sólo exterior y el relieve es interior;
 * - toda la superficie fuera y una etiqueta vacía: sin artefacto, pero el menú
 *   dejaba de nacer del círculo, porque SwiftUI no conocía la forma.
 *
 * **Sin temporizadores, sin remontajes y sin opacidades atadas al cierre.** La
 * sombra no se esconde durante la animación: sencillamente nunca ha estado
 * dentro de ella.
 *
 * **Un solo elemento accesible.** La capa de sombra no recibe toques ni existe
 * para VoiceOver — no tiene fondo, ni borde, ni círculo, ni icono: es una
 * sombra y nada más. Quien anuncia el control es `accessibilityLabel` sobre el
 * `Menu`, porque su etiqueta ya no es un texto.
 *
 * Android se queda con `MenuView` y su `DropdownMenu` de Compose.
 */
export function CategoryMenu({
  categories,
  selected,
  onSelect,
  label,
  size,
  icon,
  chosen,
}: CategoryMenuProps) {
  const { t } = useTranslation();

  const options = categoryOptions(categories, selected, t);

  return (
    <View style={{ width: size, height: size }}>
      {/*
       * SÓLO LA SOMBRA. Hermana estable, fuera del `Host`, sin nada que pintar
       * salvo la mitad exterior de `Tactile.well`. Debajo del círculo no queda
       * ningún segundo círculo: no tiene fondo ni borde.
       */}
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[StyleSheet.absoluteFill, styles.sombra, { boxShadow: castShadow('well') }]}
      />

      <Host matchContents colorScheme="dark">
        <Menu
          /*
           * LA ETIQUETA ES EL CÍRCULO, que es lo que devuelve la transición
           * anclada: SwiftUI transforma en el menú lo que ve, y ahora vuelve a
           * ver la forma. Lo único que se le quita es la sombra que no sabe
           * recomponer.
           */
          label={
            <RNHostView matchContents>
              <CategoryTrigger icon={icon} chosen={chosen} size={size} castsShadow={false} />
            </RNHostView>
          }
          modifiers={[
            /*
             * Los tres que quitan el cromo del sistema: sin ellos SwiftUI
             * envuelve la etiqueta en su propio botón y le añade el galón de
             * despliegue. `'plain'` es la ausencia de estilo, no el cristal.
             */
            menuStyle('button'),
            buttonStyle('plain'),
            menuIndicator('hidden'),
            accessibilityLabel(label),
          ]}>
          {options.map((option) => (
            <Toggle
              key={option.id}
              label={option.title}
              systemImage={categorySymbol(option.icon).ios}
              isOn={option.selected}
              onIsOnChange={() => {
                /*
                 * Se ignora el valor: esto no es un interruptor, es una
                 * elección entre iguales. Apagar la vigente no es una intención
                 * que el borrador sepa representar —la categoría es obligatoria
                 * en un gasto—, así que tocar cualquiera de las diez significa
                 * elegir ésa.
                 */
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
  sombra: {
    // El radio es el del círculo: una sombra sigue la forma de su caja, y sin
    // esto caería como un cuadrado — que es justo lo que no queremos ver.
    borderRadius: Radius.full,
  },
});
