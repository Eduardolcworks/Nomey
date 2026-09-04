/**
 * El estado del Modo Personal del actor, y su provisioning.
 *
 * **F6.A dejó `api.ensure_personal_scope` lista y la app no la llamaba.** Este
 * módulo es la mitad pura de ese cableado, que es la obligación que el handoff
 * marca como *obligatoria y antes de que Inicio consuma el ámbito*.
 *
 * Los cuatro requisitos de esa obligación, y dónde vive cada uno:
 *
 *   1  invocar al entrar en la experiencia autenticada .... `use-personal-scope`
 *   2  reintento seguro, por idempotencia de estado ....... la propia frontera
 *   3  fallo visible y RECUPERABLE, con salida ............ `unavailable`, aquí
 *   4  no dar por hecho que el ámbito existe .............. `provisioning`, aquí
 *
 * El cuarto es el que evita el fallo silencioso: una pantalla que asuma el
 * ámbito antes de tiempo lee cero filas y pinta ceros creíbles sin que nada
 * falle.
 */

import type { CatalogueCache } from '@/lib/offline';

/**
 * Cuatro estados, no un booleano — la misma forma que F5.B eligió para la
 * sesión, y por el mismo motivo: `hasScope: false` no distingue «todavía no
 * hemos mirado» de «hemos mirado y no hay», y esas dos pintan cosas distintas.
 */
export type PersonalScopeState =
  /** Todavía no se ha pedido nada. Ninguna cifra es legítima aquí. */
  | { readonly status: 'idle' }
  /** La llamada está en vuelo. Tampoco lo es. */
  | { readonly status: 'provisioning' }
  | {
      readonly status: 'ready';
      readonly scopeId: string;
      readonly currencyDefinitionId: string;
      readonly currencyCode: string;
      readonly currencyScale: number;
      /** `true` sólo si esta llamada lo creó. Informativo, nunca una condición. */
      readonly created: boolean;
    }
  /**
   * Error recuperable, con salida. **No es un callejón**: la forma la fijó
   * `unavailable` de F5.B y se reutiliza tal cual en vez de inventar otra.
   */
  | { readonly status: 'unavailable' };

export const IDLE: PersonalScopeState = { status: 'idle' };

/** Si el ámbito está listo, sus datos; si no, nada. Evita el `status ===` disperso. */
export function readyScope(
  state: PersonalScopeState,
): Extract<PersonalScopeState, { status: 'ready' }> | null {
  return state.status === 'ready' ? state : null;
}

/**
 * `true` mientras no se pueda afirmar que el Modo Personal existe.
 *
 * Es el predicado del requisito 4, con nombre, para que ninguna pantalla lo
 * escriba a mano y se le olvide un estado.
 */
export function isResolving(state: PersonalScopeState): boolean {
  return state.status === 'idle' || state.status === 'provisioning';
}

/** La forma que devuelve `api.ensure_personal_scope`. */
export type EnsureScopeResult = {
  readonly scope_id: string;
  readonly base_currency_definition_id: string;
  readonly currency_code: string;
  readonly currency_scale: number;
  readonly created: boolean;
};

export function scopeFromResult(result: EnsureScopeResult): PersonalScopeState {
  return {
    status: 'ready',
    scopeId: result.scope_id,
    currencyDefinitionId: result.base_currency_definition_id,
    currencyCode: result.currency_code,
    currencyScale: result.currency_scale,
    created: result.created,
  };
}

/**
 * La moneda que se recomienda al crear el ámbito.
 *
 * **Del código de la REGION, no del idioma.** `expo-localization` expone las
 * dos cosas y son distintas: alguien con el móvil en inglés viviendo en España
 * tiene `currencyCode: 'EUR'` por región y `languageCurrencyCode: 'USD'` por
 * idioma. El handoff lo señala expresamente como el error a evitar, y es la
 * misma distinción que F4.B ya fijó para el formato.
 *
 * **Es sólo una recomendación.** Quien decide es la persona, y si el código no
 * está en el catálogo la frontera resuelve su propio fallback: aquí no se
 * duplica esa lógica, sólo se le pasa lo que el dispositivo dice.
 */
