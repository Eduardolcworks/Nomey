import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { SPRING, timing } from '@/ui/theme/motion-runtime';
import { Motion, type PlatformSymbol, Radius, Spacing, useTheme } from '@/ui/theme';

import { GlassSurface } from './glass-surface';
import { Icon } from './icon';

const SEGMENT = 64;
const HEIGHT = 54;
const PAD = Spacing.xs;

/** Una clase del selector, ya con su glifo, su tono y su etiqueta traducida. */
export type KindOption<K extends string> = {
  readonly key: K;
  /** El par `{ ios, android }`: un nombre suelto es un SF Symbol y sólo pinta iOS. */
  readonly glyph: PlatformSymbol;
  /** El color del indicador cuando esta clase está elegida. */
  readonly tone: string;
  /** Ya traducida. Este control no conoce el catálogo. */
  readonly label: string;
};

/**
 * LAS CLASES DE UNA OPERACIÓN, EN UN SOLO OBLONGO.
 *
 * **Sólo la elegida lleva color.** Rojo, verde y azul son semántica financiera,
 * y varios colores encendidos a la vez no dicen «elige uno», dicen «hay varias
 * cosas importantes». Las demás se quedan en el gris del sistema, que es lo que
 * hace que la elegida se lea sin tener que buscarla.
 *
 * **Y el color nunca es la única señal.** Cada segmento lleva su glifo, y el
 * elegido además crece, se adelanta sobre el vidrio y recibe el relleno teñido.
 * `design-direction.md` §8 no admite que un estado dependa de un color, y menos
 * del peor par posible: rojo contra verde, que alrededor de una de cada doce
 * personas no distingue.
 *
 * **El indicador se desliza; los segmentos no se mueven de sitio.** Una sola
 * vista animada viaja por debajo, así que el cambio se lee como un objeto que se
 * desplaza y no como varios que parpadean. Es también lo que mantiene todo en el
 * hilo de UI: lo que se interpola es una traslación y una escala, y `boxShadow`
 * —que no es interpolable— cambia de golpe, que es justamente lo que un cambio
 * de profundidad debe hacer.
 *
 * **Y el indicador es RELLENO, no vidrio.** Fue una superficie translúcida con
 * el borde teñido, y a través de ella el tono se leía lavado: el color decía
 * «hay algo elegido» pero no cuál con la firmeza del CTA. Ahora el tono pinta el
 * fondo entero y el glifo pasa a negro encima, que es la misma relación que el
 * botón principal —relleno de marca, marca encima en negro— y por eso se lee
 * como parte del mismo sistema.
 *
 * **Medido**, porque invertir el glifo se puede hacer mal: negro sobre los tres
 * rellenos de Personal da 7.1:1 (rojo), 10.0:1 (verde) y 7.9:1 (azul). En blanco
 * habría dado 2.0–2.8 y ninguno pasaría.
 *
 * ═══════════ POR QUÉ VIVE EN `ui/` Y NO EN UNA FEATURE ═══════════
 *
 * Lo montan el alta de un movimiento personal —gasto, ingreso, traslado— y el
 * alta de un gasto compartido, que acota las suyas a dos. Una feature no puede
 * importar de otra, así que compartirlo exige ponerlo por debajo de las dos.
 *
 * **El ancho sale del número de opciones**, no de una cifra por pantalla: el
 * oblongo mide lo que enseña y el indicador cae donde debe sin corrección
 * ninguna. Las etiquetas, los tonos y los glifos llegan resueltos desde arriba,
 * que es lo que permite que aquí no haya ni catálogo ni semántica financiera.
 */
export function KindSelector<K extends string>({
  options,
  value,
  onChange,
  locked = false,
}: {
  readonly options: readonly KindOption<K>[];
  readonly value: K;
  readonly onChange: (kind: K) => void;
  /**
   * Enseña la clase pero no deja cambiarla.
   *
   * **Corregir no convierte un gasto en un ingreso.** Una corrección es otra
   * versión de la MISMA operación, y la clase pertenece a la operación y no a la
   * versión: `sec.persist_version` rechaza lo contrario con
   * `OPERATION_CLASS_MISMATCH` (F06/ADR-002). Un selector activo ofrecería algo que
   * la frontera va a negar.
   *
   * **Se bloquea en vez de esconderse**: la clase sigue siendo información útil
   * —es lo que explica el color y el signo del importe que se está editando—.
   * Quién recorta la lista es quien la pasa, no este control.
   */
  readonly locked?: boolean;
}) {
  const theme = useTheme();

  const index = options.findIndex((one) => one.key === value);
  const offset = useSharedValue(index * SEGMENT);

  useEffect(() => {
    offset.value = withSpring(index * SEGMENT, SPRING);
  }, [index, offset]);

  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  const chosen = options.find((one) => one.key === value);

  return (
    <GlassSurface
      material="control"
      level="bar"
      depth="well"
      rim="soft"
      radius={Radius.full}
      /* Selector: la pista es el cuerpo del control, no un contenedor. */
      nativeEffect={false}
      style={[styles.track, { width: SEGMENT * options.length + PAD * 2 }]}>
      <Animated.View style={[styles.indicatorSlot, indicator]} pointerEvents="none">
        <View style={[styles.indicator, { backgroundColor: chosen?.tone ?? theme.accent }]} />
      </Animated.View>

      <View style={styles.segments}>
        {options.map((option) => (
          <Segment
            key={option.key}
            glyph={option.glyph}
            active={option.key === value}
            colour={option.key === value ? theme.onAccent : theme.textSecondary}
            label={option.label}
            disabled={locked}
            onPress={() => {
              onChange(option.key);
            }}
          />
        ))}
      </View>
    </GlassSurface>
  );
}

/** Un segmento: sólo el glifo crece y se tiñe, y nada más se mueve. */
function Segment({
  glyph,
  active,
  colour,
  label,
  onPress,
  disabled = false,
}: {
  glyph: PlatformSymbol;
  active: boolean;
  colour: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const grow = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    grow.value = withTiming(active ? 1 : 0, timing(Motion.screen.duration));
  }, [active, grow]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + grow.value * 0.18 }],
    opacity: 0.55 + grow.value * 0.45,
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.segment}>
      <Animated.View style={animated}>
        <Icon name={glyph} size={22} colour={colour} shape="circle" />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    alignSelf: 'center',
    // El ancho lo pone quien dibuja, a partir de cuántas clases enseña.
    height: HEIGHT,
    padding: PAD,
    justifyContent: 'center',
  },
  indicatorSlot: {
    position: 'absolute',
    left: PAD,
    top: PAD,
    bottom: PAD,
    width: SEGMENT,
  },
  indicator: {
    flex: 1,
    borderRadius: Radius.full,
  },
  segments: {
    flexDirection: 'row',
  },
  segment: {
    width: SEGMENT,
    height: HEIGHT - PAD * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
