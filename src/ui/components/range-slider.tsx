import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Radius, Spacing, useTheme } from '@/ui/theme';

/**
 * UNA BARRA DE INTERVALO CON DOS EXTREMOS.
 *
 * ═══════════ TRABAJA CON ÍNDICES, NUNCA CON DINERO ═══════════
 *
 * `low` y `high` son **posiciones enteras entre 0 y `steps`**, no importes. Y no
 * es una abstracción por gusto: `ui/` no puede importar `domain/`, así que aquí
 * no hay forma de manejar un `Money` — pero sobre todo, arrastrar un dedo por
 * una pantalla es geometría aproximada, y F02/ADR-001 no admite que un valor de
 * registro salga de una aproximación.
 *
 * El reparto es explícito: **la barra decide una posición; quien la usa
 * convierte esa posición en un importe exacto**, con su propia regla acotada.
 * Los dos extremos son exactos por construcción —0 es el índice 0 y el máximo es
 * el índice `steps`— así que «todo» y «nada» nunca se aproximan.
 *
 * ═══════════ EL GESTO VIVE EN LA BARRA, NO EN CADA PULGAR ═══════════
 *
 * Quien recibe el toque es el carril entero, y **el extremo que se mueve es el
 * más cercano al punto tocado**, decidido una vez al empezar y fijo durante todo
 * el arrastre — si se recalculara en cada movimiento, los dos pulgares se
 * intercambiarían al cruzarse. Es también lo que hace que un toque suelto en
 * mitad de la barra acerque el extremo de ese lado, en vez de exigir acertar en
 * un círculo de 28 pt.
 *
 * Los manejadores se escriben aquí, en el JSX, y cierran sobre los valores de
 * ESTE render: nada de espejos mutables con los que arrastrar valores viejos. Lo
 * único que sobrevive al gesto es qué extremo se está moviendo.
 *
 * ═══════════ Y SE PUEDE MOVER SIN ARRASTRAR ═══════════
 *
 * **Cada extremo es un control accesible propio**, con su rol de graduación, su
 * valor y sus acciones de incremento y decremento: un lector de pantalla puede
 * mover los dos sin gesto ninguno, que es la única forma de que la barra no sea
 * un control exclusivo de quien ve la pantalla.
 *
 * **Los extremos no se cruzan.** El de la izquierda no pasa del de la derecha y
 * al revés; lo impone esta pieza y no quien la usa, para que un intervalo
 * inválido no llegue a existir.
 */
export type RangeSliderProps = {
  /** Posiciones admitidas: de 0 a `steps`, ambas incluidas. */
  readonly steps: number;
  readonly low: number;
  readonly high: number;
  readonly onChange: (low: number, high: number) => void;
  /** Lo que anuncia cada extremo. Ya traducido y con su valor dentro. */
  readonly lowLabel: string;
  readonly highLabel: string;
  /**
   * Apagada: sin recorrido que ofrecer.
   *
   * Es el caso de un grupo sin gastos —el intervalo es cero a cero— y el de un
   * máximo que no se ha podido leer. Se anuncia como desactivada en vez de dejar
   * dos extremos que no se mueven sin decir por qué.
   */
  readonly disabled?: boolean;
};

/** El lado del pulgar. También su área de toque, que no baja de aquí. */
const THUMB = 28;

