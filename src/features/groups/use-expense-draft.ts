import { useEffect, useState } from 'react';

import { type CurrencyDefinition, currencyDefinition } from '@/domain';
import type { CurrencyOption } from '@/lib/currency';
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
  /**
   * LA MONEDA EN LA QUE ESTÁ ESCRITO ESE BORRADOR (F11/ADR-003).
   *
   * La del grupo cuando el gasto no se convirtió, y la DECLARADA cuando sí.
   * Va resuelta —código y escala— porque sin la escala el borrador no se puede
   * ni leer ni volver a escribir.
   */
  readonly declaredCurrency: CurrencyDefinition | null;
  readonly loading: boolean;
  readonly failed: boolean;
};

export function useExpenseDraft(
  scopeId: string,
  operationId: string | null,
  status: SessionStatus,
  /** La divisa BASE del grupo, ya resuelta. */
  base: CurrencyDefinition,
  /**
   * El catálogo indexado, o `null` mientras no ha llegado.
   *
   * **Sin él no se lee nada**, y no es una precaución de más: un gasto
   * declarado en yenes se guarda con escala 0, y reconstruir su borrador con
   * la escala del grupo convertiría 150 000 ¥ en 1 500,00 — un importe
   * creíble, que al guardarse habría sustituido al de verdad.
   */
  currencies: ReadonlyMap<string, CurrencyOption> | null,
): ExpenseDraftState {
  const [operation, setOperation] = useState<GroupOperation | null>(null);
  const [draft, setDraft] = useState<SharedExpenseDraft | null>(null);
  const [declaredCurrency, setDeclaredCurrency] = useState<CurrencyDefinition | null>(null);
  const [loading, setLoading] = useState(operationId !== null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (operationId === null || scopeId === '' || status !== 'signed-in') return;
    if (currencies === null) return;
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

        /*
         * La moneda en la que está escrito lo que se va a corregir. Si el
         * catálogo no la conoce no se abre nada: es preferible decir que no se
         * pudo cargar a enseñar una cifra con la escala equivocada.
         */
        const declaredId = found.originalCurrencyId ?? base.id;
        let declared = base;
        if (declaredId !== base.id) {
          const option = currencies.get(declaredId);
          if (option === undefined) {
            if (alive) setFailed(true);
            return;
          }
          declared = currencyDefinition(option);
        }

        setOperation(found);
        setDeclaredCurrency(declared);
        setDraft(draftOf(found, split, declared.scale));
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
  }, [scopeId, operationId, status, base, currencies]);

  return { operation, draft, declaredCurrency, loading, failed };
}
