import type { CatalogueCache } from '@/lib/offline';

import type { Incident } from './incidents';

/**
 * «VISTO» NO ES «RESUELTO».
 *
 * Una incidencia se resuelve reintentando, revisando o descartando, y eso es
 * lo único que la quita de la campana. Pero el punto amarillo de la barra no
 * dice «tienes incidencias»: dice «hay algo que aún no has visto». Entrar en
 * la campana lo apaga; resolver, no hace falta. Las dos cosas se guardan
 * aparte para que ninguna se confunda con la otra.
 *
 * **Lo visto es un conjunto de identidades**, no una fecha: cada incidencia es
 * un comando de la cola con su clave, y reintentar crea un comando nuevo con
 * otra clave, así que un segundo fallo es una incidencia nueva y vuelve a
 * encender el punto. Nada que ocurra después de entrar se da por visto por
 * haber entrado.
 *
 * **Se guarda por actor, en el documento opaco de `catalogue_cache`**: la
 * misma capa que conserva las categorías (F07/ADR-001 §16), información de
 * presentación y nunca económica. `lib/` no sabe qué hay dentro; la clave y
 * el formato son de esta feature. Se poda al escribir: sólo quedan las claves
 * de incidencias que siguen existiendo, así que no crece con el uso.
 */
export const INCIDENT_SEEN_KEY = 'incident.seen';

export type SeenIncidents = ReadonlySet<string>;

export const NO_SEEN: SeenIncidents = new Set();

/** El documento guardado, o ninguno si no hay o está corrupto. */
export function parseSeen(document: string | null): SeenIncidents {
  if (document === null) return NO_SEEN;
  try {
    const parsed: unknown = JSON.parse(document);
    if (!Array.isArray(parsed)) return NO_SEEN;
    return new Set(parsed.filter((one): one is string => typeof one === 'string'));
  } catch {
    return NO_SEEN;
  }
}

export function serializeSeen(seen: SeenIncidents): string {
  return JSON.stringify([...seen].sort());
}

/** Las que aún no se han visto: las que encienden el punto. */
export function unseenIncidents(
  incidents: readonly Incident[],
  seen: SeenIncidents,
): readonly Incident[] {
  return incidents.filter((one) => !seen.has(one.clientOperationId));
}

/**
 * Lo visto tras entrar en la campana con `shown` delante: lo que ya estaba
 * visto y siguiera existiendo, más lo que se acaba de enseñar. Lo que ya no
 * existe se poda.
 */
export function seenAfterVisit(
  seen: SeenIncidents,
  existing: readonly Incident[],
  shown: readonly string[],
): SeenIncidents {
  const alive = new Set(existing.map((one) => one.clientOperationId));
  const next = new Set<string>();
  for (const key of seen) if (alive.has(key)) next.add(key);
  for (const key of shown) if (alive.has(key)) next.add(key);
  return next;
}

export async function readSeen(cache: CatalogueCache, actorId: string): Promise<SeenIncidents> {
  const cached = await cache.read(actorId, INCIDENT_SEEN_KEY);
  return parseSeen(cached?.document ?? null);
}

export async function writeSeen(
  cache: CatalogueCache,
  actorId: string,
  seen: SeenIncidents,
  now: string,
): Promise<void> {
  await cache.write(actorId, INCIDENT_SEEN_KEY, serializeSeen(seen), now);
}

/**
 * Hay más de una lista de incidencias viva —la del punto y la de la campana—
 * y cada una lee por su cuenta. Sin esto, el punto seguiría encendido hasta
 * el siguiente cambio de la cola.
 */
const listeners = new Set<(actorId: string) => void>();

export function subscribeIncidentsSeen(listener: (actorId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishIncidentsSeen(actorId: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(actorId);
    } catch {
      // Un oyente roto no convierte un marcado correcto en un fallo.
    }
  }
}