export function RangeSlider({
  steps,
  low,
  high,
  onChange,
  lowLabel,
  highLabel,
  disabled = false,
}: RangeSliderProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);

  /** Qué extremo se está arrastrando. Se escribe y se lee sólo en el gesto. */
  const dragging = useRef<'low' | 'high' | null>(null);

  const inert = disabled || steps <= 0;
  const usable = Math.max(width - THUMB, 1);

  /** De índice a píxel. Sólo para dibujar: nada de esto vuelve al dato. */
  const pixelAt = (index: number) => (steps <= 0 ? 0 : (index / steps) * usable);

  /** Y de píxel a índice, redondeado y acotado a [0, steps]. */
  const indexFrom = (locationX: number) => {
    if (steps <= 0) return 0;
    const raw = Math.round(((locationX - THUMB / 2) / usable) * steps);
    return Math.min(steps, Math.max(0, raw));
  };

  const nudged = (which: 'low' | 'high', next: number) => {
    if (which === 'low') onChange(Math.min(next, high), high);
    else onChange(low, Math.max(next, low));
  };

  /* El salto de una acción accesible: un centésimo del recorrido, mínimo uno. */
  const nudge = Math.max(1, Math.round(steps / 100));

  const thumb = (which: 'low' | 'high') => {
    const value = which === 'low' ? low : high;

    return (
      <View
        /*
         * SIN MANEJADORES DE TOQUE PROPIOS: el gesto lo gobierna el carril, y
         * dos responders sobre la misma zona se lo disputarían. Lo que sí tiene
         * cada pulgar es su identidad accesible.
         */
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={which === 'low' ? lowLabel : highLabel}
        accessibilityState={{ disabled: inert }}
        accessibilityValue={{ min: 0, max: steps, now: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          if (inert) return;
          const delta = event.nativeEvent.actionName === 'increment' ? nudge : -nudge;
          nudged(which, Math.min(steps, Math.max(0, value + delta)));
        }}
        pointerEvents="none"
        style={[
          styles.thumb,
          {
            left: pixelAt(value),
            backgroundColor: inert ? theme.surfaceRaised : theme.accent,
            borderColor: theme.surface,
          },
        ]}
      />
    );
  };

  return (
    <View
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        /*
         * Sólo si cambia de verdad. Un `setState` en cada `onLayout` reentra en
         * la medida de Android, que es lo que rompió los oblongos del panel de
         * gasto; aquí basta con no repetir.
         */
        if (next !== width) setWidth(next);
      }}
      onStartShouldSetResponder={() => !inert}
      onMoveShouldSetResponder={() => !inert}
      /*
       * ═══════ UNA VEZ EMPEZADO EL ARRASTRE, NADIE DE JS LO QUITA ═══════
       *
       * Es la pregunta que hace el `ScrollView` de encima cuando quiere
       * llevarse el toque para desplazar: «¿lo sueltas?». Sin esto la respuesta
       * por omisión es que sí, y un arrastre ligeramente diagonal —que es como
       * arrastra un pulgar— acababa en `onResponderTerminate`: el extremo se
       * quedaba clavado donde estaba y el contenido se movía en su lugar.
       *
       * Esto sólo gobierna el sistema de responders de React Native. Un
       * reconocedor NATIVO —el de volver atrás de la pila— no pregunta; para ése
       * la ruta apaga el gesto mientras el panel está abierto.
       */
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        const index = indexFrom(event.nativeEvent.locationX);
        /* El más cercano, decidido UNA vez: recalcularlo en cada movimiento
         * intercambiaría los dos extremos al cruzarse. */
        const which = Math.abs(index - low) <= Math.abs(index - high) ? 'low' : 'high';
        dragging.current = which;
        nudged(which, index);
      }}
      onResponderMove={(event) => {
        const which = dragging.current;
        if (which === null) return;
        nudged(which, indexFrom(event.nativeEvent.locationX));
      }}
      onResponderRelease={() => {
        dragging.current = null;
      }}
      onResponderTerminate={() => {
        dragging.current = null;
      }}
      style={styles.frame}>
      <View style={[styles.rail, { backgroundColor: theme.border }]} />
      {/* El tramo elegido, en acento: es lo que dice qué parte queda dentro. */}
      <View
        style={[
          styles.rail,
          styles.selected,
          {
            backgroundColor: inert ? theme.border : theme.accent,
            left: pixelAt(low) + THUMB / 2,
            width: Math.max(pixelAt(high) - pixelAt(low), 0),
          },
        ]}
      />
      {thumb('low')}
      {thumb('high')}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: THUMB + Spacing.xs,
    justifyContent: 'center',
  },
  rail: {
    position: 'absolute',
    left: THUMB / 2,
    right: THUMB / 2,
    height: 4,
    borderRadius: Radius.full,
  },
  selected: {
    right: undefined,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: Radius.full,
    borderWidth: 2,
  },
});
