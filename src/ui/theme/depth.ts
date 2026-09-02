import { Platform } from 'react-native';

import {
  AndroidSurface,
  Glass,
  RimBlurAndroid,
  RimBlurIOS,
  TactileAndroid,
  TactileIOS,
  type TactileState,
  TranslucentControlAndroid,
} from './elevation';
import type { BoxShadowValue } from 'react-native';

/**
 * LA PROFUNDIDAD DE ESTA PLATAFORMA, elegida en un solo sitio.
 *
 * `elevation.ts` guarda las dos calibraciones como datos puros —sin React
 * Native en ejecucion, para que se puedan comprobar sin montar nada— y aqui se
 * escoge cual rige. Quien consume `Tactile` no elige ni sabe cual le ha tocado,
 * que es lo que impide que aparezcan sombras por componente.
 */
export const Tactile: Record<TactileState, readonly BoxShadowValue[]> =
  Platform.OS === 'android' ? TactileAndroid : TactileIOS;

/** Cuanto se extiende la luz del borde superior en esta plataforma. */
export const RimBlur = Platform.OS === 'android' ? RimBlurAndroid : RimBlurIOS;

/**
 * LAS DOS MITADES DE UNA PROFUNDIDAD, separadas por lo que ya son.
 *
 * Un estado táctil es un sombreado que va DENTRO de la superficie más, en
 * algunos casos, una sombra que cae FUERA, sobre el suelo. Son entradas
 * distintas del mismo token, así que separarlas es filtrarlas — no reescribir
 * valores ni aproximarlos, que es lo que las volvería dos verdades.
 *
 * `pressed` no tiene mitad exterior — un control hundido no proyecta— y por eso
 * `castShadow` devuelve una lista vacía para él en vez de inventarle una.
 */
export function castShadow(state: TactileState): readonly BoxShadowValue[] {
  return outerHalf(Tactile[state]);
}

/** El sombreado que la superficie se aplica a sí misma. */
export function innerShading(state: TactileState): readonly BoxShadowValue[] {
  return innerHalf(Tactile[state]);
}

/**
 * EL MISMO CORTE, SOBRE UNA LISTA CUALQUIERA.
 *
 * Las dos funciones de arriba son este filtro aplicado a un estado táctil. Se
 * expone porque hay otra lista que necesita exactamente el mismo corte: la
 * LENTE de un material —`Glass.action.lens` es la del `+`— que mezcla brillos
 * interiores con un halo que sí proyecta hacia fuera.
 *
 * Que sea el mismo filtro y no una copia es lo que impide que un día una mitad
 * se defina por una regla y la otra por otra.
 */
export function outerHalf(layers: readonly BoxShadowValue[]): readonly BoxShadowValue[] {
  return layers.filter((layer) => layer.inset !== true);
}

/** La otra mitad del mismo corte. */
export function innerHalf(layers: readonly BoxShadowValue[]): readonly BoxShadowValue[] {
  return layers.filter((layer) => layer.inset === true);
}

/**
 * EL MATERIAL DE UNA TARJETA ESTRUCTURAL DE INICIO.
 *
 * En iOS devuelve el del tema, tal cual: esa superficie no cambia. En Android
 * devuelve el rol, porque alli falta el material que en iOS la separa del fondo.
 *
 * **Lo piden la tarjeta Y el hueco del donut**, que es esa misma superficie
 * vista por un agujero. Al salir los dos de aqui no pueden desincronizarse.
 *
 * Es un rol, no un nivel: las ventanas y los controles conservan su material y
 * no pasan por aqui, aunque compartan primitive.
 */
export function homeCardSurface(delTema: string): string {
  return Platform.OS === 'android' ? AndroidSurface.homeCard : delTema;
}

