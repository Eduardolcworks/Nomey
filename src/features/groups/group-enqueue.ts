/**
 * PERSISTIR LA CREACIÓN DE UN GRUPO, y decir la verdad sobre si quedó escrita.
 *
 * Mismo contrato que `persistEntry` de Personal, y por las mismas razones
 * (F07/ADR-001 §1): el payload se construye y se valida **una vez**, la clave se le
 * asocia antes, y clave y payload se escriben atómicamente **antes de cualquier
 * petición**. Vive fuera del formulario para poder probarse contra un SQLite
 * real y con la base fallando.
 *
 * **La ventana sólo se cierra si esto devolvió `ok`.** Un fallo de la base no
 * demuestra que nada esté en disco, así que devuelve fallo, el formulario se
 * queda con todos sus datos, y nada finge que el grupo exista.
 *
 * Un fallo aquí **no llama a `api.create_group` por la puerta directa**: serían
 * dos rutas de escritura activas, que es justo lo que la barrera durable impide.
 * Y no reintenta con otra clave: no hay nada que reintentar, porque nada salió.
 */

import type { GroupCreatePayload, QueueCommandType } from '@/lib/offline/command';
import { payloadDefect } from '@/lib/offline/command';
import { newQueueEntry } from '@/lib/offline/queue-entry';
import type { QueueStore } from '@/lib/offline/queue-store';

import {
  type GroupDraft,
  isDraftComplete,
  normaliseName,
  type ParticipantRow,
} from './group-draft';

/** La versión del contrato del payload de `group.create`. */
export const GROUP_CREATE_CONTRACT_VERSION = 1;

const COMMAND_TYPE: QueueCommandType = 'group.create';

/**
 * Las identidades de una creación. **Generadas una sola vez, por quien llama.**
 *
 * Ninguna se regenera: ni en un reintento, ni al reabrir la app, ni al remontar
 * el formulario. Es lo que hace que un replay devuelva el mismo grupo con la
 * misma gente, en vez de crear otro.
 */
export type GroupIdentities = {
  /** La clave de idempotencia del comando, anterior al primer intento. */
  readonly clientCommandId: string;
  /** La identidad DEFINITIVA del ámbito: la tarjeta y la ruta ya la usan. */
  readonly clientGroupId: string;
  /** El participante contextual de quien crea. */
  readonly creatorParticipantId: string;
};

/** Por qué no quedó persistida. */
export type GroupPersistFailure = 'invalidDraft' | 'invalidPayload' | 'storeUnavailable';

export type GroupPersistOutcome =
  | { readonly ok: true; readonly payload: GroupCreatePayload }
  | { readonly ok: false; readonly reason: GroupPersistFailure };

/**
 * Los participantes que de verdad van al comando.
 *
 * **El oblongo final vacío no entra**: es un hueco para escribir, no alguien. Ni
 * tampoco la fila del creador, que viaja aparte porque es la única con cuenta
 * detrás.
 *
 * Los nombres van ya canonicalizados. La cola rechaza por forma uno que no lo
 * esté, porque congelar otra cosa haría que el servidor entendiera una intención
 * distinta de la guardada y leyera un reintento legítimo como clave reutilizada.
 */
export function payloadParticipants(rows: readonly ParticipantRow[]) {
  return rows
    .filter((row) => !row.owner && normaliseName(row.name) !== '')
    .map((row) => ({ client_participant_id: row.id, display_name: normaliseName(row.name) }));
}

/**
 * El payload congelado de una creación, o `null` si el borrador no vale.
 *
 * **Se construye UNA vez.** El mismo objeto alimenta la proyección local, la
 * intención canónica del servidor, el envío, el reintento y la reconciliación:
 * dos construcciones podrían diferir en un espacio y convertir un replay en un
 * `IDEMPOTENCY_KEY_REUSED`.
 */
export function buildGroupPayload(
  draft: GroupDraft,
  identities: GroupIdentities,
  creatorName: string,
): GroupCreatePayload | null {
  if (!isDraftComplete(draft) || draft.currencyId === null) return null;

  const nombre = normaliseName(draft.name);
  const creador = normaliseName(creatorName);
  if (nombre === '' || creador === '' || draft.emoji.trim() === '') return null;

  return {
    client_command_id: identities.clientCommandId,
    command_contract_version: GROUP_CREATE_CONTRACT_VERSION,
    client_group_id: identities.clientGroupId,
    display_name: nombre,
    emoji: draft.emoji,
    currency_definition_id: draft.currencyId,
    creator_participant_id: identities.creatorParticipantId,
    creator_display_name: creador,
    participants: payloadParticipants(draft.participants),
    /* Viaja en el comando durable: la proyección la enseña antes de confirmar. */
    default_category_id: draft.defaultCategoryId,
  };
}

/**
 * Cuánta gente hay en el grupo, contando a quien lo crea.
 *
 * Es la misma cuenta que devuelve el servidor en `participant_count`, y por eso
 * confirmarse no cambia el número que muestra la tarjeta.
 */
export function participantCount(payload: GroupCreatePayload): number {
  return 1 + payload.participants.length;
}

export async function persistGroup(
  store: QueueStore,
  input: {
    readonly actorId: string;
    readonly draft: GroupDraft;
    readonly identities: GroupIdentities;
    readonly creatorName: string;
    readonly currency: {
      readonly definitionId: string;
      readonly code: string;
      readonly scale: number;
    };
    readonly createdAt: string;
  },
): Promise<GroupPersistOutcome> {
  // 1 · el payload, UNA vez, con las identidades ya dentro.
  const payload = buildGroupPayload(input.draft, input.identities, input.creatorName);
  if (payload === null) return { ok: false, reason: 'invalidDraft' };

  /*
   * 2 · comprobado por FORMA antes de tocar el disco. Un payload que la cola no
   * admite no debe llegar a persistirse: reaparecería en cada arranque sin poder
   * enviarse nunca, y el fallo llegaría lejos del sitio donde se corrige.
   */
  if (payloadDefect(COMMAND_TYPE, payload) !== null) {
    return { ok: false, reason: 'invalidPayload' };
  }

  const entry = newQueueEntry({
    /*
     * **La clave del comando ES el identificador de la entrada.** La cola indexa
     * por `clientOperationId`, así que dos pulsaciones no producen dos filas: la
     * segunda choca con la primera en la propia tienda.
     */
    clientOperationId: input.identities.clientCommandId,
    actorId: input.actorId,
    /*
     * **El ámbito de la entrada es el grupo que va a nacer.** No existe todavía
     * en el servidor, y no pasa nada: `scope_id` aquí es de quién habla la
     * entrada, y esa identidad ya es la definitiva.
     */
    scopeId: input.identities.clientGroupId,
    commandType: COMMAND_TYPE,
    payload,
    currency: input.currency,
    createdAt: input.createdAt,
  });

  // 3 · persistir, atómicamente y ANTES de cualquier petición.
  try {
    await store.enqueue(entry);
  } catch {
    /*
     * La inserción es una sola sentencia (F07/ADR-001 §7): o está entera o no está.
     * Desde aquí no se puede saber cuál de las dos, así que se dice lo único
     * honesto —no quedó demostrada— y quien llama no cierra la ventana. Qué
     * error fue no se registra: arrastraría el SQL, y §19 pide no registrar nada
     * cercano al contenido.
     */
    return { ok: false, reason: 'storeUnavailable' };
  }

  return { ok: true, payload };
}
