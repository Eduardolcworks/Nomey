import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { rememberCategories } from './category-cache';
import type { CategoryRow } from './category';
import { indexCategories } from './category';
import { type DateRange, rangeKey } from './interval';
import type { BalanceObservation, PersonalOperation, PersonalOperationVersion } from './movement';
import { indexObservations, indexVersions, previousVersionIds } from './movement';
import {
  fetchBalance,
  fetchCategories,
  fetchObservations,
  fetchOperations,
  fetchStatistics,
  fetchVersions,
  PAGE_SIZE,
} from './personal-service';
import type { PersonalStatistics } from './statistics';
import { offlineCatalogueCache } from '@/lib/offline';

/**
 * Los datos de Inicio, y el plan de consultas que los trae.
 *
 * **El plan es explícito porque el rendimiento aquí es una decisión, no una
 * consecuencia.** Por visita, y como máximo:
 *
 *   1  saldo          `api.personal_balance`        no depende del intervalo
 *   2  catálogo       `api.category`                no depende del intervalo
 *   3  estadísticas   `api.personal_statistics`     por intervalo
 *   4  operaciones    `api.personal_operation`      por intervalo, paginada
 *   5  versiones      `…_version?…in.(…)`           sólo si hay «Editado»
 *   6  observaciones  `api.observed_balance([…])`   sólo al desplegar, una vez
 *
 * Lo que NO ocurre, y son las tres cosas que F6.D se diseñó para evitar: no hay
 * una llamada por movimiento, no hay una llamada por observación, y **el saldo
 * y los totales no se suman en el cliente** — los deriva el servidor y llegan
 * exactos aunque la lista venga paginada.
 *
 * Cambiar de intervalo **no** vuelve a pedir el saldo ni el catálogo: no
 * dependen de él, y viven en su propio efecto. Eso es todo el «evitar refetches
 * duplicados» que hace falta, sin caché.
 *
 * **Y hay una escritura local que no es una consulta**: tras cargar el catálogo
 * se guarda una copia para cuando no haya red (ADR-028 §16). Va **después** de
 * pintar, **no se espera** y **no puede fallar hacia fuera**; el servidor sigue
 * siendo la autoridad y esto es auxiliar. `actorId` está aquí por eso: el
 * documento se guarda **por cuenta**, y al cambiar de identidad el efecto vuelve
 * a correr con la nueva en vez de escribir en la casilla de la anterior.
 *
 * **El estado se DERIVA de qué intervalo hay cargado, no se escribe dentro del
 * efecto.** Un `setState` síncrono en el cuerpo de un efecto encadena renders
 * antes de que se pinte el primero; guardando junto a los datos el intervalo al
 * que pertenecen, «cargando» es simplemente que todavía no coinciden.
 */

export type HomeStatus = 'loading' | 'ready' | 'error';

export type PersonalHome = {
  readonly status: HomeStatus;
  /** `null` mientras carga o si no hay ámbito. Nunca `'0'` por defecto. */
  readonly balance: { amount: string; currencyId: string } | null;
  readonly statistics: PersonalStatistics | null;
  readonly operations: readonly PersonalOperation[];
  /** Cuántas hay en el intervalo, que puede ser más de las cargadas. */
  readonly total: number;
  readonly categories: ReadonlyMap<string, CategoryRow>;
  readonly versions: ReadonlyMap<string, PersonalOperationVersion>;
  readonly observations: ReadonlyMap<string, BalanceObservation>;
  readonly loadingMore: boolean;
  readonly loadMore: () => void;
  /** Pide las observaciones de la página. Idempotente y perezosa. */
  readonly ensureObservations: () => void;
  readonly refresh: () => void;
};

/** Lo cargado, con el intervalo al que pertenece. */
type Loaded = {
  readonly key: string;
  readonly statistics: PersonalStatistics | null;
  readonly operations: PersonalOperation[];
  readonly total: number;
  readonly versions: Map<string, PersonalOperationVersion>;
};

const EMPTY_VERSIONS: ReadonlyMap<string, PersonalOperationVersion> = new Map();
const EMPTY_OBSERVATIONS: ReadonlyMap<string, BalanceObservation> = new Map();
const EMPTY_OPERATIONS: readonly PersonalOperation[] = [];

