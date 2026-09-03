import type { RefObject } from 'react';
import type { View } from 'react-native';

/**
 * LO QUE HAY QUE DESENFOCAR — y en iOS no hay nada que declarar.
 *
 * iOS desenfoca lo que tiene detrás por composición del sistema, así que aquí
 * **no envuelve nada**: devuelve sus hijos tal cual y el árbol queda exactamente
 * como estaba antes de que Android necesitara un objetivo.
 *
 * Eso es deliberado y no una simplificación: un envoltorio «neutro» sigue siendo
 * una vista más en el árbol, y la referencia visual aprobada es la de iOS.
 * `blur-target.android.tsx` es quien monta la topología que Android exige.
 */
export function BlurTarget({
  children,
}: {
  /** Sólo lo usa Android. Aquí se ignora a propósito. */
  readonly target: RefObject<View | null>;
  readonly children: React.ReactNode;
}) {
  return <>{children}</>;
}
