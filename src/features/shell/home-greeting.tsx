import { useTranslation } from '@/lib/i18n';

import { ScopeSwitch } from './scope-switch';
import { ScreenTitle } from './screen-title';

/**
 * A quién se saluda y de quién es el dinero, en una sola fila.
 *
 * **Es contenido de Inicio, no barra superior.** Se desplaza con el saldo y con
 * los movimientos, y desaparece por arriba como cualquier otra cosa de la
 * pantalla. Lo que se queda fijo es [`AppTopBar`](./app-top-bar.tsx), que
 * identifica la aplicación; esto dice qué libros se están mirando, que es una
 * pregunta del contenido.
 *
 * **Las dos piezas van juntas y en la misma fila.** El saludo sin el selector
 * no dice de quién es el dinero, y el selector sin el saludo queda como un
 * control suelto encima de las cifras. Separarlos —fijando uno y desplazando el
 * otro— es exactamente el defecto que esta composición evita.
 *
 * **La geometría ya no vive aquí**, sino en [`ScreenTitle`](./screen-title.tsx),
 * que es la misma fila que usa Grupos. Esto se queda con lo único que es de
 * Inicio: qué texto se dice y qué va a la derecha.
 */
export type HomeGreetingProps = {
  /**
   * El nombre al que saludar, cuando lo hay.
   *
   * Llega como prop en vez de leerse aquí, y eso es la arquitectura y no una
   * preferencia: `features/shell` no puede importar `features/session` —ESLint
   * impone el aislamiento entre features—, así que la ruta compone las dos.
   * Para eso existe `src/app/`.
   *
   * `null` o vacío significa saludar sin nombre. **No debe caer a ningún
   * marcador**: enseñar un nombre inventado a alguien que ha iniciado sesión es
   * peor que saludarle a secas.
   */
  name?: string | null;
};

export function HomeGreeting({ name }: HomeGreetingProps) {
  const { t } = useTranslation();

  return (
    <ScreenTitle trailing={<ScopeSwitch />}>
      {name === null || name === undefined || name === ''
        ? t('home.greetingPlain')
        : t('home.greeting', { name })}
    </ScreenTitle>
  );
}