export function usePersonalHome(ready: boolean, range: DateRange, actorId: string): PersonalHome {
  const key = rangeKey(range);

  const [balance, setBalance] = useState<PersonalHome['balance']>(null);
  const [categories, setCategories] = useState<ReadonlyMap<string, CategoryRow>>(new Map());
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  /** El intervalo cuya carga falló. Comparado con el actual, es el estado de error. */
  const [failed, setFailed] = useState<string | null>(null);
  const [observations, setObservations] = useState<{
    token: string;
    map: ReadonlyMap<string, BalanceObservation>;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);

  /** Las observaciones se piden una vez por página; esto recuerda si ya se hizo. */
  const observationsAsked = useRef<string | null>(null);

  // ---- 1 y 2 · lo que no depende del intervalo ----------------------------
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    void (async () => {
      try {
        const [balanceRow, categoryPage] = await Promise.all([fetchBalance(), fetchCategories()]);
        if (cancelled) return;
        setBalance(balanceRow);
        setCategories(indexCategories(categoryPage.rows as CategoryRow[]));

        /*
         * LA CACHÉ VA DESPUÉS, APARTE, Y NO PUEDE ROMPER NADA.
         *
         * Es la escritura del catálogo que F7.C necesitará para dejar registrar
         * un gasto sin conexión (ADR-028 §16). Tres cosas la hacen segura:
         *
         * - **Va después de pintar.** La pantalla ya tiene sus categorías, en su
         *   orden y con sus colores; esto no toca `indexCategories` ni lo que se
         *   ve. El servidor sigue mandando y la caché es auxiliar.
         * - **No se espera.** `void`: la carga online no queda pendiente de que
         *   SQLite conteste.
         * - **No lanza.** `rememberCategories` devuelve un veredicto, y una base
         *   que falle no puede tumbar la carga autoritativa.
         *
         * Y sólo guarda el catálogo COMPLETO del actor: una respuesta truncada
         * por `max_rows` llega sin error, y guardarla sustituiría un catálogo
         * bueno por uno al que le faltan categorías.
         */
        void (async () => {
          try {
            await rememberCategories(
              await offlineCatalogueCache(),
              actorId,
              categoryPage,
              new Date().toISOString(),
            );
          } catch {
            // Abrir la base también puede fallar, y tampoco es asunto de esta
            // pantalla. Sin registro: `AGENTS.md` §8.
          }
        })();
      } catch {
        // El saldo y el catálogo no bloquean la pantalla: sin saldo se pinta el
        // marcador de posición, y sin catálogo la categoría se dice desconocida.
        // Fallar aquí no puede tumbar la lista, que es lo que la persona vino a
        // ver.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, attempt, actorId]);

  // ---- 3, 4 y 5 · lo que sí depende del intervalo -------------------------
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    void (async () => {
      try {
        /*
         * En paralelo a propósito: las estadísticas no dependen de la lista, y
         * la lista no depende de las estadísticas. Encadenarlas duplicaría la
         * latencia sin ganar nada.
         */
        const [statistics, page] = await Promise.all([
          fetchStatistics(range),
          fetchOperations(range, 0, PAGE_SIZE),
        ]);
        if (cancelled) return;

        // Las versiones anteriores SÓLO si alguna fila las tiene, y en UNA
        // consulta para toda la página. Nunca una por fila.
        const versions = indexVersions(await fetchVersions(previousVersionIds(page.rows)));
        if (cancelled) return;

        setLoaded({ key, statistics, operations: page.rows, total: page.total, versions });
      } catch {
        if (!cancelled) setFailed(key);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `key` y no `range`: el objeto se recrea en cada render y dispararía el
    // efecto sin que el intervalo haya cambiado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, attempt]);

  const current = loaded !== null && loaded.key === key ? loaded : null;
  const status: HomeStatus = failed === key ? 'error' : current === null ? 'loading' : 'ready';

  const operations = current?.operations ?? EMPTY_OPERATIONS;
  const total = current?.total ?? 0;
  const pageToken = `${key}:${operations.length}`;

  const loadMore = useCallback(() => {
    if (current === null || loadingMore || current.operations.length >= current.total) return;
    setLoadingMore(true);

    void (async () => {
      try {
        const page = await fetchOperations(range, current.operations.length, PAGE_SIZE);
        const versions = indexVersions(await fetchVersions(previousVersionIds(page.rows)));

        setLoaded((previous) =>
          previous === null || previous.key !== key
            ? previous
            : {
                ...previous,
                operations: [...previous.operations, ...page.rows],
                total: page.total,
                versions: new Map([...previous.versions, ...versions]),
              },
        );
        // La página nueva invalida lo pedido de observaciones: la próxima
        // expansión vuelve a pedirlas, otra vez para la página entera.
        observationsAsked.current = null;
      } catch {
        setFailed(key);
      } finally {
        setLoadingMore(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, loadingMore, key]);

  /**
   * Las observaciones, perezosas y **por lote**.
   *
   * Perezosas porque son un dato ilustrativo que sólo se ve al desplegar un
   * movimiento, y pedirlas siempre sería una petición desperdiciada en la
   * mayoría de las visitas. Por lote porque el contrato de
   * `api.observed_balance` toma un array precisamente para eso: perezoso no
   * significa por fila.
   */
  const ensureObservations = useCallback(() => {
    if (observationsAsked.current === pageToken || operations.length === 0) return;
    observationsAsked.current = pageToken;

    void (async () => {
      try {
        const rows = await fetchObservations(operations.map((operation) => operation.operation_id));
        setObservations({ token: pageToken, map: indexObservations(rows) });
      } catch {
        // Una observación que no llega no rompe la pantalla: el movimiento se
        // despliega igual y esa línea no se pinta. No es una cifra de la que
        // dependa nada — es ilustrativa por definición (ADR-023).
        observationsAsked.current = null;
      }
    })();
  }, [pageToken, operations]);

  const refresh = useCallback(() => {
    setFailed(null);
    setAttempt((value) => value + 1);
  }, []);

  return useMemo(
    () => ({
      status,
      balance,
      statistics: current?.statistics ?? null,
      operations,
      total,
      categories,
      versions: current?.versions ?? EMPTY_VERSIONS,
      observations: observations?.token === pageToken ? observations.map : EMPTY_OBSERVATIONS,
      loadingMore,
      loadMore,
      ensureObservations,
      refresh,
    }),
    [
      status,
      balance,
      current,
      operations,
      total,
      categories,
      observations,
      pageToken,
      loadingMore,
      loadMore,
      ensureObservations,
      refresh,
    ],
  );
}
