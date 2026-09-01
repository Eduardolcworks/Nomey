import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { type EntryKind, ENTRY_KINDS } from './movement-entry';
import { type MessageKey, useTranslation } from '@/lib/i18n';
import type { SymbolViewProps } from 'expo-symbols';

import { GlassSurface, Icon } from '@/ui/components';
import { SPRING, timing } from '@/ui/theme/motion-runtime';
import { Motion, Radius, Spacing, useTheme } from '@/ui/theme';

const LABEL: Record<EntryKind, MessageKey> = {
  expense: 'entry.kindExpense',
  income: 'entry.kindIncome',
  transfer: 'entry.kindTransfer',
};

/**
 * Las clases que se pueden CORREGIR, y por tanto las únicas que el selector
 * enseña cuando está bloqueado.
 *
 * El traslado no está aquí por dos razones que se suman: no tiene ruta de
 * escritura todavía, y aunque la tuviera, una corrección no cambia la clase de
 * una operación. Dejar su segmento en modo edición sería ofrecer una
 * conversión imposible por partida doble — y encima reservaría un tercio del
 * ancho para algo que no se puede pulsar.
 */
const EDITABLE_KINDS: readonly EntryKind[] = ['expense', 'income'];

const SEGMENT = 64;
const HEIGHT = 54;
const PAD = Spacing.xs;

/**
 * Las tres clases de movimiento, en un solo oblongo.
 *
 * **Sólo la elegida lleva color.** Rojo, verde y azul son semántica financiera,
 * y tres colores encendidos a la vez no dicen «elige uno», dicen «hay tres
 * cosas importantes». Las demás se quedan en el gris del sistema, que es lo que
 * hace que la elegida se lea sin tener que buscarla.
 *
 * **Y el color nunca es la única señal.** Cada segmento lleva su glifo —menos,
 * más, dos flechas—, y el elegido además crece, se adelanta sobre el vidrio y
 * recibe el borde teñido. `design-direction.md` §8 no admite que un estado
 * dependa de un color, y menos del peor par posible: rojo contra verde, que
 * alrededor de una de cada doce personas no distingue.
 *
 * **El indicador se desliza; los segmentos no se mueven de sitio.** Una sola
 * vista animada viaja por debajo de los tres, así que el cambio se lee como un
 * objeto que se desplaza y no como tres que parpadean. Es también lo que
 * mantiene todo en el hilo de UI: lo que se interpola es una traslación y una
 * escala, y `boxShadow` —que no es interpolable— cambia de golpe, que es
 * justamente lo que un cambio de profundidad debe hacer.
 *
 * **Y el indicador es RELLENO, no vidrio.** Era una superficie translúcida con
 * el borde teñido, y a través de ella el tono se leía lavado: el color decía
 * «hay algo elegido» pero no cuál con la firmeza del CTA. Ahora el tono pinta
 * el fondo entero y el glifo pasa a negro encima, que es la misma relación que
 * el botón principal —relleno de marca, marca encima en negro— y por eso se
 * lee como parte del mismo sistema.
 *
 * **Medido**, porque invertir el glifo se puede hacer mal: negro sobre los tres
 * rellenos da 7.1:1 (rojo), 10.0:1 (verde) y 7.9:1 (azul). En blanco habría
 * dado 2.0–2.8 y ninguno pasaría. La pista sigue siendo vidrio, con el brillo
 * de borde suavizado para que las puntas del oblongo no destaquen.
 */
