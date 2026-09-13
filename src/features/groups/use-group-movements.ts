import { useCallback, useEffect, useState } from 'react';

import type { SessionStatus } from '@/lib/offline';

import { subscribeGroupRecorded } from './group-events';
import type { MovementFilters } from './movement-filters';
import type { GroupBalanceRow, GroupOperation, GroupOrder, GroupTotals } from './group-service';
import { fetchGroupBalances, fetchGroupOperations, fetchGroupSummary } from './group-service';
import { fetchGroupPayments, fetchReopenedPairs, type GroupPayment } from './payment-service';
import type { ReopenedPair } from './suggested-payments';

/**
 * LOS GASTOS DE UN GRUPO Y SUS TRES CIFRAS, LEÍDOS DEL SERVIDOR.
 *
 * ═══════════ POR QUÉ ESTO NO TIENE RESPALDO SIN CONEXIÓN ═══════════
 *
 * `useGroups` y `useGroupParticipants` sí lo tienen, y no es una incoherencia:
 * lo que ellos leen de la cola son grupos y participantes que **este aparato
 * declaró** y que todavía no han viajado, así que la cola es la única que los
 * tiene. Un gasto compartido no pasa por la cola —se escribe contra la frontera
 * o no se escribe—, de modo que no hay una segunda fuente que consultar. Sin
 * red no hay lista, y se dice que no la hay en vez de enseñar una vacía.
 *
 * **El listado y el resumen se piden por separado, y el resumen NO se deriva de
 * la lista.** Sumar la página traída daría un total que parece correcto y que
 * deja de serlo en cuanto haya más de una página —PostgREST corta en
 * `max_rows`—. El agregado lo hace `api.group_summary` en SQL, sobre todos los
 * efectos vigentes.
 *
 * **El orden se pide al servidor**, no se aplica a lo ya traído: ordenar aquí
 * ordenaría sólo la página, y «mayor gasto» dejaría fuera precisamente los
 * mayores que no cupieron.
 *
 * **Se relee cuando se escribe un gasto en ESTE grupo**, avisado por
 * `group-events`. No al recuperar el foco: cancelar la ventana no cambia nada
 * que leer.
 *
 * ═══════════ UNA RESPUESTA VIEJA NO SE PINTA COMO NUEVA ═══════════
 *
 * Cambiar de filtro o de orden lanza otra consulta mientras la anterior puede
 * seguir en vuelo, y las respuestas no vuelven necesariamente en orden. La
 * limpieza del efecto marca la petición anterior como muerta antes de lanzar la
 * siguiente, así que **una respuesta que llega tarde se descarta en vez de
 * pintarse sobre la que corresponde a lo que se está pidiendo ahora**. Sin eso,
 * dos toques rápidos pueden dejar en pantalla una lista que no cumple el filtro
 * que el botón dice tener puesto.
 *
 * **El resumen NO se filtra.** Las tres cifras describen el grupo entero; se
 * vuelve a leer con la lista sólo para no mezclar dos instantes en la misma
 * pantalla.
 */
export type GroupMovementsState = {
  /** `null` mientras no se ha podido leer ninguna vez. Nunca una lista falsa. */
  readonly operations: readonly GroupOperation[] | null;
  /** `null` si no se ha podido leer; sin fila en el servidor son ceros reales. */
  readonly totals: GroupTotals | null;
  readonly loading: boolean;
  /**
   * Los saldos del grupo. `null` mientras no se han podido leer.
   *
   * **Se piden con la lista pero NO se filtran**: los filtros acotan qué
   * movimientos se ven, no quién debe cuánto. Van juntos para no mezclar dos
   * instantes del mismo grupo en la misma pantalla.
   */
  readonly balances: readonly GroupBalanceRow[] | null;
  /**
   * Los pagos registrados VIGENTES del grupo (F09/ADR-007). `null` mientras no se
   * han podido leer. **No se filtran ni se ordenan con los gastos**: los
   * filtros hablan de categoría, pagador e importe de un gasto, y un pago no
   * tiene ninguna de las tres cosas. Van con la misma lectura para no mezclar
   * dos instantes del mismo grupo.
   */
  readonly payments: readonly GroupPayment[] | null;
  /**
   * Los pares REABIERTOS con quien salió que la parte activa puede saldar
   * (F09/ADR-007 C6, excepción 2). Van con los saldos: Pagos sugeridos los
   * necesita para proponerlos, y los dos describen el mismo instante.
   */
  readonly reopened: readonly ReopenedPair[] | null;
  /** La consulta falló. La lista de antes, si la había, sigue valiendo. */
  readonly failed: boolean;
  /** Volver a intentarlo. Es lo que ofrece el estado de error, no un botón mudo. */
  readonly retry: () => void;
};

