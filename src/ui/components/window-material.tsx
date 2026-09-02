export type WindowMaterialProps = {
  /** El mismo radio que la ventana. */
  readonly radius: number;
};

/**
 * EL MATERIAL DE UNA VENTANA — y en iOS no existe.
 *
 * No se monta ningún nodo: iOS conserva su cristal, su profundidad y su rim tal
 * como están aprobados, y no llega a conocer el token de Android.
 *
 * La implementación real está en `window-material.android.tsx`.
 */
export function WindowMaterial(_props: WindowMaterialProps) {
  return null;
}