export function EntryKindSelector({
  value,
  onChange,
  locked = false,
}: {
  value: EntryKind;
  onChange: (kind: EntryKind) => void;
  /**
   * Enseña la clase pero no deja cambiarla.
   *
   * **Corregir no convierte un gasto en un ingreso.** Una corrección es otra
   * versión de la MISMA operación, y la clase pertenece a la operación y no a
   * la versión: `sec.persist_version` rechaza lo contrario con
   * `OPERATION_CLASS_MISMATCH` (ADR-020). Un selector activo ofrecería algo que
   * la frontera va a negar.
   *
   * **Se bloquea en vez de esconderse, y la geometría no se mueve.** La clase
   * sigue siendo información útil —es lo que explica el color y el signo del
   * importe que se está editando— y quitar segmentos cambiaría el ancho de la
   * pista y la posición del indicador.
   */
  locked?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const tone: Record<EntryKind, string> = {
    expense: theme.negative,
    income: theme.positive,
    transfer: theme.neutralFlow,
  };

  /*
   * **Bloqueado, la pista se recompone a dos y se vuelve a centrar.** No es un
   * segmento oculto ni un hueco vacío: el ancho sale del número de clases que
   * se dibujan, así que el oblongo mide lo que enseña y el indicador cae donde
   * debe sin ninguna corrección.
   */
  const kinds = locked ? EDITABLE_KINDS : ENTRY_KINDS;
  const index = kinds.indexOf(value);
  const offset = useSharedValue(index * SEGMENT);

  useEffect(() => {
    offset.value = withSpring(index * SEGMENT, SPRING);
  }, [index, offset]);

  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <GlassSurface
      level="bar"
      depth="well"
      rim="soft"
      radius={Radius.full}
      /* Selector: la pista es el cuerpo del control, no un contenedor. */
      nativeEffect={false}
      style={[styles.track, { width: SEGMENT * kinds.length + PAD * 2 }]}>
      <Animated.View style={[styles.indicatorSlot, indicator]} pointerEvents="none">
        <View style={[styles.indicator, { backgroundColor: tone[value] }]} />
      </Animated.View>

      <View style={styles.segments}>
        {kinds.map((kind) => (
          <Segment
            key={kind}
            kind={kind}
            active={kind === value}
            colour={kind === value ? theme.onAccent : theme.textSecondary}
            label={t(LABEL[kind])}
            disabled={locked}
            onPress={() => {
              onChange(kind);
            }}
          />
        ))}
      </View>
    </GlassSurface>
  );
}

/**
 * Los tres glifos, cada uno con su pareja de plataforma.
 *
 * **El de traslado era el carácter `⇄` y por eso no había manera de centrarlo.**
 * Un texto se centra por su CAJA DE LÍNEA, no por su tinta, y la tinta de ese
 * carácter no está en el centro de su caja: las flechas se dibujan alrededor
 * del eje matemático de la fuente, por encima de la mitad. Da igual cuántos
 * `alignItems: 'center'` se pongan — se estaba centrando bien una caja cuyo
 * contenido está alto. Un símbolo no tiene ese problema: su recuadro ES su
 * dibujo.
 *
 * **Y los tres van como pareja `{ ios, android }`, no sólo el nuevo.** Menos y
 * más se pasaban como cadena suelta, que es un nombre de SF Symbol: fuera de
 * iOS `Icon` no lo resuelve y cae en su recuadro de respaldo. Es el mismo
 * defecto que ADR-027 corrigió en las categorías, y dejar dos de tres sin
 * pareja habría puesto en Android dos huecos vacíos y una flecha.
 *
 * Nombres comprobados contra los vocabularios reales, no de memoria: los de
 * iOS contra `sf-symbols-typescript`, los de Android contra las 4055 entradas
 * de `expo-symbols/android/symbols.json`.
 */
const GLYPH: Record<EntryKind, SymbolViewProps['name']> = {
  expense: { ios: 'minus', android: 'remove' },
  income: { ios: 'plus', android: 'add' },
  transfer: { ios: 'arrow.left.arrow.right', android: 'swap_horiz' },
};

/** Un segmento: sólo el glifo crece y se tiñe, y nada más se mueve. */
function Segment({
  kind,
  active,
  colour,
  label,
  onPress,
  disabled = false,
}: {
  kind: EntryKind;
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
        <Icon name={GLYPH[kind]} size={22} colour={colour} shape="circle" />
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
