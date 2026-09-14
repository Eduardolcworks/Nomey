/**
 * LA PRESENCIA DE UN PARTICIPANTE, Y LAS TRES PREGUNTAS QUE RESPONDE. F09/ADR-003.
 *
 * Hoja PURA —sin Supabase ni React— para que el reparto y sus pruebas la
 * importen sin arrastrar React Native. `api.group_participant` publica la
 * presencia RESUMIDA, no los periodos: `is_active`, `eligible_until` (límite
 * EXCLUSIVO del último periodo) e `is_retired`. El cliente aplica exactamente
 * la desigualdad de la frontera, `fecha < eligible_until`, y nada más: quien
 * evalúa de verdad la elegibilidad sigue siendo `sec.assert_participant_eligible`
 * (F03/ADR-009 §7). Sin presencia conocida —una creación local sin reconciliar—
 * no se descarta a nadie, para no inventar la presencia que falta.
 */
import type { CalendarDate } from '@/lib/format';

export type ParticipantPresence = {
  /** Periodo abierto: se le propone por defecto y puede liquidar. */
  readonly isActive: boolean;
  /** Límite EXCLUSIVO de elegibilidad; nulo mientras esté activo. */
  readonly eligibleUntil: CalendarDate | null;
  /** Dado por saldado: fuera de las listas, y sin deuda nueva jamás (F09/ADR-003 §6). */
  readonly isRetired: boolean;
};

/**
 * ¿PUEDE FIGURAR EN UN GASTO CON ESTA FECHA? La misma regla que la frontera,
 * literal: `valid_from <= d < valid_until`. Sin presencia conocida, sí.
 */
export function eligibleOn(one: WithPresence, date: CalendarDate): boolean {
  if (one.presence === null) return true;
  if (one.presence.isRetired) return false;
  if (one.presence.isActive) return true;
  return one.presence.eligibleUntil !== null && date < one.presence.eligibleUntil;
}

/**
 * Los que se listan: los retirados conservan su nombre, pero no aparecen; un
 * origen asociado a otra identidad (F09/ADR-009) tampoco: su identidad vigente es
 * el destino, que ya está en la lista.
 */
export function listed(one: WithPresence): boolean {
  if (typeof one.mergedInto === 'string') return false;
  return one.presence === null || !one.presence.isRetired;
}

/** Los que se proponen por defecto en un gasto nuevo: sólo los activos. */
export function activeByDefault(one: WithPresence): boolean {
  return one.presence === null || (one.presence.isActive && !one.presence.isRetired);
}

type WithPresence = {
  readonly presence: ParticipantPresence | null;
  readonly mergedInto?: string | null;
};
