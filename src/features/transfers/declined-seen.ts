import type { CatalogueCache } from '@/lib/offline';

import type { TransferProposal } from './proposal';

/**
 * «VISTO» PARA UNA NOVEDAD INFORMATIVA, y sólo para ella.
 *
 * Hay dos clases de punto en la campana, y ésta es la segunda. Una propuesta
 * ENTRANTE pendiente es una ACCIÓN: el punto se queda hasta aceptar o
 * rechazar, y entrar en Notificaciones no la toca — no hay marca de visto
 * para ella, ni aquí ni en ningún sitio. Un rechazo de una propuesta propia
 * es una NOVEDAD: nada que hacer, sólo algo que saber, y entrar en la
 * campana es haberlo sabido. Ese «ya lo sé» es lo único que se guarda.
 *
 * **Lo visto es un conjunto de identidades de propuesta**, no una fecha ni
 * una cifra: el id es estable, lo publica la vista y no dice nada económico.
 * Ni importe, ni moneda, ni contraparte, ni saldo entran aquí.
 *
 * **Se guarda por actor, en el documento opaco de `catalogue_cache`**: el
 * mismo sitio y el mismo patrón que `incident.seen` (F07/ADR-001 §16),
 * información de presentación y nunca económica. Se poda al escribir: sólo
 * quedan los ids de rechazos que el servidor sigue publicando como recientes
 * (`isRecentDecline`), así que no crece con el uso — a los siete días de la
 * propuesta la fila deja de ser novedad y su marca se va con ella.
 */
export const DECLINED_SEEN_KEY = 'transfer.declined.seen';

export type SeenDeclines = ReadonlySet<string>;

export const NO_SEEN_DECLINES: SeenDeclines = new Set();

/** El documento guardado, o ninguno si no hay o está corrupto. */
export function parseSeenDeclines(document: string | null): SeenDeclines {
  if (document === null) return NO_SEEN_DECLINES;
  try {
    const parsed: unknown = JSON.parse(document);
    if (!Array.isArray(parsed)) return NO_SEEN_DECLINES;
    return new Set(parsed.filter((one): one is string => typeof one === 'string'));
  } catch {
    return NO_SEEN_DECLINES;
  }
}

export function serializeSeenDeclines(seen: SeenDeclines): string {
  return JSON.stringify([...seen].sort());
}

/** Los rechazos que aún no se han visto: los que encienden el punto informativo. */
export function unseenDeclines(
  declined: readonly TransferProposal[],
  seen: SeenDeclines,
): readonly TransferProposal[] {
  return declined.filter((one) => !seen.has(one.proposalId));
}

/**
 * Lo visto tras entrar en la campana con `shown` delante: lo que ya estaba
 * visto y siguiera publicado, más lo que se acaba de enseñar. Lo que ya no
 * existe se poda.
 */
export function seenDeclinesAfterVisit(
  seen: SeenDeclines,
  existing: readonly TransferProposal[],
  shown: readonly string[],
): SeenDeclines {
  const alive = new Set(existing.map((one) => one.proposalId));
  const next = new Set<string>();
  for (const id of seen) if (alive.has(id)) next.add(id);
  for (const id of shown) if (alive.has(id)) next.add(id);
  return next;
}

export async function readSeenDeclines(
  cache: CatalogueCache,
  actorId: string,
): Promise<SeenDeclines> {
  const cached = await cache.read(actorId, DECLINED_SEEN_KEY);
  return parseSeenDeclines(cached?.document ?? null);
}

export async function writeSeenDeclines(
  cache: CatalogueCache,
  actorId: string,
  seen: SeenDeclines,
  now: string,
): Promise<void> {
  await cache.write(actorId, DECLINED_SEEN_KEY, serializeSeenDeclines(seen), now);
}

/**
 * Hay más de una lectura viva —la del punto en cada barra y la de la
 * campana— y cada una lee por su cuenta. Sin esto, el punto seguiría
 * encendido hasta la siguiente recarga de propuestas.
 */
const listeners = new Set<(actorId: string) => void>();

export function subscribeDeclinesSeen(listener: (actorId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishDeclinesSeen(actorId: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(actorId);
    } catch {
      // Un oyente roto no convierte un marcado correcto en un fallo.
    }
  }
}

/** Sólo para las pruebas: ningún oyente sobrevive a un módulo reiniciado. */
export function resetDeclinesSeenListeners(): void {
  listeners.clear();
}
