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
