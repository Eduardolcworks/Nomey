/**
 * The Spanish catalogue, and the source of the key type.
 *
 * Every other catalogue is typed against this one, so a key added here without
 * a translation elsewhere fails the typecheck rather than reaching a screen.
 *
 * Keys are flat and dotted, which keeps them greppable: finding where a string
 * is used is a search for the literal key.
 *
 * Brand names are NOT here. "Nomey" is the same word in every language, and
 * putting it in a catalogue would invite someone to translate it.
 */
export const esES = {
  'nav.home': 'Inicio',
  'nav.groups': 'Grupos',
  'nav.notifications': 'Notificaciones',
  'nav.profile': 'Perfil',

  'scope.personal': 'Personal',
  'scope.couple': 'Pareja',
  'scope.label': 'Ámbito',

  'action.addTo': 'Añadir a {scope}',
  'action.addToGroups': 'Añadir a un grupo',
  'action.close': 'Cerrar',
  'action.soon': 'Próximamente',

  'home.available': 'Disponible',
  'home.activity': 'Actividad reciente',
  'home.activityEmpty': 'Todavía no hay movimientos.',
  'home.activityHint': 'Usa el botón de añadir para registrar el primero.',

  'groups.title': 'Grupos',
  'groups.empty': 'Todavía no tienes grupos.',
  'groups.emptyHint': 'Aquí aparecerán los viajes, pisos y gastos compartidos.',
  'groups.create': 'Crear grupo',

  'notifications.empty': 'No hay notificaciones.',

  'profile.account': 'Cuenta',
  'profile.language': 'Idioma',
  'profile.appearance': 'Apariencia',
  'profile.diagnostics': 'Diagnóstico',

  'foundation.caption': 'Base visual',
  'foundation.palette': 'Paleta',
  'foundation.typography': 'Tipografía',
  'foundation.formatting': 'Formato',
  'foundation.runtime': 'Intl en este dispositivo',

  'locale.label': 'Idioma',
  'locale.preference': 'Preferencia',
  'locale.automatic': 'Automático',
  'locale.device': 'Idioma del sistema',
  'locale.region': 'Región del sistema',
  'locale.catalogue': 'Catálogo activo',
  'locale.formatting': 'Formato regional',

  'runtime.available': 'Disponible',
  'runtime.missing': 'No disponible',
  'runtime.fallbackOk': 'Ausente · fallback OK',
  'runtime.exactPath': 'Ruta exacta: {path}',

  'sample.income': 'Ingreso',
  'sample.expense': 'Gasto',
  'sample.large': 'Importe grande',
} as const;

export type MessageKey = keyof typeof esES;
