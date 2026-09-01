import type { EntryBlocker } from './movement-entry';
import type { MessageKey } from '@/lib/i18n';

/**
 * Cómo se dice cada impedimento, en una sola tabla.
 *
 * Vive aquí y no en una pantalla porque la usan las dos que escriben un
 * movimiento —el alta y la corrección— y una segunda copia acabaría diciendo
 * otra cosa para el mismo caso.
 */
export const BLOCKER_HINT: Record<EntryBlocker, MessageKey> = {
  noRoute: 'entry.transferSoon',
  noScope: 'entry.scopePending',
  amountMissing: 'entry.amountHint',
  amountInvalid: 'entry.amountInvalid',
  conceptMissing: 'entry.conceptHint',
  categoryMissing: 'entry.categoryHint',
};
