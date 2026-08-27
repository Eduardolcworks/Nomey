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
  'foundation.caption': 'Base visual',
  'foundation.palette': 'Paleta',
  'foundation.typography': 'Tipografía',
  'foundation.formatting': 'Formato',
  'foundation.runtime': 'Intl en este dispositivo',

  'locale.label': 'Idioma',
  'locale.device': 'Idioma del sistema: {tag}',

  'runtime.available': 'Disponible',
  'runtime.missing': 'No disponible',
  'runtime.fallbackOk': 'Ausente · fallback OK',
  'runtime.exactPath': 'Ruta exacta: {path}',

  'sample.income': 'Ingreso',
  'sample.expense': 'Gasto',
  'sample.large': 'Importe grande',
} as const;

export type MessageKey = keyof typeof esES;
