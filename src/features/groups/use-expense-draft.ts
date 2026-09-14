import { useEffect, useState } from 'react';

import type { SessionStatus } from '@/lib/offline';

import { fetchGroupOperations, fetchGroupSplit, type GroupOperation } from './group-service';
import { allOf } from './movement-filters';
import { draftOf, type SharedExpenseDraft } from './shared-expense';

/**
 * LOS VALORES VIGENTES DE UN GASTO, para corregirlo.
 *
 * ═══════════ QUÉ SE CARGA, Y POR QUÉ EN DOS CONSULTAS ═══════════
 *
 * La operación trae importe, concepto, categoría, fecha, pagador y método;
 * `api.group_split_participant` trae **lo declarado** por participante. Son dos
 * relaciones distintas y ninguna de las dos se puede deducir de la otra: las
 * cuotas resueltas que la lista publica no dicen si el reparto fue «igualmente»
 * o «por partes iguales», y con un resto asignado por el desempate de F01/ADR-001 §5
 * tampoco dicen cuántas partes declaró nadie.
 *
 * **La versión vigente es la que se lee, y la que viaja.** El `expected_version_id`
 * que la corrección manda sale de aquí, así que corresponde a lo que se está
 * enseñando; si alguien la cambia entre la carga y el guardado, el CAS del
 * servidor lo rechaza — que es exactamente lo que debe pasar.
 *
 * **Sin conexión no hay corrección.** Un gasto compartido no pasa por la cola
 * durable, así que no hay una segunda fuente de la que sacar sus valores: se
 * dice que no se pudo cargar en vez de abrir un formulario en blanco que al
 * guardarse sustituiría el gasto por lo poco que hubiera dentro.
 */
export type ExpenseDraftState = {
  /** El gasto vigente. `null` mientras no se ha podido leer. */
  readonly operation: GroupOperation | null;
  /** Su borrador ya reconstruido, listo para el formulario. */
  readonly draft: SharedExpenseDraft | null;
  readonly loading: boolean;
  readonly failed: boolean;
};

export function useExpenseDraft(
  scopeId: string,
  operationId: string | null,
  status: SessionStatus,
  scale: number,
): ExpenseDraftState {
  const [operation, setOperation] = useState<GroupOperation | null>(null);
  const [draft, setDraft] = useState<SharedExpenseDraft | null>(null);
  const [loading, setLoading] = useState(operationId !== null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (operationId === null || scopeId === '' || status !== 'signed-in') return;
    let alive = true;

    void (async () => {
      if (alive) setLoading(true);
      try {
        /*
         * La operación se pide POR SU ÁMBITO y se busca aquí en vez de con un
         * filtro por identidad: la vista no publica un acceso por operación, y
         * el ámbito ya está acotado por la RLS de la membresía. Sin filtro de
         * importe ni de categoría —`allOf()`—, porque lo que se busca es ESTE
         * gasto, esté o no dentro de lo que la lista enseña ahora mismo.
         */
        const rows = await fetchGroupOperations(scopeId, 'dateDesc', allOf());
        const found = rows.find((one) => one.operationId === operationId) ?? null;
        if (found === null) {
          if (alive) setFailed(true);
          return;
        }

        const split = await fetchGroupSplit(found.versionId);
        if (!alive) return;

        setOperation(found);
        setDraft(draftOf(found, split, scale));
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [scopeId, operationId, status, scale]);

  return { operation, draft, loading, failed };
}
