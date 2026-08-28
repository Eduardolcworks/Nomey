import { describe, expect, it } from 'vitest';

import {
  categoryName,
  indexCategories,
  SYSTEM_CATEGORY_COUNT,
  systemCategoryKey,
} from '../../src/features/personal/category';
import {
  IDLE,
  isResolving,
  readyScope,
  recommendedCurrencyCode,
  scopeFromResult,
} from '../../src/features/personal/personal-scope';
import { esES } from '../../src/lib/i18n/messages/es-ES';
import type { MessageKey } from '../../src/lib/i18n';

describe('el estado del Modo Personal', () => {
  const result = {
    scope_id: 'scope-1',
    base_currency_definition_id: 'eur',
    currency_code: 'EUR',
    currency_scale: 2,
    created: true,
  };

  /**
   * **Cuatro estados, no un booleano**, por la misma razón que la sesión de
   * F5.B: `hasScope: false` no distingue «todavía no hemos mirado» de «hemos
   * mirado y no hay», y esas dos pintan cosas distintas.
   */
  it('mientras no se pueda afirmar que el ámbito existe, está resolviéndose', () => {
    expect(isResolving(IDLE)).toBe(true);
    expect(isResolving({ status: 'provisioning' })).toBe(true);
    expect(isResolving(scopeFromResult(result))).toBe(false);
    expect(isResolving({ status: 'unavailable' })).toBe(false);
  });

  it('sólo el estado listo entrega ámbito y moneda', () => {
    expect(readyScope(IDLE)).toBeNull();
    expect(readyScope({ status: 'provisioning' })).toBeNull();
    expect(readyScope({ status: 'unavailable' })).toBeNull();

    expect(readyScope(scopeFromResult(result))).toMatchObject({
      scopeId: 'scope-1',
      currencyCode: 'EUR',
      currencyScale: 2,
      created: true,
    });
  });

  /**
   * `created` es informativo y nunca una condición: la frontera es idempotente
   * por estado, así que la segunda llamada devuelve el mismo ámbito con
   * `created: false` y la pantalla tiene que comportarse igual.
   */
  it('un ámbito que ya existía es igual de válido que uno recién creado', () => {
    const existing = scopeFromResult({ ...result, created: false });
    expect(isResolving(existing)).toBe(false);
    expect(readyScope(existing)?.scopeId).toBe('scope-1');
  });

  it('el fallo es un estado con salida, no un ámbito a medias', () => {
    expect(readyScope({ status: 'unavailable' })).toBeNull();
  });
});

describe('recommendedCurrencyCode', () => {
  /**
   * **La moneda de la REGIÓN, no la del idioma.** `expo-localization` expone
   * las dos y son distintas: alguien con el móvil en inglés viviendo en España
   * tiene `currencyCode: 'EUR'` por región y otra cosa por idioma. El handoff
   * señala expresamente que usar la segunda es el error.
   */
  it('toma el código de la primera región del dispositivo', () => {
    expect(recommendedCurrencyCode([{ currencyCode: 'EUR' }, { currencyCode: 'USD' }])).toBe('EUR');
  });

  it('sin código no inventa uno: deja que lo resuelva la frontera', () => {
    expect(recommendedCurrencyCode([])).toBeNull();
    expect(recommendedCurrencyCode([{ currencyCode: null }])).toBeNull();
    expect(recommendedCurrencyCode([{ currencyCode: '' }])).toBeNull();
    expect(recommendedCurrencyCode([{}])).toBeNull();
  });
});

describe('las categorías', () => {
  const translate = (key: MessageKey) => esES[key];

  it('una categoría de sistema se traduce por su clave', () => {
    const index = indexCategories([
      { id: 'c1', message_key: 'category.expense.groceries', label: null, icon: 'fork.knife' },
    ]);
    expect(categoryName(index.get('c1'), translate)).toBe('Alimentación');
  });

  /**
   * Una categoría propia lleva texto literal escrito por su dueño y **no se
   * traduce** (ADR-021).
   */
  it('una categoría propia se muestra tal cual la escribió su dueño', () => {
    const index = indexCategories([
      { id: 'c2', message_key: null, label: 'Gimnasio', icon: 'figure.run' },
    ]);
    expect(categoryName(index.get('c2'), translate)).toBe('Gimnasio');
  });

  /**
   * **Nunca se pinta un identificador ni una clave cruda.** Una clave que esta
   * versión del cliente no conoce —porque el servidor sembró una nueva— devuelve
   * `null`, y la superficie dice que no la conoce.
   */
  it('una clave que el cliente no conoce no se pinta como texto', () => {
    const index = indexCategories([
      { id: 'c3', message_key: 'category.expense.inventada', label: null, icon: 'x' },
    ]);
    expect(categoryName(index.get('c3'), translate)).toBeNull();
    expect(systemCategoryKey('category.expense.inventada')).toBeNull();
  });

  it('una categoría ausente del catálogo del actor no rompe nada', () => {
    expect(categoryName(undefined, translate)).toBeNull();
  });

  /**
   * El puente y el catálogo de i18n dicen lo mismo.
   *
   * Sin esto, una clave traducida sin puente quedaría sin consumidor —y el test
   * de i18n la marcaría— y una clave con puente sin traducir se pintaría como
   * su propio identificador.
   */
  it('conoce exactamente las claves de categoría que el catálogo traduce', () => {
    const inCatalogue = Object.keys(esES).filter((key) => key.startsWith('category.'));

    expect(inCatalogue).toHaveLength(SYSTEM_CATEGORY_COUNT);
    for (const key of inCatalogue) {
      expect(systemCategoryKey(key)).toBe(key);
    }
  });

  /** Las quince que siembra la migración de F6.B: doce de gasto y tres de ingreso. */
  it('cubre las quince categorías de sistema sembradas', () => {
    expect(SYSTEM_CATEGORY_COUNT).toBe(15);
    expect(Object.keys(esES).filter((key) => key.startsWith('category.expense.'))).toHaveLength(12);
    expect(Object.keys(esES).filter((key) => key.startsWith('category.income.'))).toHaveLength(3);
  });
});
