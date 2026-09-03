import { StyleSheet, View, type BoxShadowValue } from 'react-native';

import {
  Glass,
  GlassAndroid,
  innerHalf,
  outerHalf,
  Radius,
  RimBlur,
  TactileAndroid,
  TranslucentControlAndroid,
} from '@/ui/theme';

import { ControlMaterial } from './control-material';
import type { GlassRim, GlassSurfaceProps } from './glass-surface-props';
import { WindowMaterial } from './window-material';

export type { GlassRim, GlassSurfaceProps } from './glass-surface-props';

/**
 * LA MISMA SUPERFICIE, CON LA TOPOLOGÍA QUE ANDROID NECESITA.
 *
 * ====================== LA CAUSA, MEDIDA SOBRE EL APARATO ===================
 *
 * Android **no funde** las capas de un `boxShadow`: dibuja una silueta
 * independiente por entrada. Con la proyección, el rim, el sombreado interior y
 * la lente del material en la misma lista, y sobre la misma vista que pinta el
 * fondo, el borde, el radio y —cuando hay `clip`— la máscara, lo que sale no es
 * una caída sino un contorno de canto duro. Es el mismo token que en iOS se ve
 * como profundidad.
 *
 * En iOS eso no pasa —Core Animation compone la lista entera en un solo paso—,
 * y por eso su implementación vive en `glass-surface.tsx` con UNA vista y sin
 * una sola rama de plataforma. Metro elige por extensión.
 *
 * ============================ LAS CUATRO CAPAS ==============================
 *
 * Cada una hace UNA cosa, y ninguna hace dos:
 *
 * 1. **`shadowHost`** — la vista exterior. Lleva el radio del control y **toda**
 *    proyección hacia fuera: la del estado y la de la lente del material. No
 *    lleva fondo, ni borde, ni relieve.
 * 2. **`surface`** — el material: tinte, y la máscara redondeada cuando se pide.
 * 3. **`rim`** — el borde fino y el resalte interior, más el sombreado interior
 *    del estado y las lentes `inset`. Todo lo que va HACIA DENTRO, junto.
 * 4. **`content`** — los hijos, que siguen siendo hijos directos del host.
 *
 * ================= POR QUÉ EL HOST ES EL DE FUERA Y NO UN PADRE =============
 *
 * El host **recibe el `style` de quien llama** y los hijos siguen colgando de
 * él, exactamente como cuando había una sola vista. Eso es deliberado: el
 * `style` trae `padding`, `gap`, `minHeight`, `flexDirection` y a veces medidas,
 * y envolverlo en un contenedor nuevo habría cambiado el reparto de cada
 * consumidor. Lo que se movió es el MATERIAL, a una capa en `absoluteFill`
 * detrás del contenido — no el contenido a una capa dentro del material.
 *
 * Resultado: **ni una medida cambia**, y aun así la proyección vive en una vista
 * que no es la que pinta el material ni la que lo recorta.
 *
 * ======================= EL RECORTE NO SE COME LA SOMBRA ====================
 *
 * `overflow: 'hidden'` recorta HIJOS, no lo que la propia vista dibuja fuera de
 * sus límites. El host puede llevar máscara y proyección a la vez, y por eso el
 * CTA —el único consumidor de `clip`— ya no es un caso aparte.
 */
