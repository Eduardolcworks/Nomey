import { useState } from 'react';

import { todayInDeviceCalendar } from './interval';
import {
  type AmountEntry,
  amountValue,
  blockerFor,
  currentClockTime,
  EMPTY_AMOUNT,
  type EntryBlocker,
  type EntryDraft,
  type EntryKind,
  INITIAL_ENTRY_KIND,
  usesCategory,
} from './movement-entry';
import type { CalendarDate } from '@/lib/format';

/**
 * El estado de un movimiento que se está escribiendo, dando igual si es nuevo
 * o una corrección.
 *
 * **Una sola implementación del borrador.** Dar de alta y corregir escriben
 * exactamente los mismos campos y los validan con las mismas reglas; lo único
 * que cambia es de dónde arrancan y qué se hace al guardar. Separar el estado
 * de la pantalla es lo que permite que las dos superficies compartan la
 * composición sin compartir el componente.
 */
export type MovementDraft = {
  readonly kind: EntryKind;
  readonly setKind: (next: EntryKind) => void;
  readonly entry: AmountEntry;
  readonly setEntry: (next: AmountEntry) => void;
  readonly concept: string;
  readonly setConcept: (next: string) => void;
  readonly categoryId: string | null;
  readonly setCategoryId: (next: string | null) => void;
  readonly date: CalendarDate;
  readonly setDate: (next: CalendarDate) => void;
  readonly time: string;
  /**
   * Qué selector del sistema está abierto.
   *
   * **Sólo la fecha.** La categoría tuvo aquí su propio valor mientras se
   * elegía en una hoja propia; desde que la elige el menú nativo —anclado a su
   * botón y sin estado que llevar— no queda nada que abrir.
   */
  readonly picking: 'date' | null;
  readonly setPicking: (next: 'date' | null) => void;

  /** Lo que la frontera va a recibir, ya en la forma que espera. */
  readonly draft: EntryDraft;
  /** Por qué todavía no se puede guardar. `null` significa que sí se puede. */
  readonly blocker: EntryBlocker | null;
};

/**
 * @param initial de dónde arranca. Ausente, un movimiento nuevo: gasto, importe
 * vacío, hoy y la hora de ahora. Presente, la versión vigente que se corrige —
 * y **su importe SÍ es el borrador**, porque corregir parte de lo que había.
 * @param hasCategories si hay catálogo del que elegir. `false` sólo cuando se
 * SABE que no lo hay —sin red y sin copia local (ADR-028 §16)—; entonces el
 * gasto se bloquea con `noCategories` y su explicación. Un ingreso no lo mira.
 */
export function useMovementDraft(
  scale: number,
  hasScope: boolean,
  initial?: {
    readonly kind: EntryKind;
    readonly amount: AmountEntry;
    readonly concept: string;
    readonly categoryId: string | null;
    readonly date: CalendarDate;
    readonly time: string;
  },
  hasCategories = true,
): MovementDraft {
  /*
   * Los inicializadores son perezosos, así que esto se evalúa una vez: el
   * borrador es el dueño de lo que se escribe a partir de ahí, y una precarga
   * que se reaplicara borraría lo tecleado.
   */
  const [kind, setKindRaw] = useState<EntryKind>(initial?.kind ?? INITIAL_ENTRY_KIND);
  const [entry, setEntry] = useState<AmountEntry>(initial?.amount ?? EMPTY_AMOUNT);
  const [concept, setConcept] = useState(initial?.concept ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [date, setDate] = useState<CalendarDate>(() => initial?.date ?? todayInDeviceCalendar());
  /*
   * **La hora se conserva, no se reinventa.** Al corregir se mantiene la de la
   * versión que se corrige: la hora efectiva es un hecho del movimiento
   * (ADR-020 §3), no del momento en que alguien lo corrige.
   */
  const [time] = useState(() => initial?.time ?? currentClockTime());
  const [picking, setPicking] = useState<'date' | null>(null);

  const setKind = (next: EntryKind) => {
    setKindRaw(next);
    // Un ingreso no lleva categoría, y dejar la elegida en el estado sería
    // dejar preparada la forma inválida del payload por si algún día se olvida
    // el `if`. Se suelta al cambiar de clase, no al construirlo.
    if (!usesCategory(next)) setCategoryId(null);
  };

  const draft: EntryDraft = {
    kind,
    /*
     * La frontera sigue recibiendo la MISMA cadena canónica de siempre: quien
     * la pasa a unidades mínimas es `toMinorUnits`, sobre texto y `bigint`, sin
     * que ningún `number` toque el dinero.
     */
    amount: amountValue(entry),
    concept,
    categoryId,
    date,
    time,
  };

  return {
    kind,
    setKind,
    entry,
    setEntry,
    concept,
    setConcept,
    categoryId,
    setCategoryId,
    date,
    setDate,
    time,
    picking,
    setPicking,
    draft,
    blocker: blockerFor(draft, scale, hasScope, hasCategories),
  };
}
