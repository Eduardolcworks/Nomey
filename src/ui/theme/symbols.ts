import type { SymbolViewProps } from 'expo-symbols';

/**
 * UN SÍMBOLO SON DOS NOMBRES, y aquí están los dos.
 *
 * **Por qué existe este fichero.** `SymbolView` acepta o un nombre de SF Symbol
 * suelto o un par `{ ios, android }`, y esa union es una trampa: una cadena
 * suelta **es** un nombre de Apple, así que en Android no hay nada que resolver
 * y el icono cae en el recuadro de respaldo. Compila, pasa los tipos, se ve
 * perfecto en el iPhone y deja media aplicación sin iconos en el emulador.
 *
 * Es exactamente el defecto que ADR-027 corrigió en las categorías — la base
 * guarda una clave semántica y el cliente resuelve el par— y que el resto de la
 * interfaz seguía teniendo, porque nadie lo había mirado fuera de iOS.
 *
 * **El lado Android no se deduce por parecido.** Material no es SF Symbols: no
 * hay `pencil`, hay `edit`; no hay `xmark`, hay `close`; no hay `trash`, hay
 * `delete`. Cada nombre de aquí está comprobado contra el vocabulario que trae
 * `expo-symbols` —4055 nombres en su `symbols.json`—, y una guarda lo vuelve a
 * comprobar en cada `npm test` en vez de fiarlo a esta frase.
 *
 * **Lo que se ve en iOS no cambia.** El lado `ios` de cada par es literalmente
 * el nombre que ya había en su sitio de llamada; sólo se le ha añadido su
 * pareja. Ni un tamaño, ni un color, ni una geometría distintos.
 *
 * Las categorías tienen su propio registro en `category-palette.ts`, porque su
 * clave la guarda la base y su vocabulario lo fija un `CHECK`. Éste es el de la
 * interfaz, cuyas claves no salen de ninguna parte más que de aquí.
 */
export type PlatformSymbol = Extract<SymbolViewProps['name'], { ios?: unknown }>;

export const Symbols = {
  // Navegación y estructura
  home: { ios: 'house', android: 'home' },
  groups: { ios: 'person.2', android: 'groups' },
  add: { ios: 'plus', android: 'add' },
  back: { ios: 'chevron.left', android: 'chevron_left' },
  forward: { ios: 'chevron.right', android: 'chevron_right' },
  expand: { ios: 'chevron.down', android: 'expand_more' },
  collapse: { ios: 'chevron.up', android: 'expand_less' },

  // Cabecera y cuenta
  notifications: { ios: 'bell', android: 'notifications' },
  profile: { ios: 'person.crop.circle', android: 'account_circle' },
  person: { ios: 'person.fill', android: 'person' },
  camera: { ios: 'camera.fill', android: 'photo_camera' },

  // Acciones
  edit: { ios: 'pencil', android: 'edit' },
  close: { ios: 'xmark', android: 'close' },
  confirm: { ios: 'checkmark', android: 'check' },
  delete: { ios: 'trash', android: 'delete' },
  calendar: { ios: 'calendar', android: 'calendar_month' },
  reveal: { ios: 'eye', android: 'visibility' },
  conceal: { ios: 'eye.slash', android: 'visibility_off' },

  // Movimiento y dinero
  incoming: { ios: 'arrow.down.left', android: 'south_west' },
  outgoing: { ios: 'arrow.up.right', android: 'north_east' },
  transfer: { ios: 'arrow.left.arrow.right', android: 'swap_horiz' },
  breakdown: { ios: 'chart.pie', android: 'pie_chart' },

  // Estados vacíos y avisos
  empty: { ios: 'tray', android: 'inbox' },
  warning: { ios: 'exclamationmark.triangle', android: 'warning' },

  // Perfil y ajustes
  premium: { ios: 'sparkles', android: 'auto_awesome' },
  language: { ios: 'globe', android: 'language' },
  appearance: { ios: 'circle.lefthalf.filled', android: 'contrast' },
  shortcuts: { ios: 'bolt', android: 'bolt' },

  // Pantallas de desarrollo. Van aqui por la misma razon que las demas: un
  // icono roto es un icono roto, y ademas son las que se miran cuando algo
  // falla — justo cuando conviene que se lean.
  diagnostics: { ios: 'waveform.path.ecg', android: 'monitor_heart' },
  states: { ios: 'square.on.square', android: 'filter_none' },
  sessionProbe: { ios: 'key', android: 'key' },
} as const satisfies Record<string, PlatformSymbol>;

export type SymbolKey = keyof typeof Symbols;
