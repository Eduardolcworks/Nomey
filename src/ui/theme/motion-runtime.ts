import {
  ReduceMotion,
  SlideInDown,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Motion } from './motion';

/**
 * Donde los números de `motion.ts` se convierten en animación.
 *
 * El reparto entre los dos ficheros tiene una consecuencia que conviene decir
 * entera: **`ReduceMotion.System` se escribe aquí, una sola vez.**
 *
 * Ése es todo el mecanismo de accesibilidad. Reanimated salta directamente al
 * valor final cuando el ajuste del sistema está puesto, así que el estado sigue
 * cambiando y cambiando con claridad —la profundidad, la opacidad y la
 * selección aterrizan igual—, sólo que aterriza al instante. Ningún componente
 * tiene que acordarse, y ninguno puede olvidarlo en silencio: la única forma de
 * perderlo es dejar de usar estas configs y escribir una a mano, y eso se ve en
 * un diff. Hay una guarda que lo comprueba sobre todo `src/`.
 *
 * **Vivía en `features/shell`**, que es donde nacieron los tres primeros
 * controles que lo necesitaban. Sube aquí porque `GlassPressable` es del
 * sistema de diseño y `ui/` no puede importar de `features/` —la dirección de
 * dependencias es de una sola vía—, y porque `features/personal` tampoco puede
 * importar de `features/shell`. Con dos consumidores en capas distintas, la
 * alternativa era una segunda copia de la declaración, que es exactamente lo
 * que hace que un ajuste de accesibilidad se pierda por la mitad de la app.
 * `features/shell/shell-motion.ts` lo reexporta, así que ningún consumidor
 * cambió.
 *
 * **`motion.ts` sigue libre de Reanimated** para que los tests puedan
 * ejecutarlo. Por eso son dos ficheros y no uno.
 *
 * La transición de pantalla es la excepción y no cabe aquí, porque es del
 * navegador de tabs y no de Reanimated: lee el mismo ajuste, explícitamente, en
 * `app/(tabs)/_layout.tsx`.
 */

/** El único muelle. */
export const SPRING = { ...Motion.spring, reduceMotion: ReduceMotion.System } as const;

/**
 * Una hoja que entra desde abajo, con el muelle del sistema.
 *
 * Es una animación DECLARATIVA y no un valor compartido escrito en un efecto, y
 * la diferencia no es de estilo: `react-hooks/immutability` sólo admite un punto
 * de escritura por valor compartido, y la ventana del `+` ya necesita el suyo
 * para bajar al cerrar. Con la entrada declarada aquí, ese presupuesto se gasta
 * una sola vez.
 *
 * Lleva `ReduceMotion.System` como todo lo demás de este fichero: con el ajuste
 * puesto, la hoja aparece en su sitio en vez de subir.
 */
export const SLIDE_IN = SlideInDown.springify()
  .mass(Motion.spring.mass)
  .damping(Motion.spring.damping)
  .stiffness(Motion.spring.stiffness)
  .reduceMotion(ReduceMotion.System);

/** Un `timing` que respeta el ajuste, para lo que un muelle pasaría de largo. */
export function timing(duration: number) {
  return { duration, reduceMotion: ReduceMotion.System } as const;
}

const PRESS = timing(Motion.press.duration);

/**
 * El acuse de recibo de un toque, compartido por todo control que se pulse.
 *
 * **Bajar es un `timing` corto y subir es el muelle.** Pulsar debe notarse
 * inmediato; soltar debe parecer que el objeto vuelve. Un muelle en la bajada
 * añade latencia justo en el momento en que alguien espera la confirmación de
 * que su toque ha entrado.
 *
 * Es hook y no token porque el valor tiene que ser de cada control. Y el valor
 * se escribe **dentro** del hook y no en el JSX de quien llama: no es estilo,
 * es que `react-hooks/immutability` rechaza modificar un valor compartido desde
 * un manejador escrito en línea.
 *
 * Quien llama extiende `handlers` sobre su `Pressable` y lee `scale` en su
 * propio `useAnimatedStyle`. Esto no sabe qué está animando, y hasta ahí llega
 * la abstracción.
 */
export function usePressScale() {
  const scale = useSharedValue(1);

  return {
    scale,
    handlers: {
      onPressIn: () => {
        scale.value = withTiming(Motion.press.scale, PRESS);
      },
      onPressOut: () => {
        scale.value = withSpring(1, SPRING);
      },
    },
  };
}
