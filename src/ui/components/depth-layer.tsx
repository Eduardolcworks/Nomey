import type { TactileState } from '@/ui/theme';

export type DepthLayerProps = {
  /** El estado tactil cuya mitad EXTERIOR proyecta esta capa. */
  readonly state: TactileState;
  /** El mismo radio que el control. Una silueta con otro radio es otra forma. */
  readonly radius: number;
};

/**
 * En iOS no existe.
 *
 * No es una capa apagada ni una vista transparente: **no se monta ningun nodo**,
 * asi que el arbol de iOS es el que ya estaba y su sombra sigue saliendo entera
 * del token sobre la propia vista, que es la composicion aprobada.
 *
 * La version de Android esta en `depth-layer.android.tsx`. Metro elige el
 * fichero por extension, asi que ninguna rama de plataforma vive en el codigo.
 */
export function DepthLayer(_props: DepthLayerProps) {
  return null;
}
