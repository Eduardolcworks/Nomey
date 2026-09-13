import type { CalendarDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';

import type { ParticipantPresence } from './participant-presence';

export {
  activeByDefault,
  eligibleOn,
  listed,
  type ParticipantPresence,
} from './participant-presence';

/**
 * LOS PARTICIPANTES DE UN GRUPO, tal y como los publica `api`.
 *
 * `api.group_participant` es una vista `security_invoker`, así que quien decide
 * qué filas se ven es la RLS de la membresía bajo la identidad real. No se
 * añade aquí ningún `.eq('user_id', …)`: un filtro de cliente nunca es una
 * autorización, y la regla del proyecto es explícita al respecto.
 *
 * ═══════════ TRES COSAS QUE ESTA VISTA NO DICE, Y NO SE SUPLEN ═══════════
 *
 * **1. Quién de ellos tiene cuenta, y cuál.** La vista no publica
 * `core.participant_user_link` a propósito: revelaría qué identidad global hay
 * detrás de una identidad contextual (F03/ADR-009 §1). Consecuencia directa para
 * esta pantalla: **el cliente no sabe cuál de los participantes es quien
 * registra**, así que el pagador no se puede poner por defecto. Adivinarlo por
 * nombre sería exactamente lo que F03/ADR-009 §3 prohíbe —un parecido no es prueba
 * de identidad— y coger al primero sería peor, porque acertaría a veces.
 *
 * **2. Quién es miembro autorizado.** Un participante es una identidad
 * contextual dentro del ámbito; la membresía es lo que da acceso. Son dos
 * hechos distintos y F03/ADR-009 §4 exige no confundirlos: en esta pantalla se
 * reparte entre PARTICIPANTES, que pueden no tener cuenta ninguna.
 *
 * **3. Cuándo estuvo cada uno.** Desde F09/ADR-003 la vista publica la presencia
 * RESUMIDA —no los periodos—: `is_active` (periodo abierto), `eligible_until`
 * (el límite EXCLUSIVO del último periodo, nulo si activo) e `is_retired` (los
 * miembros lo dieron por saldado). El cliente aplica exactamente la desigualdad
 * de la frontera, `fecha < eligible_until`, y nada más: quien evalúa de verdad
 * la elegibilidad sigue siendo `sec.assert_participant_eligible` (F03/ADR-009 §7).
 * Una creación local todavía sin reconciliar no lo sabe: `presence` es `null`,
 * y con `null` no se descarta a nadie, para no inventar la presencia que falta.
 */
export type GroupParticipant = {
  readonly participantId: string;
  readonly displayName: string;
  /** Para un orden estable: es el desempate del céntimo sobrante. */
  readonly createdAt: string;
  /** La presencia resumida que publica `api.group_participant`, o `null` si no se sabe. */
  readonly presence: ParticipantPresence | null;
  /**
   * Si esta identidad contextual es la de quien está mirando.
   *
   * `null` significa **no se sabe**: una creación local sin reconciliar no lo
   * sabe de nadie más que del creador. No es lo mismo que `false`, y la
   * diferencia importa: con `false` la pantalla afirmaría que este participante
   * NO es quien mira.
   *
   * Del servidor llega `is_self`, que `api.group_participant` responde SÓLO
   * sobre el actor (`sec.is_my_participant`): dice si este participante es
   * quien mira, y nunca qué cuenta hay detrás de los demás (F03/ADR-009 §1). Es lo
   * que deja «Pagado por» en quien mira, por defecto, en un gasto nuevo.
   */
  readonly isSelf: boolean | null;
  /**
   * Si hay UNA CUENTA detrás de esta identidad contextual. Sólo el hecho,
   * nunca cuál (`sec.participant_is_linked`): no es `isSelf`, y no se deduce
   * del nombre ni de `isActive` —un participante sin cuenta puede estar activo
   * para el reparto—. `null` en una creación local sin reconciliar: no se sabe.
   */
  readonly isLinked: boolean | null;
  /**
   * Si algún efecto vigente lo nombra —cuota o deuda—. Decide la palabra:
   * «Eliminar» sin historial, «Retirar» con él; por debajo es la misma
   * retirada. `null` en una creación local sin reconciliar.
   */
  readonly hasHistory: boolean | null;
  /**
   * La reclamación que creó el vínculo PROPIO, o `null`: sólo sobre quien mira
   * (`sec.my_claim_command_id`), nunca sobre los demás. Que exista dice que
   * «procede de una reclamación rectificable» (F09/ADR-006 §1) y es lo que se cita
   * al rectificar; NO dice que pueda rectificarse ahora, que lo decide el
   * servidor bajo el cerrojo. `null` también en una creación local.
   */
  readonly claimCommandId: string | null;
  /**
   * Si esta identidad se ASOCIÓ a otra del grupo (F09/ADR-009): el destino. No se
   * lista ni se elige; su nombre es el del destino en todas partes, y sus
   * hechos siguen nombrándola por su id. `null` si es una identidad vigente.
   */
  readonly mergedInto: string | null;
};

/**
 * Los participantes de UN grupo, en orden estable.
 *
 * El orden importa más de lo que parece: es el desempate del reparto (F01/ADR-001
 * §5, paso 5), así que dos lecturas seguidas no pueden devolverlos al revés y
 * mover el céntimo sobrante a otra persona. Se ordena por alta y, a igualdad de
 * instante, por identidad — que es total y no depende de la configuración
 * regional, al contrario que comparar nombres.
 */
export async function fetchGroupParticipants(
  scopeId: string,
): Promise<readonly GroupParticipant[]> {
  const { data, error } = await supabase
    .from('group_participant')
    .select(
      'participant_id,display_name,created_at,is_self,is_active,eligible_until,is_retired,is_linked,has_history,claim_command_id,merged_into_participant_id',
    )
    .eq('scope_id', scopeId);
  if (error !== null) throw error;

  const rows = (data ?? []).flatMap((row) =>
    row.participant_id === null || row.display_name === null || row.created_at === null
      ? []
      : [
          {
            participantId: row.participant_id,
            displayName: row.display_name,
            createdAt: row.created_at,
            presence: {
              isActive: row.is_active ?? false,
              eligibleUntil: (row.eligible_until as CalendarDate | null) ?? null,
              isRetired: row.is_retired ?? false,
            },
            isSelf: row.is_self ?? null,
            isLinked: row.is_linked ?? null,
            hasHistory: row.has_history ?? null,
            claimCommandId: row.claim_command_id ?? null,
            mergedInto: row.merged_into_participant_id ?? null,
          },
        ],
  );

  return rows.sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.participantId.localeCompare(b.participantId),
  );
}