export function useGroupMovements(
  scopeId: string,
  status: SessionStatus,
  order: GroupOrder,
  filters: MovementFilters,
): GroupMovementsState {
  const [operations, setOperations] = useState<readonly GroupOperation[] | null>(null);
  const [totals, setTotals] = useState<GroupTotals | null>(null);
  const [balances, setBalances] = useState<readonly GroupBalanceRow[] | null>(null);
  const [payments, setPayments] = useState<readonly GroupPayment[] | null>(null);
  const [reopened, setReopened] = useState<readonly ReopenedPair[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  /*
   * Los cuatro campos del filtro, sueltos: son las dependencias reales del
   * efecto. Con el objeto entero, que el panel rehace en cada render, la
   * comparación por referencia lanzaría una consulta por cada fotograma
   * mientras alguien arrastra un extremo de la barra.
   */
  const { minMinor, maxMinor, categoryId, payerId } = filters;

  const retry = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  /* Alguien acaba de escribir un gasto aquí: hay algo nuevo que leer. */
  useEffect(() => {
    return subscribeGroupRecorded((changed) => {
      if (changed === scopeId) setTick((value) => value + 1);
    });
  }, [scopeId]);

  useEffect(() => {
    if (scopeId === '' || status !== 'signed-in') return;
    let alive = true;

    void (async () => {
      /*
       * Dentro del cuerpo asíncrono a propósito: un `setState` síncrono en el
       * cuerpo del efecto encadena un render de más en cada cambio de orden, y
       * la regla de `react-hooks` lo señala. Aquí ya es un microtask.
       */
      if (alive) setLoading(true);
      try {
        /*
         * Las dos a la vez, y las dos completas o ninguna. Enseñar la lista con
         * un resumen viejo —o al revés— sería mostrar dos verdades del mismo
         * grupo en la misma pantalla.
         */
        const [rows, summary, positions, transfers, pairs] = await Promise.all([
          fetchGroupOperations(scopeId, order, {
            minMinor,
            maxMinor,
            categoryId,
            payerId,
          }),
          fetchGroupSummary(scopeId),
          fetchGroupBalances(scopeId),
          fetchGroupPayments(scopeId),
          fetchReopenedPairs(scopeId),
        ]);
        if (!alive) return;
        setOperations(rows);
        setBalances(positions);
        setPayments(transfers);
        setReopened(pairs);
        setTotals(
          /*
           * SIN FILA ES CERO DE VERDAD, y por eso se puede afirmar: la vista
           * agrupa los efectos vigentes del ámbito, y quien es miembro los ve
           * todos —la RLS filtra por membresía, no por autoría—. Ninguna fila
           * significa ningún efecto, es decir, ningún gasto.
           */
          summary ?? {
            totalMinor: '0',
            yourShareMinor: '0',
            netPositionMinor: '0',
            /*
             * Sin efectos no hay gasto que medir, así que el mayor gasto del
             * grupo es cero de verdad y no un relleno: es la misma ausencia
             * comprobable que las otras tres cifras. Lo que NO se rellena es un
             * máximo que no se pudo LEER — ese caso deja `totals` en `null`.
             */
            maxTotalMinor: '0',
            expenseCount: 0,
          },
        );
        setFailed(false);
      } catch {
        // No se vacía lo que ya había: un fallo de red no borra un gasto.
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [scopeId, status, order, tick, minMinor, maxMinor, categoryId, payerId]);

  return { operations, totals, balances, payments, reopened, loading, failed, retry };
}
