import { BlurView } from 'expo-blur';
import type { RefObject } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

/**
 * El fondo de una ventana modal: lo que queda de la pantalla de detrás.
 *
 * **Antes esto era sólo un velo negro, y por eso el fondo se veía negro.** La
 * versión anterior pintaba `rgba(0, 0, 0, 0.34)` y encima le superponía un
 * `GlassView` de `expo-glass-effect` — que no desenfoca nada salvo con Liquid
 * Glass, y cuya comprobación de disponibilidad es literalmente `return false`
 * fuera de iOS. Es decir: no había desenfoque en ninguna parte, sólo
 * oscurecimiento, que es exactamente el efecto que no se quería.
 *
 * **El desenfoque es ahora lo principal y la atenuación lo secundario**, en ese
 * orden y con esos pesos. `BlurView` desenfoca de verdad lo que tiene detrás, y
 * como la ruta se presenta transparente lo que tiene detrás es Inicio, montado
 * y vivo. Encima va un velo muy tenue cuyo único trabajo es separar la ventana
 * del fondo; si subiera, volvería a comerse el efecto.
 *
 * **Reconocible pero ilegible** es el objetivo, y de ahí sale la intensidad: a
 * 70 sobre 100 se distinguen las masas —la tarjeta del Disponible, las cifras,
 * el reparto por categorías— sin que ninguna se pueda leer.
 *
 * **Android no se deja atrás.** Su método por defecto (`'none'`) es un relleno
 * semitransparente, no un desenfoque; con `dimezisBlurViewSdk31Plus` sí
 * desenfoca de verdad a partir de Android 12. Por debajo de esa versión
 * degrada a la atenuación, que es lo que el sistema puede dar.
 *
 * **Y no envuelve a la ventana.** Es hermano del panel, no su padre, así que el
 * modal queda completamente nítido: texto, cifra, controles y vidrio.
 *
 * **ANDROID NECESITA QUE SE LE DIGA QUÉ DESENFOCAR.** iOS desenfoca lo que tiene
 * detrás por composición del sistema; el método de Android no puede: dibuja a
 * partir de una vista concreta, y sin ella avisa —«blurTarget prop has not been
 * configured»— y **degrada a `none`**, que es un relleno semitransparente. O
 * sea: sin objetivo no había desenfoque en Android, sólo oscurecimiento, que es
 * exactamente el efecto que este componente existe para no hacer.
 *
 * El objetivo lo pone quien sabe qué hay detrás —la capa de las pestañas—, no
 * esta pieza, que no puede saberlo. Y **el fondo nunca es su propio objetivo**:
 * se desenfocaría a sí mismo.
 */
/**
 * EL PUNTO DE SIEMPRE: el de las ventanas de Personal, aprobadas así.
 *
 * Era un literal dentro del componente y ahora es una constante con nombre.
 * **El valor no cambia**, y esa es la mitad importante: pasar la intensidad por
 * `prop` existe para que una ventana concreta pueda pedir otra cosa, no para
 * mover el defecto por debajo de lo que ya está revisado.
 *
 * Lo que sí se midió aquí es su límite. Comparando la misma zona con la ventana
 * cerrada y abierta, la energía de borde del texto de detrás baja a 0,51× pero
 * la luminancia baja a 0,67×, así que la nitidez RELATIVA sólo cae a 0,75×: a
 * este punto una ventana que tapa casi toda la pantalla se lee bien, y una
 * superficie que deja dos tercios de fondo a la vista no separa lo suficiente.
 * De ahí `SHEET_BLUR_INTENSITY`, y de ahí que no se toque este número.
 */
export const BLUR_INTENSITY = 70;

/**
 * El punto de una ventana que sólo cubre PARTE de la pantalla.
 *
 * Una ventana centrada tapa casi todo, así que puede desenfocar fuerte: lo poco
 * que asoma sólo tiene que dejar de competir. Una hoja inferior ocupa un tercio
 * y deja dos detrás, y ahí el fondo tiene que seguir reconociéndose — el título,
 * el estado vacío, sus controles — o la pantalla parece haberse apagado.
 *
 * Medido entre los dos extremos sobre el mismo estado de Grupos, comparando
 * cerrado contra abierto en la zona del texto blanco de detrás: a 100 la
 * luminancia del texto caía a 0,53× y su energía de borde a 0,29×, que es lo
 * que hacía desaparecer las letras; a 70 la nitidez relativa apenas se movía y
 * se leía como oscurecimiento. Éste es el punto intermedio, y vive aquí —y no
 * en la feature— porque `features/` no puede importarse entre sí y quien
 * enciende el fondo es el dock.
 */
export const SHEET_BLUR_INTENSITY = 85;

export function Scrim({
  target,
  intensity = BLUR_INTENSITY,
}: {
  readonly target?: RefObject<View | null>;
  /** El punto de desenfoque de ESTA ventana. Por defecto, el de siempre. */
  readonly intensity?: number;
}) {
  return (
    <View style={styles.canvas} pointerEvents="none">
      <BlurView
        intensity={intensity}
        tint="dark"
        /*
         * `blurMethod` y no `experimentalBlurMethod`: el segundo está marcado
         * como obsoleto en la versión instalada, y son el mismo valor.
         */
        blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined}
        blurTarget={target}
        style={styles.blur}
      />
      <View style={styles.veil} />
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  blur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  /**
   * La atenuación, deliberadamente floja.
   *
   * Estuvo al 62 % —Inicio no se reconocía— y luego al 34 % sin desenfoque
   * detrás, que seguía leyéndose como un fondo negro.
   *
   * **Ahora al 6 %, y es deliberadamente poco.** Es la primera vez que el
   * desenfoque puede funcionar de verdad —el fondo se dibuja donde Inicio
   * existe—, y con el velo alto no habría forma de distinguir «desenfoca» de
   * «oscurece». Si al verlo hace falta más separación entre la ventana y el
   * fondo, se sube; pero el efecto principal tiene que venir del desenfoque.
   */
  veil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
  },
});
