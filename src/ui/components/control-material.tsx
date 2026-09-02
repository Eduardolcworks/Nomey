export type ControlMaterialProps = {
  /** El mismo radio que el control. Un material con otro radio es otra forma. */
  readonly radius: number;
  /**
   * Si además del rim pinta el relleno. Por omisión sí.
   *
   * Con `false` sólo monta el rim, para el consumidor que ya tiene su propio
   * relleno y necesita conservarlo — un avatar cuyo fondo cambia al pulsarlo, o
   * un control con color semántico. Es el mismo material menos su relleno, no
   * una variante nueva.
   */
  readonly fill?: boolean;
};

/**
 * EL MATERIAL DE UN CONTROL NEUTRO — y en iOS no existe.
 *
 * No es una capa apagada ni una vista transparente: **no se monta ningún
 * nodo**. iOS conserva su cristal, su rim y su profundidad tal como están
 * aprobados, y no llega a conocer el token de Android.
 *
 * La implementación real está en `control-material.android.tsx`. Metro elige por
 * extensión, así que ninguna rama de plataforma vive en el código.
 */
export function ControlMaterial(_props: ControlMaterialProps) {
  return null;
}