/**
 * EL RELIEVE DE UNA TARJETA DE INICIO EN ANDROID.
 *
 * **No repone una capa perdida: nunca hubo ninguna.** Estas tarjetas son `View`
 * planas con su color y su borde — jamas pasaron por `GlassSurface`, ni tuvieron
 * rim ni desenfoque. Lo que las hacia leerse como cristal era el BORDE contra un
 * fondo casi negro: `#2A2A2A` sobre `#0C0C0C` son treinta puntos.
 *
 * Al subir la tarjeta a `#1C1C1E` esa diferencia cayo a catorce, y con un borde
 * de medio pixel dejo de verse. La tarjeta quedo como un rectangulo opaco.
 *
 * Asi que Android recibe lo que necesita para volver a delimitarse: un borde
 * fino de verdad, el resalte superior que antes hacia el propio canto, y la
 * sombra exterior corta que ya define `Tactile.well` — **sin numeros nuevos de
 * sombra**, que la calibracion global sigue en pausa.
 *
 * **En iOS es `undefined`.** Un `undefined` en un array de estilos no anade
 * nada: ni capa, ni rama, ni arbol distinto. Alli la tarjeta es exactamente la
 * que era.
 */
export const HomeCardRelief =
  Platform.OS === 'android'
    ? {
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.16)',
        boxShadow: [
          // El resalte superior, difuminado lo justo para ser luz y no contorno.
          {
            offsetX: 0,
            offsetY: 1,
            blurRadius: RimBlur.catch,
            color: 'rgba(255, 255, 255, 0.10)',
            inset: true,
          },
          ...castShadow('well'),
        ],
      }
    : undefined;

/**
 * LA SOMBRA QUE LA PROPIA VISTA LLEVA, segun la plataforma.
 *
 * **iOS devuelve el token entero**, que es la composicion aprobada: Core
 * Animation funde las capas de un `boxShadow` sobre una sola vista con una
 * caida continua, y separarlas alli no arreglaria nada y cambiaria el arbol.
 *
 * **Android devuelve solo la mitad interior.** Su renderizador no funde la
 * lista: dibuja cada entrada como una silueta independiente, y una proyeccion
 * corta y opaca sobre la misma vista que pinta fondo, borde y radio se lee como
 * un contorno duro. La mitad exterior se va a `DepthLayer`, una vista que no
 * recorta y que no hace nada mas.
 *
 * Las dos mitades son entradas del MISMO token —ver `castShadow` y
 * `innerShading`—, asi que esto reparte, nunca reescribe ni aproxima.
 */
export function surfaceDepth(state: TactileState): readonly BoxShadowValue[] {
  return Platform.OS === 'android' ? innerShading(state) : Tactile[state];
}

/**
 * LA PROFUNDIDAD DE UNA CAPA DE ÉNFASIS TRANSLÚCIDA.
 *
 * **En Android, ninguna.** El sombreado interior de `selected` era lo que ponía
 * una franja negra dentro de la píldora seleccionada del dock: un `inset` con
 * desplazamiento negativo oscurece el interior de arriba abajo, y sobre un
 * relleno translúcido eso no se lee como relieve sino como suciedad.
 *
 * **En iOS devuelve su token entero**, que es la composición aprobada.
 *
 * Sirve a cualquier control translúcido, no sólo al dock: el avatar de Perfil
 * cambia de fondo al pulsarlo y tampoco puede recibir un relleno opaco, así que
 * necesita exactamente esto — su relleno intacto y sin sombra interior.
 */
export function emphasisDepth(state: TactileState = 'selected'): readonly BoxShadowValue[] {
  return Platform.OS === 'android' ? [] : Tactile[state];
}

/**
 * Y el canto de esa misma capa.
 *
 * Android usa el rim de los controles translúcidos —el mismo de todo el
 * perímetro, sin acento— y iOS conserva el resalte del material que ya tenía.
 */
export const EmphasisRim =
  Platform.OS === 'android' ? TranslucentControlAndroid.rim : Glass.regular.highlight;

/**
 * EL BORDE PROPIO DEL CONSUMIDOR, apagado en Android y sólo ahí.
 *
 * Un control que monta `ControlMaterial` recibe su rim de esa capa. Si además
 * conserva su propio `borderColor`, quedan **dos hilos superpuestos** de un
 * píxel cada uno: el del host y el del material. Aquí el del host se retira, de
 * modo que la única línea es la aprobada.
 *
 * En iOS el material no monta nada, así que el borde del consumidor es el único
 * que hay y se devuelve intacto.
 */
export function controlEdge(colour: string): string {
  return Platform.OS === 'android' ? 'transparent' : colour;
}
