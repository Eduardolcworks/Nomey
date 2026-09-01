import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { StyleSheet, View } from 'react-native';

import { categoryOptions } from './category';
import type { CategoryMenuProps } from './category-menu-props';
import { CategoryTrigger } from './category-trigger';
import { useTranslation } from '@/lib/i18n';

/**
 * EL MENÚ NATIVO DE CATEGORÍAS.
 *
 * **Es el control del sistema, no una imitación.** `MenuView` de
 * `@expo/ui/community/menu` monta un `Menu` de SwiftUI en iOS y un
 * `DropdownMenu` de Jetpack Compose en Android. Lo que antes había aquí era una
 * rueda dentro de un `Modal` propio: se abría desde abajo, ocupaba media
 * pantalla para elegir entre diez cosas y no se parecía a nada del sistema.
 *
 * **Se abre con un toque.** `shouldOpenOnLongPress` queda sin poner, y su valor
 * por defecto es `false` — verificado en los tipos de la versión instalada
 * (`@expo/ui` 57.0.11), no supuesto.
 *
 * **No se le dice dónde salir.** El menú va anclado a su trigger y es iOS quien
 * decide si lo abre hacia arriba o hacia abajo según el hueco que quede; la API
 * no expone —ni debe— una forma de forzarlo.
 *
 * **ESTA ES LA IMPLEMENTACIÓN DE ANDROID.** iOS tiene la suya, entera en
 * SwiftUI, porque alojar aquí el círculo de cristal como etiqueta del `Menu`
 * es lo que hace aparecer el halo rectangular al cerrar — desaconsejado por la
 * documentación de Expo y registrado en expo/expo#44126. El `DropdownMenu` de
 * Compose no tiene ese problema, así que aquí el cristal sí es el trigger.
 *
 * **Sin icono en las opciones, y no por descuido.** `MenuAction.image` admite
 * un nombre de SF Symbol —que sólo pinta iOS— o un `ImageSourcePropType`, un
 * recurso de dibujo. Nomey guarda una clave semántica (ADR-027) que resuelve a
 * un par `{ ios, android }` de `expo-symbols`, y el lado Android de ese par es
 * el nombre de un símbolo de Material, no un recurso. Aquí, que es la
 * implementación de Android, no hay nada admisible que mandar, así que el menú
 * va con texto — lo que hace su propio sistema — y no con un icono roto.
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

  const actions: MenuAction[] = categoryOptions(categories, selected, t).map((option) => ({
    id: option.id,
    title: option.title,
    /*
     * EL ESTADO LO EXPONE LA API NATIVA, no un color.
     *
     * `'on'` pinta el check del sistema, que es además lo que VoiceOver y
     * TalkBack leen como seleccionado. Marcarlo con un tono habría dejado la
     * selección invisible para quien no ve la pantalla.
     */
    state: option.selected ? 'on' : 'off',
  }));

  return (
    <MenuView
      title={t('entry.categoryTitle')}
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        /*
         * El identificador vuelve tal cual se mandó —`action.id`—, así que el
         * UUID no se reconstruye por posición: reordenar el catálogo no puede
         * elegir otra categoría.
         */
        onSelect(nativeEvent.event);
      }}
      style={styles.trigger}>
      {/*
       * El trigger es el MISMO botón de antes. Lo que se le quita es su propio
       * `onPress`: la pulsación la gobierna el menú nativo, y dos manejadores
       * sobre la misma vista se disputarían el toque.
       *
       * **Este envoltorio NO pinta.** Sin fondo, sin borde, sin radio y sin
       * sombra: existe sólo para llevar el rol y la etiqueta de accesibilidad,
       * que `MenuComponentProps` no admite. La profundidad pertenece a la
       * superficie que tiene la geometría real —el `GlassSurface` circular— y
       * cualquier sombra puesta aquí sería rectangular por construcción, porque
       * ésta es la caja del trigger y no el círculo.
       */}
      <View accessibilityRole="button" accessibilityLabel={label}>
        <CategoryTrigger icon={icon} chosen={chosen} size={size} />
      </View>
    </MenuView>
  );
}

const styles = StyleSheet.create({
  trigger: {
    // El trigger mide lo que mida el círculo. Sin esto el envoltorio se estira
    // y el ancla del menú deja de coincidir con lo que se ve.
    alignSelf: 'flex-start',
  },
});