export function recommendedCurrencyCode(
  locales: readonly { readonly currencyCode?: string | null }[],
): string | null {
  const code = locales[0]?.currencyCode;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

/**
 * THE RESOLVED SCOPE, KEPT FOR WHEN THERE IS NO NETWORK.
 *
 * `api.ensure_personal_scope` is idempotent by state and always returns the
 * same scope for the same account, but it needs the network. Without it the
 * entry sheet could not know WHERE a movement lands and Inicio could not paint
 * even the local intentions — exactly what ADR-028 §8 requires to be visible.
 * So the last correct result is stored per actor in the same document store as
 * the catalogue (§16) and used **only as a fallback** when the network fails.
 *
 * **It is not an economic cache**: it identifies the scope and its monetary
 * definition, with no figure of any kind.
 *
 * **And it can go stale in the one thing that matters.** The base currency of a
 * scope **with no effects** is changed by `api.set_personal_base_currency`,
 * which only refuses — `BASE_CURRENCY_LOCKED · 409` — once there are movements.
 * A freshly created scope is exactly that case, and it is the route ADR-028 §14
 * walks through with numbers. So this document can name a definition that is no
 * longer the current one, and **the ISO code will not give it away**: two
 * different definitions can both show "EUR" (ADR-003 §3, and
 * `core.currency_definition` deliberately has no uniqueness on `code`).
 *
 * What stops that from reinterpreting an amount is not this cache, but **that
 * no figure is ever derived from it**:
 *
 * - every queue entry freezes ITS definition when captured, and the projection
 *   aggregates by comparing that identity with the current one — never the code;
 * - an entry under another definition is still painted with its amount and its
 *   currency, and enters no aggregate (ADR-028 §14);
 * - and the boundary finishes the job: `CURRENCY_CONVERSION_UNSUPPORTED · 422`,
 *   state `conflict`, review.
 *
 * This document only says **where** a movement lands and under which definition
 * it is captured. Trusting it to aggregate would be the mistake; nothing does.
 */
export const SCOPE_CACHE_KEY = 'personal-scope';

const SCOPE_DOCUMENT_VERSION = 1;

type ReadyScope = Extract<PersonalScopeState, { status: 'ready' }>;

export function serializeScope(scope: ReadyScope): string {
  return JSON.stringify({
    v: SCOPE_DOCUMENT_VERSION,
    scopeId: scope.scopeId,
    currencyDefinitionId: scope.currencyDefinitionId,
    currencyCode: scope.currencyCode,
    currencyScale: scope.currencyScale,
  });
}

/**
 * The scope back, or `null` when the document cannot be believed. A recalled
 * scope never says `created: true`: this call did not create it.
 */
export function parseScope(document: string): ReadyScope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const shape = parsed as Record<string, unknown>;

  if (shape.v !== SCOPE_DOCUMENT_VERSION) return null;
  if (typeof shape.scopeId !== 'string' || shape.scopeId === '') return null;
  if (typeof shape.currencyDefinitionId !== 'string' || shape.currencyDefinitionId === '') {
    return null;
  }
  if (typeof shape.currencyCode !== 'string' || shape.currencyCode === '') return null;
  if (
    typeof shape.currencyScale !== 'number' ||
    !Number.isInteger(shape.currencyScale) ||
    shape.currencyScale < 0
  ) {
    return null;
  }

  return {
    status: 'ready',
    scopeId: shape.scopeId,
    currencyDefinitionId: shape.currencyDefinitionId,
    currencyCode: shape.currencyCode,
    currencyScale: shape.currencyScale,
    created: false,
  };
}

/**
 * GUARDA EL ÁMBITO RESUELTO, o dice por qué no.
 *
 * No lanza nunca: el respaldo es auxiliar y el servidor sigue mandando, así que
 * una base que falle no puede tumbar a quien acaba de entrar.
 *
 * **Sin actor no se escribe.** El documento está aislado por cuenta y un actor
 * vacío escribiría en una casilla que luego podría leer cualquiera. Es la misma
 * negativa que `rememberCategories`, y por el mismo motivo.
 */
export async function rememberScope(
  cache: CatalogueCache,
  actorId: string,
  scope: ReadyScope,
  now: string,
): Promise<'stored' | 'skippedNoActor' | 'failed'> {
  if (actorId === '') return 'skippedNoActor';
  try {
    await cache.write(actorId, SCOPE_CACHE_KEY, serializeScope(scope), now);
    return 'stored';
  } catch {
    // Sin registro: `AGENTS.md` §8.
    return 'failed';
  }
}

/**
 * EL ÁMBITO GUARDADO DE ESTA CUENTA, o `null`.
 *
 * `null` cubre los cuatro casos y no los distingue, porque quien llama hace lo
 * mismo con todos: sin actor, sin documento, documento que no se puede creer, y
 * base que no contesta.
 */
export async function recallScope(
  cache: CatalogueCache,
  actorId: string,
): Promise<ReadyScope | null> {
  if (actorId === '') return null;
  try {
    const document = await cache.read(actorId, SCOPE_CACHE_KEY);
    return document === null ? null : parseScope(document.document);
  } catch {
    return null;
  }
}
