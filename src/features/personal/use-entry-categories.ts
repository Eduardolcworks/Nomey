import { useEffect, useState } from 'react';

import type { CategoryRow } from './category';
import { fetchCategories } from './personal-service';

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
 * **Un fallo devuelve lista vacía y no un catálogo inventado.** `blockerFor` ya
 * impide guardar un gasto sin categoría, así que el formulario se queda
 * bloqueado y dice por qué, en lugar de ofrecer opciones que la frontera
 * rechazaría.
 */
export function useEntryCategories(): readonly CategoryRow[] {
  const [rows, setRows] = useState<readonly CategoryRow[]>([]);

  useEffect(() => {
    let active = true;

    void fetchCategories()
      .then((all) => {
        if (active) setRows(all.filter((row) => row.is_active));
      })
      .catch(() => {
        // Silencio deliberado: ver arriba.
      });

    return () => {
      active = false;
    };
  }, []);

  return rows;
}
