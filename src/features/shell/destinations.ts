import type { MessageKey } from '@/lib/i18n';
import { type PlatformSymbol, Symbols } from '@/ui/theme';

/**
 * The two root destinations, and the only place they are listed.
 *
 * Reordering them, renaming their labels or changing their icons is an edit to
 * this array. Adding or removing one is this array plus a route file. Neither
 * touches the bar, the screens or the router - which is what "the navigation
 * is provisional" has to mean in practice, since it will be judged on a device
 * and probably changed.
 */
export interface Destination {
  /** The route file inside the `(tabs)` group. */
  readonly route: 'index' | 'groups';
  readonly label: MessageKey;
  readonly symbol: PlatformSymbol;
}

export const DESTINATIONS: readonly Destination[] = [
  { route: 'index', label: 'nav.home', symbol: Symbols.home },
  { route: 'groups', label: 'nav.groups', symbol: Symbols.groups },
];

/** Which world the action button is adding to, from the active route name. */
export function destinationFor(routeName: string): 'home' | 'groups' {
  return routeName === 'groups' ? 'groups' : 'home';
}

/**
 * QUÉ PESTAÑA NOMBRA ESTA RUTA, O NINGUNA.
 *
 * **`null` para las ventanas, y ésa es toda la razón de existir.** `/add`,
 * `/group-action` y `/create-group` son `transparentModal`: se apilan ENCIMA de
 * la pestaña sin cambiarla, pero `usePathname` sí cambia. Traducir la ruta
 * activa a un destino hacía que el dock creyera estar en Inicio en cuanto se
 * abría una ventana desde Grupos — con su etiqueta y su material cambiando a
 * mitad de una animación.
 *
 * Devolviendo `null` para esas rutas, quien llama conserva el último destino
 * real. La identidad del botón deja de moverse con lo que haya encima.
 */
export function tabRouteFrom(pathname: string): 'index' | 'groups' | null {
  if (pathname.startsWith('/groups')) return 'groups';
  if (pathname === '/' || pathname.startsWith('/index')) return 'index';
  return null;
}
