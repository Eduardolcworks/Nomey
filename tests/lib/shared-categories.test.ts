import { describe, expect, it } from 'vitest';

import {
  type CategoryRow,
  isSharedCategory,
  sharedCategories,
} from '../../src/lib/categories/category';

/**
 * QUÉ CATEGORÍAS ADMITE UN GASTO COMPARTIDO.
 *
 * Sólo las de sistema, y por privacidad: una categoría propia la escribió una
 * persona, vive bajo su `owner_user_id` y la RLS de `core.category` no la enseña
 * a nadie más. Ponerla en un gasto que otros ven les dejaría un identificador
 * que no pueden resolver — o forzaría a copiar su nombre dentro de la versión,
 * que es la denormalización que F06/ADR-003 evita para que renombrar alcance al
 * histórico.
 *
 * **La condición no se infiere: la garantiza la base.** El `CHECK`
 * `category_sistema_o_propia` hace que «tiene clave» y «no tiene dueño» sean la
 * misma cosa, y el servidor vuelve a exigirlo en
 * `sec.assert_shared_category_usable`, que es quien manda.
 */
const sistema: CategoryRow = {
  id: 'a',
  message_key: 'category.expense.dining',
  label: null,
  icon: 'fork',
};

const propia: CategoryRow = { id: 'b', message_key: null, label: 'Mis cosas', icon: 'tag' };

describe('isSharedCategory', () => {
  it('una de sistema sí', () => {
    expect(isSharedCategory(sistema)).toBe(true);
  });

  it('y una propia no', () => {
    expect(isSharedCategory(propia)).toBe(false);
  });

  /**
   * Las dos formas son excluyentes y completas en la base. Una fila con las dos
   * cosas —o con ninguna— no puede existir; si llegara, **no se comparte**: ante
   * una forma que el modelo no admite, la salida segura es no ofrecerla.
   */
  it('y una fila imposible se queda fuera, no dentro', () => {
    expect(isSharedCategory({ id: 'c', message_key: 'k', label: 'x', icon: 'i' })).toBe(false);
    expect(isSharedCategory({ id: 'd', message_key: null, label: null, icon: 'i' })).toBe(false);
  });
});

describe('sharedCategories', () => {
  it('deja pasar las de sistema y quita las propias, conservando el orden', () => {
    const otra: CategoryRow = {
      id: 'e',
      message_key: 'category.expense.travel',
      label: null,
      icon: 'plane',
    };

    expect(sharedCategories([sistema, propia, otra]).map((one) => one.id)).toEqual(['a', 'e']);
  });

  /**
   * **No sustituye nada.** Si el borrador ya tenía una propia elegida, filtrar
   * el catálogo la deja sin respaldo y quien compone pide otra: cambiarla por
   * una parecida guardaría el gasto clasificado en algo que nadie dijo.
   */
  it('y no añade una de repuesto cuando no queda ninguna', () => {
    expect(sharedCategories([propia])).toEqual([]);
  });
});
