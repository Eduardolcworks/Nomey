import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CATEGORY_CACHE_KEY, parseCategories, rememberCategories } from './category-cache';
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
import { isProjecting, readBarrier } from './queue-runtime';
import { inQuietWindow, type QuietWindowPorts } from './snapshot-window';
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
  /**
   * `snapshot.seq` de ADR-028 §9, por parte: el valor del contador durable de
   * reconciliación en el instante en que ARRANCÓ la consulta que trajo cada
   * una. El saldo y el bloque del intervalo se piden por separado y el segundo
   * se repite al cambiar de intervalo, así que cada uno lleva el suyo; quien
   * proyecta retira cada agregado con el `seq` de la consulta que lo produjo.
   * `null` mientras esa parte no ha llegado, o si el contador no se pudo leer:
   * entonces nada se retira, que es la lectura conservadora.
   */
  readonly snapshot: {
    readonly balanceSeq: number | null;
    readonly intervalSeq: number | null;
  };
};

/** Lo cargado, con el intervalo al que pertenece y el `seq` con que arrancó. */
type Loaded = {
  readonly key: string;
  readonly statistics: PersonalStatistics | null;
  readonly operations: PersonalOperation[];
  readonly total: number;
  readonly versions: Map<string, PersonalOperationVersion>;
  readonly seq: number | null;
};

/**
 * The barrier ports for one actor.
 *
 * The barrier is read twice per query — before and after — and `inQuietWindow`
 * decides what the pair allows; the mark kept on the snapshot is always the one
 * taken at the START. `null` means the local database would not answer, and
 * then the only thing that matters is whether anything local is on screen.
 */
function windowPorts(actorId: string): QuietWindowPorts {
  return {
    barrier: async () => {
      if (actorId === '') return null;
      try {
        return await readBarrier(actorId);
      } catch {
        return null;
      }
    },
    projecting: () => isProjecting(actorId),
  };
}

const EMPTY_VERSIONS: ReadonlyMap<string, PersonalOperationVersion> = new Map();
const EMPTY_OBSERVATIONS: ReadonlyMap<string, BalanceObservation> = new Map();
const EMPTY_OPERATIONS: readonly PersonalOperation[] = [];

