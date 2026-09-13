import type { ReactElement } from 'react';

/**
 * EL CONTRATO DEL MENÚ NATIVO, compartido por sus dos implementaciones.
 *
 * Vive aparte por lo mismo que el de categorías: el archivo que lo declarara
 * sería uno de los dos, y el otro tendría que importar de una plataforma que no
 * es la suya. Aquí no hay nada nativo, así que las dos pueden leerlo.
 *
 * **Es neutral a propósito.** Recibe opciones ya traducidas y devuelve la que se
 * eligió; no conoce catálogos, ni participantes, ni métodos de reparto. Por eso
 * puede vivir en `ui/` y usarlo cualquier pantalla: el selector de pagador y el
 * de método son el MISMO control con distintas opciones, no dos menús parecidos.
 */
export type MenuOption = {
  readonly id: string;
  /** Ya traducida. Este control no conoce el catálogo. */
  readonly title: string;
  readonly selected: boolean;
  /**
   * La clave semántica del icono de la opción, sin resolver. Opcional.
   *
   * **Sólo la pinta iOS**, y no por descuido: `MenuAction.image` de Android
   * admite un recurso de dibujo, y lo que Nomey guarda es una clave que resuelve
   * a un par `{ ios, android }` de `expo-symbols` — el lado Android de ese par es
   * un nombre de símbolo de Material, no un recurso. Allí no hay nada admisible
   * que mandar, así que el menú va con texto, que es lo que hace su sistema, y
   * no con un icono roto. Es exactamente el criterio del selector de categorías.
   */
  readonly icon?: string;
};

export type OptionMenuProps = {
  /** El encabezado del menú del sistema. Ya traducido; opcional. */
  readonly title?: string;
  readonly options: readonly MenuOption[];
  readonly onSelect: (id: string) => void;
  /**
   * EL ALTO DEL DISPARADOR, cuando su ancho lo reparte una fila.
   *
   * Con él, el menú recibe un marco de alto declarado y ancho flexible, y el
   * disparador se estira dentro con `absoluteFill` — que es lo que hace que dos
   * oblongos hermanos midan lo mismo sin medir nada. Sin él, el disparador se
   * maqueta por su contenido, que es lo que quiere un círculo de lado fijo.
   */
  readonly height?: number;
  /**
   * EL DISPARADOR, ya pintado por quien compone la fila.
   *
   * No lleva su propio `Pressable`: la pulsación la gobierna el menú nativo, y
   * dos manejadores sobre la misma vista se disputarían el toque.
   */
  readonly children: ReactElement;
};