export function GlassSurface({
  level = 'regular',
  depth = 'raised',
  rim = 'catch',
  radius = Radius.lg,
  // El efecto nativo no existe en Android: `isLiquidGlassAvailable()` es false.
  // Se recoge para no romper a quien lo pasa, y no se mira.
  nativeEffect: _nativeEffect = true,
  castsShadow = true,
  clip = false,
  disabled = false,
  material = 'surface',
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  /*
   * EL MATERIAL, con la calibración de Android encima.
   *
   * Un sobreescrito parcial sobre el token compartido: lo que `GlassAndroid` no
   * nombra llega tal cual. Así el material sigue siendo UNO, definido en el
   * tema, y aquí sólo se resuelve qué cifras usa este renderizador.
   */
  const token = { ...Glass[level], ...GlassAndroid[level] };
  const estado = resolverEstado(depth, disabled);

  /*
   * UNA VENTANA NO ES UN CONTROL NI UNA SUPERFICIE DE CRISTAL.
   *
   * La rama de superficie le daba el token de profundidad de `selected`, y sus
   * dos mitades eran el defecto: la interior oscurecia el panel de arriba abajo
   * —29 · 25 · 22, medido— y la exterior le ponia una sombra alrededor. Aqui no
   * hay ninguna: un gris plano, un rim completo, y el host sin proyectar nada.
   */
  if (material === 'window') {
    return (
      <View style={[{ borderRadius: radius }, clip ? styles.mask : null, style]} {...rest}>
        <WindowMaterial radius={radius} />
        {children}
      </View>
    );
  }

  /*
   * UN CONTROL NEUTRO NO LLEVA CRISTAL, y esa es la conclusion del laboratorio.
   *
   * Con `material="control"` la superficie deja de componer tinte, borde, rim,
   * sombreado interior, lente y proyeccion, y monta en su lugar el material
   * aprobado: relleno plano y un reflejo de un pixel arriba. No es apagar
   * capas una a una — es OTRO material, y por eso se decide aqui arriba.
   *
   * Las superficies —ventanas, paneles, tarjetas, el fondo del dock— no pasan
   * por esta rama y conservan exactamente lo que tenian.
   */
  /*
   * UN CONTROL QUE NO PUEDE VOLVERSE OPACO.
   *
   * La pildora seleccionada del dock vive sobre el cristal del dock, y el CTA
   * apagado es transparente a proposito. Darles el gris solido les quitaba
   * justo lo que los define, asi que aqui se conserva el tinte y el alfa de su
   * nivel y lo unico que se retira son las sombras interiores —el inset del
   * estado era la franja negra— y la proyeccion exterior.
   *
   * El borde del token tampoco se pinta: el rim es una capa aparte, y dos
   * lineas superpuestas serian un borde doble.
   */
  if (material === 'translucent-control') {
    return (
      <View style={[{ borderRadius: radius }, clip ? styles.mask : null, style]} {...rest}>
        <View
          pointerEvents="none"
          style={[styles.material, { backgroundColor: token.tint, borderRadius: radius }]}
        />
        <View
          pointerEvents="none"
          style={[styles.material, styles.rimTranslucido, { borderRadius: radius }]}
        />
        {children}
      </View>
    );
  }

  if (material === 'control') {
    return (
      <View style={[{ borderRadius: radius }, clip ? styles.mask : null, style]} {...rest}>
        <ControlMaterial radius={radius} />
        {children}
      </View>
    );
  }

  return (
    <View
      style={[
        // 1 · HOST: el radio y TODA la proyección. Nada más.
        { borderRadius: radius, boxShadow: proyeccion(estado, castsShadow, token.lens) },
        clip ? styles.mask : null,
        style,
      ]}
      {...rest}>
      {/* 2 y 3 · MATERIAL y RIM, detrás del contenido y fuera del reparto. */}
      <View
        pointerEvents="none"
        style={[
          styles.material,
          {
            backgroundColor: token.tint,
            borderColor: token.border,
            borderRadius: radius,
            boxShadow: haciaDentro(estado, rim, token.highlight, token.lens),
          },
        ]}
      />
      {/* 4 · CONTENIDO. */}
      {children}
    </View>
  );
}

/**
 * El estado táctil que Android resuelve, con `disabled` como uno más.
 *
 * **`disabled` es exclusivo de Android y no está en `TactileState`.** Añadirlo
 * al tipo compartido habría obligado a darle una entrada a `TactileIOS`, que
 * está congelado, así que vive aquí y en `TactileAndroid`, y nadie fuera de este
 * fichero puede pedirlo.
 *
 * `flat` sigue queriendo decir «sin profundidad», y deshabilitado no lo cambia:
 * una superficie que no tenía relieve no gana uno al apagarse.
 */
type EstadoAndroid = keyof typeof TactileAndroid | 'flat';

function resolverEstado(depth: GlassSurfaceProps['depth'], disabled: boolean): EstadoAndroid {
  if (depth === 'flat') return 'flat';
  return disabled ? 'disabled' : (depth ?? 'raised');
}

/**
 * TODO lo que la superficie lanza hacia fuera, en la vista que no recorta.
 *
 * Dos orígenes y una sola lista:
 *
 * - **el `cast` del estado**, que es la profundidad del control;
 * - **las entradas `outset` de la lente del material**, que en el nivel `action`
 *   son el halo ámbar del `+`. Pertenecen a la acción y por eso se conservan,
 *   pero proyectan igual que cualquier otra sombra y no pueden quedarse en la
 *   vista del material sumándose a su borde.
 *
 * **Una sola proyección oscura por estado.** `castShadow` filtra el token, que
 * tiene exactamente una entrada exterior por estado; el halo de color no cuenta
 * como segunda sombra oscura porque no es oscura.
 */
function proyeccion(
  estado: EstadoAndroid,
  casts: boolean,
  lens: readonly BoxShadowValue[] | undefined,
): BoxShadowValue[] {
  const oscura = casts && estado !== 'flat' ? outerHalf(TactileAndroid[estado]) : [];
  return [...oscura, ...outerHalf(lens ?? [])];
}

/**
 * TODO lo que va hacia dentro, en la capa del material.
 *
 * El rim primero —el resalte de arriba se ve en todos los estados—, después el
 * sombreado interior del estado, y debajo las lentes `inset` como material sobre
 * el que actúan los estados. Es el mismo orden que compone iOS; lo único que
 * cambia es que aquí no comparte vista con la proyección.
 */
function haciaDentro(
  estado: EstadoAndroid,
  rim: GlassRim,
  highlight: string,
  lens: readonly BoxShadowValue[] | undefined,
): BoxShadowValue[] {
  return [
    ...rimShadow(rim, highlight),
    ...(estado === 'flat' ? [] : innerHalf(TactileAndroid[estado])),
    ...innerHalf(lens ?? []),
  ];
}

/**
 * The top-edge light, at the requested hardness.
 *
 * El difuminado es todo el mecanismo: a 0 el desplazamiento dibuja una línea
 * dura que envuelve las esquinas y se acumula en ellas; repartido sobre unos
 * puntos se vuelve un lavado a lo largo del canto superior.
 */
function rimShadow(rim: GlassRim, highlight: string): BoxShadowValue[] {
  if (rim === 'none') return [];
  return [
    {
      offsetX: 0,
      offsetY: 1,
      blurRadius: rim === 'soft' ? RimBlur.soft : RimBlur.catch,
      color: highlight,
      inset: true,
    },
  ];
}

const styles = StyleSheet.create({
  /**
   * El material cubre la superficie entera sin ocupar sitio ni recibir toques.
   *
   * **Queda detrás por ORDEN, no por `zIndex`.** Es el primer hijo, y Android
   * dibuja en ese orden. Se intentó con `zIndex: -1` y el resultado fue que la
   * capa no se pintaba en absoluto —medido: la chapa de Deudas se quedó sin su
   * caja—, porque un hijo con z negativo no tiene dónde ir dentro de un padre
   * sin fondo propio.
   */
  material: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: StyleSheet.hairlineWidth,
  },
  /** El rim continuo de un control translucido: un color, toda la vuelta. */
  rimTranslucido: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TranslucentControlAndroid.rim,
  },
  /** Recorta a los HIJOS. Lo que el host proyecta fuera no lo toca. */
  mask: {
    overflow: 'hidden',
  },
});
