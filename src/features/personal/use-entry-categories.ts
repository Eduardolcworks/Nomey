import { useEffect, useMemo, useState } from 'react';

import {
  type CachedCategory,
  canPickCategoryOffline,
  CATEGORY_CACHE_KEY,
  parseCategories,
} from './category-cache';
import { type CategoryRow, indexCategories } from './category';
import { fetchCategories } from './personal-service';
import { offlineCatalogueCache } from '@/lib/offline';

/**
 * El catálogo **elegible**, que no es el catálogo entero.
 *
 * `api.category` publica también las dadas de baja, y con razón: el histórico
 * necesita resolver el nombre y el icono de una categoría retirada. Quien
 * filtra por `is_active` es la superficie que pinta un selector, nunca la vista
 * ni la RLS (ADR-021 §7) — filtrar allí haría imposible lo primero.
 *
 * Ofrecer una retirada aquí terminaría en `CATEGORY_NOT_USABLE · 422` con el
 * formulario ya relleno, que es un error de contrato disfrazado de error de la
 * persona.
 *
 * **Sin red, el respaldo es el catálogo guardado en la última carga completa**
 * (ADR-028 §16), filtrado igual. Y si tampoco lo hay —nunca se cargó en este
 * aparato— no se inventa ninguna categoría: `unavailable` se pone a `true`,
 * `blockerFor` bloquea el gasto con `noCategories` y la hoja explica qué hace
 * falta. Un ingreso no mira esto, porque no lleva categoría (ADR-027 §3).
 */
export type EntryCategories = {
  readonly rows: readonly CategoryRow[];
  /** Sin conexión y sin catálogo previo: no hay nada que ofrecer. */
  readonly unavailable: boolean;
};

const LOADING: EntryCategories = { rows: [], unavailable: false };

async function cachedCategories(actorId: string): Promise<CachedCategory[] | null> {
  if (actorId === '') return null;
  try {
    const document = await (await offlineCatalogueCache()).read(actorId, CATEGORY_CACHE_KEY);
    return document === null ? null : parseCategories(document.document);
  } catch {
    // Sin base tampoco hay respaldo. Se dirá con `unavailable`, no con un error.
    return null;
  }
}

/**
 * @param actorId el `sub` de la sesión, o cadena vacía si no hay. El catálogo
 * cacheado está aislado por cuenta (ADR-028 §13), y sin actor no se lee.
 */
export function useEntryCategories(actorId: string): EntryCategories {
  const [state, setState] = useState<EntryCategories>(LOADING);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        // `total` no se mira aquí: el selector pinta lo que haya llegado, igual
        // que siempre. Quien lo usa es la caché, y su escritura vive en Inicio.
        const page = await fetchCategories();
        if (active)
          setState({ rows: page.rows.filter((row) => row.is_active), unavailable: false });
      } catch {
        const cached = await cachedCategories(actorId);
        if (!active) return;
        if (canPickCategoryOffline(cached)) {
          setState({ rows: (cached ?? []).filter((row) => row.is_active), unavailable: false });
        } else {
          setState({ rows: [], unavailable: true });
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [actorId]);

  return state;
}

/**
 * EL CATÁLOGO ENTERO, PARA NOMBRAR Y NO PARA ELEGIR.
 *
 * `useEntryCategories` filtra por `is_active` porque pinta un selector, y
 * ofrecer una categoría retirada acabaría en `CATEGORY_NOT_USABLE · 422`. Pero
 * **nombrar es lo contrario**: ADR-021 §7 conserva las retiradas justamente
 * para que el histórico sepa decir cómo se llamaban, y un gasto de hace un año
 * quedaría sin nombre si se filtrasen aquí.
 *
 * Medido en el aparato: una incidencia sobre una categoría que se acababa de
 * dar de baja decía «en sin categoría» en lugar de su nombre. Es el mismo
 * catálogo sin filtrar que la lista de movimientos usa desde F6.D.
 *
 * Con el respaldo local detrás, así que sin red también nombra (ADR-028 §16).
 */
export function useCategoryNames(actorId: string): ReadonlyMap<string, CategoryRow> {
  const [rows, setRows] = useState<readonly CategoryRow[]>([]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const page = await fetchCategories();
        if (active) setRows(page.rows as CategoryRow[]);
      } catch {
        const cached = await cachedCategories(actorId);
        if (active && cached !== null) setRows(cached);
      }
    })();

    return () => {
      active = false;
    };
  }, [actorId]);

  return useMemo(() => indexCategories(rows), [rows]);
}