export function usePersonalHome(ready: boolean, range: DateRange, actorId: string): PersonalHome {
  const key = rangeKey(range);

  const [balance, setBalance] = useState<{
    readonly row: PersonalHome['balance'];
    readonly seq: number | null;
  }>({ row: null, seq: null });
  const [categories, setCategories] = useState<ReadonlyMap<string, CategoryRow>>(new Map());
  /*
   * El efecto del intervalo no depende del actor —cambiar de cuenta desmonta la
   * rama entera— pero necesita leer su contador. Una referencia se lo da sin
   * tocar sus dependencias, que son contrato: ver la comprobación de superficie.
   * Se sincroniza en un efecto, no en el render, y va declarado ANTES del
   * efecto que la lee: los efectos corren en orden de declaración.
   */
  const actorRef = useRef(actorId);
  useEffect(() => {
    actorRef.current = actorId;
  }, [actorId]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  /** El intervalo cuya carga falló. Comparado con el actual, es el estado de error. */
  const [failed, setFailed] = useState<string | null>(null);
  const [observations, setObservations] = useState<{
    token: string;
    map: ReadonlyMap<string, BalanceObservation>;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /**
   * The attempt whose response was already discarded for not being quiet.
   *
   * Discarding and nothing else would leave the screen waiting for a base that
   * may never come — whoever announces a confirmation asks for its own refresh,
   * but that lives in ANOTHER hook and cannot be the only guarantee — so the
   * attempt is retried here. The `ref` is what stops the two queries, which run
   * at the same time, from asking for two retries of the same attempt. And
   * there is no loop: a retry only happens when the barrier moved, and only the
   * worker moves it.
   */
  const retried = useRef(-1);
  const supersede = useCallback((of: number) => {
    if (retried.current === of) return;
    retried.current = of;
    setAttempt((value) => value + 1);
  }, []);

  /** Las observaciones se piden una vez por página; esto recuerda si ya se hizo. */
  const observationsAsked = useRef<string | null>(null);

  // ---- 1 y 2 · lo que no depende del intervalo ----------------------------
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    let answered = false;

    /*
     * EL CATÁLOGO GUARDADO, A LA VEZ QUE LA RED (ADR-028 §16). Sin conexión, la
     * fila de un gasto local necesita el nombre y el icono de su categoría, y el
     * servidor no va a contestar —o va a tardar mucho en rendirse—. La copia
     * de la última carga completa nombra igual; si la red contesta, manda ella
     * y sobrescribe. Es presentación, no una cifra: no hay nada económico aquí.
     */
    void (async () => {
      if (actorId === '') return;
      try {
        const document = await (await offlineCatalogueCache()).read(actorId, CATEGORY_CACHE_KEY);
        const rows = document === null ? null : parseCategories(document.document);
        if (cancelled || answered || rows === null) return;
        setCategories(indexCategories(rows));
      } catch {
        // Sin base no hay respaldo; se dirá «sin categoría conocida», como hoy.
      }
    })();

    void (async () => {
      try {
        /*
         * ADR-028 §9: the barrier is read BEFORE the query runs and again when
         * the response lands, to tell whether the window was quiet. If it was
         * not, the BALANCE is not committed — it would be a base nobody can say
         * whether the server already charged — and the attempt is retried. The
         * CATALOGUE is applied either way: it is presentation, and no send can
         * alter it.
         */
        const window = await inQuietWindow(windowPorts(actorId), () =>
          Promise.all([fetchBalance(), fetchCategories()]),
        );
        if (cancelled) return;
        const [balanceRow, categoryPage] = window.value;
        answered = true;
        if (window.kind === 'base') setBalance({ row: balanceRow, seq: window.seq });
        else supersede(attempt);
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
  }, [ready, attempt, actorId, supersede]);

  // ---- 3, 4 y 5 · lo que sí depende del intervalo -------------------------
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    void (async () => {
      try {
        /*
         * THE WHOLE INTERVAL BLOCK INSIDE ONE WINDOW, and not each query in its
         * own: the statistics, the list and the versions are retired with a
         * single `seq`, so they have to have been fetched under one quietness.
         * If anything happens while one of them is in flight, the ENTIRE block
         * is discarded and retried; committing half would leave totals without
         * the expense and a list with it.
         */
        const window = await inQuietWindow(windowPorts(actorRef.current), async () => {
          /*
           * En paralelo a propósito: las estadísticas no dependen de la lista, y
           * la lista no depende de las estadísticas. Encadenarlas duplicaría la
           * latencia sin ganar nada.
           */
          const [statistics, page] = await Promise.all([
            fetchStatistics(range),
            fetchOperations(range, 0, PAGE_SIZE),
          ]);
          // Las versiones anteriores SÓLO si alguna fila las tiene, y en UNA
          // consulta para toda la página. Nunca una por fila.
          const versions = indexVersions(await fetchVersions(previousVersionIds(page.rows)));
          return { statistics, page, versions };
        });
        if (cancelled) return;
        if (window.kind !== 'base') {
          supersede(attempt);
          return;
        }
        const { statistics, page, versions } = window.value;

        // Un refresco parcial o cancelado no llega aquí: sólo el completo fija
        // el snapshot y su `seq`, que es lo único que puede retirar proyecciones.
        setLoaded({
          key,
          statistics,
          operations: page.rows,
          total: page.total,
          versions,
          seq: window.seq,
        });
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
        /*
         * "SEE MORE" NEEDS THE QUIET WINDOW TOO. The rows it appends join the
         * ones that prove §9's shortcut — "the server row is already on the
         * page" — and that shortcut retires the entry from the totals, which
         * come from the PREVIOUS query. If anything settles while this page is
         * in flight, appending it would retire it from totals that do not carry
         * it yet: the expense would vanish for an instant. The page is
         * discarded; the refresh the confirmation asks for reloads the first.
         */
        const window = await inQuietWindow(windowPorts(actorRef.current), async () => {
          const page = await fetchOperations(range, current.operations.length, PAGE_SIZE);
          const versions = indexVersions(await fetchVersions(previousVersionIds(page.rows)));
          return { page, versions };
        });
        if (window.kind !== 'base' || window.seq !== current.seq) return;
        const { page, versions } = window.value;

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
      balance: balance.row,
      snapshot: { balanceSeq: balance.seq, intervalSeq: current?.seq ?? null },
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
