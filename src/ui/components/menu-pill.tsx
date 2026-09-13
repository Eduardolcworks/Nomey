import { StyleSheet, View } from 'react-native';

import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import { GlassSurface } from './glass-surface';
import { Icon } from './icon';
import { ThemedText } from './themed-text';

/**
 * EL OBLONGO QUE DESPLIEGA UN MENÚ: texto a la izquierda, galón a la derecha.
 *
 * **Es el material aprobado de los controles de la ventana**, el mismo que el
 * campo de concepto y los dos círculos de su fila: `control` sobre `regular`,
 * relieve `well`, rim `soft` y extremos completamente redondeados. No hay ningún
 * token nuevo aquí, y por eso el oblongo y el campo que tiene encima se leen
 * como la misma familia.
 *
 * **Sin interacción propia.** El gesto pertenece al menú que lo aloja —
 * `OptionMenu`—; un `Pressable` aquí se lo disputaría. Es exactamente el reparto
 * que ya usa el botón de categoría.
 *
 * ═══════════ EL GALÓN NO SE VA NUNCA ═══════════
 *
 * «Pagado por Maripuri de la Concepción» no cabe, y lo que tiene que ceder es el
 * NOMBRE, no el galón: sin él el control deja de anunciar que se despliega, y
 * sin el `minWidth: 0` un nombre largo ensancharía la columna del texto —el
 * ancho mínimo de un contenedor flexible es el de su contenido— y empujaría al
 * galón fuera, o al oblongo de al lado. Con las tres cosas juntas —`flex: 1`,
 * `minWidth: 0` y una sola línea— el nombre se recorta con elipsis y todo lo
 * demás se queda donde estaba.
 */
export function MenuPill({
  text,
  label,
  muted = false,
  width,
}: {
  readonly text: string;
  /**
   * Lo que anuncia el control, con la opción vigente dentro.
   *
   * **Aquí y no en el menú que lo aloja.** `OptionMenu` pone encima una capa
   * nativa que no llega al árbol de accesibilidad; lo que sí llega es esto, que
   * además es lo que se ve. La etiqueta es más completa que el texto: el oblongo
   * puede recortar «Pagado por Maripuri…» y quien escucha oye el nombre entero.
   */
  readonly label: string;
  /**
   * Todavía no hay nada elegido.
   *
   * Se pinta en el tono de un campo sin rellenar, que es lo que es. No se
   * inventa un valor por defecto para que el control parezca resuelto.
   */
  readonly muted?: boolean;
  /**
   * UN ANCHO EXPLÍCITO, cuando quien compone la fila ya lo ha medido.
   *
   * **Existe porque `MenuView` no cede.** Es un anfitrión de Compose, y se
   * mide POR SU CONTENIDO: el flexbox de React Native no lo atraviesa, así
   * que dos oblongos hermanos con textos largos salen cada uno con el ancho
   * de sus palabras y se solapan — medido con `uiautomator`: 518 y 529 px
   * dentro de una tarjeta de 870, con 72 px de solape. Ni `flex: 1` ni
   * `minWidth: 0` en la columna lo evitan, porque el que no cede está dentro.
   *
   * Lo que sí respeta es el tamaño de su propio hijo, y eso es esto: fijado
   * el ancho del oblongo, el anfitrión mide lo mismo. Sin la prop, el
   * montaje es el de siempre y ninguna llamada anterior cambia.
   */
  readonly width?: number;
}) {
  const theme = useTheme();

  return (
    <GlassSurface
      material="control"
      level="regular"
      depth="well"
      rim="soft"
      radius={Radius.full}
      /* Superficie de control: se toca. El cristal en vivo no le corresponde. */
      nativeEffect={false}
      /*
       * `accessible` explícito: en Android un `View` con rol y etiqueta pero sin
       * él NO abre un nodo propio —medido: los dos oblongos se fundían en el nodo
       * del panel—. Con él, cada uno es un objetivo, y uno solo: sus hijos dejan
       * de anunciarse por separado.
       */
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.pill, width === undefined ? null : { width }]}>
      <ThemedText
        variant="label"
        themeColor={muted ? 'textDisabled' : 'text'}
        numberOfLines={1}
        /*
         * EL GALÓN NO SE VA NUNCA, y con un ancho declarado hay que decirlo
         * con un número. Dentro de un anfitrión de Compose, `flex: 1` más
         * `minWidth: 0` no bastan: el hijo se mide sin cota y el texto largo
         * empujaba al galón fuera del oblongo — medido. El tope sale de restar
         * a su propio ancho los tokens de este mismo oblongo, no los de nadie
         * más: relleno a los dos lados, el hueco y el lado reservado del galón.
         */
        style={[
          styles.text,
          width === undefined ? null : { maxWidth: width - Spacing.md * 2 - Spacing.sm - CHEVRON },
        ]}>
        {text}
      </ThemedText>
      {/*
       * EL GALÓN, EN SU PROPIA CAJA Y CON SITIO RESERVADO.
       *
       * Suelto en la fila desaparecía: medido en el emulador, «Elige quién pagó»
       * consumía el ancho del oblongo y el galón salía con cero puntos —el
       * control dejaba de anunciar que se despliega, que es justo lo que no puede
       * pasar—. Con una caja de su tamaño y `flexShrink: 0` el que cede es el
       * texto, que para eso lleva `minWidth: 0` y una sola línea.
       */}
      <View style={styles.chevron}>
        <Icon name={Symbols.expand} size={CHEVRON} colour={theme.textSecondary} />
      </View>
    </GlassSurface>
  );
}

/** El lado del galón. Reservado, para que nunca ceda su sitio. */
const CHEVRON = 16;

/** El alto de los controles de esta fila, el mismo que el campo de concepto. */
export const PILL_HEIGHT = 52;

const styles = StyleSheet.create({
  pill: {
    /*
     * Se estira a lo ancho de su hueco: el reparto lo hace `OptionMenu`, que le
     * da un hermano flexible del que este oblongo hereda el ancho. Aquí no se
     * mide nada ni se declara ninguna cifra horizontal.
     */
    alignSelf: 'stretch',
    height: PILL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  chevron: {
    width: CHEVRON,
    height: CHEVRON,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
