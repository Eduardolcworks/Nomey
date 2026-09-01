import type { CategoryRow } from './category';

/**
 * EL CONTRATO DEL SELECTOR, compartido por sus dos implementaciones.
 *
 * Vive aparte porque el archivo que lo declarara sería uno de los dos, y el
 * otro tendría que importar de una plataforma que no es la suya. Aquí no hay
 * nada nativo, así que las dos pueden leerlo.
 *
 * **Las dos hacen lo MISMO y lo hacen distinto**, y la diferencia no es de
 * gusto: en iOS el menú y su cristal los dibuja SwiftUI de principio a fin
 * —única forma de que no aparezca el halo rectangular al cerrar—, mientras que
 * Android usa `MenuView` con el `DropdownMenu` de Compose, que funciona y no
 * tiene ese problema. De ahí que `children` sólo lo use una.
 */
export type CategoryMenuProps = {
  readonly categories: readonly CategoryRow[];
  readonly selected: string | null;
  readonly onSelect: (categoryId: string) => void;
  /** Lo que anuncia el trigger: incluye la categoría vigente. */
  readonly label: string;
  /** El diámetro del círculo. Lo manda quien compone la fila. */
  readonly size: number;
  /**
   * QUÉ PINTAR EN EL TRIGGER, no el trigger ya pintado.
   *
   * Cada plataforma monta `CategoryTrigger` por su cuenta porque no lo colocan
   * igual —etiqueta de un `Menu` de SwiftUI en iOS, hijo de `MenuView` en
   * Android— y iOS además necesita su variante sin sombra exterior. Los estilos
   * siguen escritos una sola vez, en ese componente.
   */
  readonly icon: string;
  /** Si hay categoría elegida: decide el tono del icono. */
  readonly chosen: boolean;
};
