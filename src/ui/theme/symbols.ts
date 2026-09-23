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
 * Es exactamente el defecto que F06/ADR-009 corrigió en las categorías — la base
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
  remove: { ios: 'minus', android: 'remove' },
  back: { ios: 'chevron.left', android: 'chevron_left' },
  forward: { ios: 'chevron.right', android: 'chevron_right' },
  expand: { ios: 'chevron.down', android: 'expand_more' },
  collapse: { ios: 'chevron.up', android: 'expand_less' },

  // Cabecera y cuenta
  notifications: { ios: 'bell', android: 'notifications' },
  profile: { ios: 'person.crop.circle', android: 'account_circle' },
  person: { ios: 'person.fill', android: 'person' },
  camera: { ios: 'camera.fill', android: 'photo_camera' },
  /** Unirse a un grupo. Material lo llama `qr_code`; Apple, `qrcode`. */
  qr: { ios: 'qrcode', android: 'qr_code' },
  /** Mandar lo escrito: el avión de papel del enlace de invitación. */
  send: { ios: 'paperplane.fill', android: 'send' },
  /**
   * Compartir. Apple usa la caja con la flecha saliendo; Material tiene DOS
   * —`share`, los tres nodos unidos, y `ios_share`, una copia del de Apple—.
   * Se toma `share`, que es el que un aparato Android reconoce como propio:
   * `ios_share` en Android sería el gesto de la otra plataforma dibujado aquí.
   */
  share: { ios: 'square.and.arrow.up', android: 'share' },

  // Acciones
  edit: { ios: 'pencil', android: 'edit' },
  /** Lo que se ve y no se puede cambiar: la divisa de un grupo ya creado. */
  lock: { ios: 'lock', android: 'lock' },
  close: { ios: 'xmark', android: 'close' },
  search: { ios: 'magnifyingglass', android: 'search' },
  confirm: { ios: 'checkmark', android: 'check' },
  delete: { ios: 'trash', android: 'delete' },
  /** Salir de un grupo (F09/ADR-003): una puerta, no una papelera. */
  leave: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout' },
  /** Deshacer la propia reclamación (F09/ADR-006): una vuelta atrás, no una salida. */
  undo: { ios: 'arrow.uturn.backward', android: 'undo' },
  calendar: { ios: 'calendar', android: 'calendar_month' },
  reveal: { ios: 'eye', android: 'visibility' },
  conceal: { ios: 'eye.slash', android: 'visibility_off' },

  // Movimiento y dinero
  incoming: { ios: 'arrow.down.left', android: 'south_west' },
  outgoing: { ios: 'arrow.up.right', android: 'north_east' },
  transfer: { ios: 'arrow.left.arrow.right', android: 'swap_horiz' },
  /** De quien paga a quien cobra, en una fila de pago sugerido. */
  arrowRight: { ios: 'arrow.right', android: 'arrow_forward' },
  breakdown: { ios: 'chart.pie', android: 'pie_chart' },

  // Listados: acotar y ordenar. Son DOS preguntas distintas y por eso son dos
  // controles: filtrar quita filas, ordenar sólo las recoloca.
  //
  // El embudo de Apple es `line.3.horizontal.decrease` —tres rayas que menguan—
  // y el de Material, `filter_alt`; el de ordenar, `arrow.up.arrow.down` frente
  // a `swap_vert`. Ninguno de los cuatro es la traducción literal del otro, que
  // es exactamente por lo que este fichero existe.
  filter: { ios: 'line.3.horizontal.decrease', android: 'filter_alt' },
  sort: { ios: 'arrow.up.arrow.down', android: 'swap_vert' },

  // Estados vacíos y avisos
  empty: { ios: 'tray', android: 'inbox' },
  warning: { ios: 'exclamationmark.triangle', android: 'warning' },

  // Amigos (F12.E). Material no tiene el `person.2` de Apple: tiene `group`,
  // y `person_add` / `person_remove` para las dos acciones. Ninguno es la
  // traducción literal del otro, que es exactamente por lo que este fichero
  // existe.
  friends: { ios: 'person.2.fill', android: 'group' },
  addFriend: { ios: 'person.badge.plus', android: 'person_add' },
  removeFriend: { ios: 'person.badge.minus', android: 'person_remove' },
  /**
   * A la espera: la solicitud que ya mandaste y todavia nadie ha contestado
   * (F12.E.D). Apple tiene `clock`; Material lo llama `schedule`, no `clock`.
   */
  pending: { ios: 'clock', android: 'schedule' },

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
