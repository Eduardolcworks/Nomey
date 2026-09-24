/**
 * PERSISTIR UNA INTENCIÓN, y decir la verdad sobre si quedó persistida.
 *
 * Los pasos 1 a 3 de F07/ADR-001 §1 —construir y validar el payload UNA vez,
 * asociarle la clave, escribir clave y payload atómicamente— viven aquí, fuera
 * del hook, por dos motivos. El primero es que así se prueban contra un SQLite
 * real y **con la base fallando**, que el hook no permite en Vitest porque
 * arrastra `expo-sqlite`. El segundo es la regla que F7.D tendrá que respetar:
 * **la hoja sólo se cierra si esto devolvió `ok`**. Un fallo de la base no
 * puede demostrar que la clave y el payload estén en disco, así que devuelve
 * fallo y el borrador se queda donde estaba, con la persona delante.
 *
 * Un fallo aquí **no envía nada por la puerta directa**: saltarse la cola para
 * salvar el gasto dejaría dos rutas de escritura activas, que es exactamente lo
 * que F7.D va a impedir. Y no reintenta con otra clave: no hay nada que
 * reintentar, porque nada salió.
 */

import { buildPayload, type EntryDraft } from './movement-entry';
import type { QueueCommandType } from '@/lib/offline/command';
import { newQueueEntry } from '@/lib/offline/queue-entry';
import type { QueueStore } from '@/lib/offline/queue-store';

export type EntryScope = {
  readonly scopeId: string;
  /** La moneda DECLARADA: desde F11 puede no ser la base del ámbito. */
  readonly currencyDefinitionId: string;
  readonly currencyCode: string;
  readonly currencyScale: number;
  /**
   * La base del ámbito, SÓLO cuando la moneda declarada no lo es (F11/ADR-001
   * §10). Viaja hasta el payload como `expected_base_currency_definition_id`:
   * es lo que el servidor compara bajo el cerrojo contra la base vigente antes
   * de resolver ningún tipo, y sin ella tomaría la moneda declarada como base
   * asumida y rechazaría el alta.
   *
   * **No se guarda en la entrada de la cola**: lo que se congela es el payload
   * ya construido (F07/ADR-001 §7), y la moneda de la entrada —la que la
   * proyección usa para pintar y para decidir si agrega— es la DECLARADA.
   */
  readonly baseCurrencyDefinitionId?: string;
};

/** Por qué no quedó persistida. */
export type PersistFailure = 'invalidDraft' | 'storeUnavailable';

export type PersistOutcome =
  | { readonly ok: true; readonly clientOperationId: string }
  | { readonly ok: false; readonly reason: PersistFailure };

export async function persistEntry(
  store: QueueStore,
  input: {
    readonly actorId: string;
    readonly draft: EntryDraft;
    readonly scope: EntryScope;
    /** Generada por quien llama, ANTES de persistir y nunca después. */
    readonly key: string;
    readonly createdAt: string;
    /**
     * La entrada terminal que esta intención sustituye, si viene de `Revisar`.
     *
     * Con ella, persistir **es** resolver: `replace` inserta la nueva y borra la
     * vieja dentro de una sola transacción, así que no hay ningún instante con
     * las dos ni con ninguna (F07/ADR-001 §15, F07/ADR-002 §4). Sin ella, un alta
     * corriente: sólo se inserta.
     */
    readonly replacing?: string | null;
  },
): Promise<PersistOutcome> {
  // 1 · el payload, UNA vez, y con la clave ya dentro.
  const payload = buildPayload(input.draft, input.scope, input.key);
  if (payload === null) return { ok: false, reason: 'invalidDraft' };

  const commandType: QueueCommandType =
    input.draft.kind === 'income' ? 'personal_income.create' : 'personal_expense.create';

  // 3 · persistir, atómicamente y ANTES de cualquier petición.
  const entry = newQueueEntry({
    clientOperationId: input.key,
    actorId: input.actorId,
    scopeId: input.scope.scopeId,
    commandType,
    payload,
    currency: {
      definitionId: input.scope.currencyDefinitionId,
      code: input.scope.currencyCode,
      scale: input.scope.currencyScale,
    },
    createdAt: input.createdAt,
  });

  try {
    const replacing = input.replacing ?? null;
    if (replacing === null) await store.enqueue(entry);
    else await store.replace(input.actorId, replacing, entry);
  } catch {
    /*
     * La inserción es una sola sentencia (F07/ADR-001 §7): o está entera o no está.
     * Lo que no se puede saber desde aquí es CUÁL de las dos, así que se dice
     * lo único honesto —no quedó demostrada— y quien llama no cierra la hoja.
     * Qué error fue no se guarda: podría arrastrar el SQL, y §19 pide no
     * registrar nada cercano al contenido.
     */
    return { ok: false, reason: 'storeUnavailable' };
  }

  return { ok: true, clientOperationId: input.key };
}
