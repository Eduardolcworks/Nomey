import type { ReactNode } from 'react';

/** Una acción del menú contextual. El icono es el par de siempre. */
export type LongPressMenuAction = {
  readonly id: string;
  readonly title: string;
  readonly icon: { readonly ios: string; readonly android: string };
  /** Acción destructiva: rojo en las dos plataformas, por el sistema. */
  readonly destructive?: boolean;
};

export type LongPressMenuProps = {
  readonly actions: readonly LongPressMenuAction[];
  readonly onSelect: (id: string) => void;
  /**
   * Lo que se mantiene pulsado. Sigue siendo suyo el toque normal: el menú
   * sólo se lleva la pulsación prolongada.
   */
  readonly children: ReactNode;
};
