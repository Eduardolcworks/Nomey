import { describe, expect, it } from 'vitest';

import {
  categoryName,
  categoryOptions,
  indexCategories,
  SYSTEM_CATEGORY_COUNT,
  systemCategoryKey,
} from '../../src/features/personal/category';
import {
  IDLE,
  isResolving,
  readyScope,
  parseScope,
  recommendedCurrencyCode,
  SCOPE_CACHE_KEY,
  scopeFromResult,
  serializeScope,
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
      { id: 'c1', message_key: 'category.expense.groceries', label: null, icon: 'groceries' },
    ]);
    expect(categoryName(index.get('c1'), translate)).toBe('Supermercado');
  });

  /**
   * Una categoría propia lleva texto literal escrito por su dueño y **no se
   * traduce** (ADR-021).
   */
  it('una categoría propia se muestra tal cual la escribió su dueño', () => {
    const index = indexCategories([
      { id: 'c2', message_key: null, label: 'Gimnasio', icon: 'leisure' },
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
      { id: 'c3', message_key: 'category.expense.inventada', label: null, icon: 'other' },
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

/**
 * LAS OPCIONES DEL MENÚ NATIVO.
 *
 * Se prueba el constructor y no el menú: `MenuView` es un control del sistema,
 * así que lo único que puede fallar del lado de Nomey es qué acciones se le
 * entregan — cuáles, con qué nombre, con qué icono y cuál marcada.
 */
describe('las opciones del menú de categorías', () => {
  const translate = (key: MessageKey) => esES[key];

  const CATALOGO = [
    { id: 'c1', message_key: 'category.expense.groceries', label: null, icon: 'groceries' },
    { id: 'c2', message_key: 'category.expense.dining', label: null, icon: 'dining' },
    { id: 'c3', message_key: null, label: 'Gimnasio', icon: 'leisure' },
  ];

  it('ofrece el catálogo entero, en su orden y sin añadir nada', () => {
    const options = categoryOptions(CATALOGO, null, translate);
    expect(options.map((o) => o.id)).toEqual(['c1', 'c2', 'c3']);
    expect(options.map((o) => o.title)).toEqual(['Supermercado', 'Restaurantes', 'Gimnasio']);
  });

  /** El check es un estado por opción, y sólo lo lleva una. */
  it('marca la vigente y sólo la vigente', () => {
    const options = categoryOptions(CATALOGO, 'c2', translate);
    expect(options.filter((o) => o.selected).map((o) => o.id)).toEqual(['c2']);
  });

  it('sin categoría elegida no marca ninguna', () => {
    expect(categoryOptions(CATALOGO, null, translate).some((o) => o.selected)).toBe(false);
  });

  /**
   * **No inventa filas.** El filtro de lo vigente es de `useEntryCategories` y
   * vive en un solo sitio: si una retirada llega hasta aquí —la que conserva un
   * gasto que ya la usaba— se ofrece, y si no llega, no se añade.
   */
  it('no añade ni quita filas del catálogo que recibe', () => {
    expect(categoryOptions([], 'c1', translate)).toHaveLength(0);
    expect(categoryOptions(CATALOGO, 'no-existe', translate)).toHaveLength(3);
  });

  /**
   * **Nunca un identificador ni una clave cruda** (ADR-021). En un menú del
   * sistema no hay dónde poner un aviso, así que la opción no está.
   */
  it('una categoría sin nombre resoluble no se ofrece', () => {
    const options = categoryOptions(
      [{ id: 'c9', message_key: 'category.expense.inventada', label: null, icon: 'other' }],
      null,
      translate,
    );
    expect(options).toHaveLength(0);
  });

  /** La clave semántica viaja sin resolver: quien pinta elige plataforma. */
  it('lleva la clave semántica del icono, no un símbolo de una plataforma', () => {
    expect(categoryOptions(CATALOGO, null, translate).map((o) => o.icon)).toEqual([
      'groceries',
      'dining',
      'leisure',
    ]);
  });

  it('una categoría sin icono cae en el genérico', () => {
    const options = categoryOptions(
      [{ id: 'c4', message_key: null, label: 'Suelta', icon: '' }],
      null,
      translate,
    );
    expect(options[0]?.icon).toBe('tag');
  });
});

describe('el ámbito guardado como respaldo sin red (F7.D)', () => {
  const ready = scopeFromResult({
    scope_id: 'scope-1',
    base_currency_definition_id: 'eur',
    currency_code: 'EUR',
    currency_scale: 2,
    created: true,
  });

  it('va y vuelve intacto, y al volver nunca dice que lo creó esta llamada', () => {
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') return;
    const back = parseScope(serializeScope(ready));
    expect(back).toEqual({ ...ready, created: false });
  });

  it('no lleva ninguna cifra: sólo identidad y definición monetaria', () => {
    if (ready.status !== 'ready') return;
    expect(Object.keys(JSON.parse(serializeScope(ready))).sort()).toEqual(
      ['currencyCode', 'currencyDefinitionId', 'currencyScale', 'scopeId', 'v'].sort(),
    );
  });

  it.each([
    ['no es JSON', '{'],
    [
      'otra versión',
      JSON.stringify({
        v: 2,
        scopeId: 's',
        currencyDefinitionId: 'c',
        currencyCode: 'EUR',
        currencyScale: 2,
      }),
    ],
    [
      'sin ámbito',
      JSON.stringify({
        v: 1,
        scopeId: '',
        currencyDefinitionId: 'c',
        currencyCode: 'EUR',
        currencyScale: 2,
      }),
    ],
    [
      'escala no entera',
      JSON.stringify({
        v: 1,
        scopeId: 's',
        currencyDefinitionId: 'c',
        currencyCode: 'EUR',
        currencyScale: 2.5,
      }),
    ],
    [
      'escala negativa',
      JSON.stringify({
        v: 1,
        scopeId: 's',
        currencyDefinitionId: 'c',
        currencyCode: 'EUR',
        currencyScale: -1,
      }),
    ],
    [
      'sin moneda',
      JSON.stringify({
        v: 1,
        scopeId: 's',
        currencyDefinitionId: '',
        currencyCode: 'EUR',
        currencyScale: 2,
      }),
    ],
  ])('se descarta entero si %s', (_label, document) => {
    expect(parseScope(document)).toBeNull();
  });

  it('la clave del documento es estable y distinta de la del catálogo', () => {
    expect(SCOPE_CACHE_KEY).toBe('personal-scope');
  });
});
