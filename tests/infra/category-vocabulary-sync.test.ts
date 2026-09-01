import { describe, expect, it } from 'vitest';

import {
  CATEGORY_ICON_KEYS,
  hasOfficialColour,
  OFFICIAL_CATEGORY_IDS,
} from '@/ui/theme/category-palette';

/**
 * El vocabulario de iconos y las identidades de las categorías de sistema viven
 * en **dos sitios a la vez**: las migraciones los imponen, y el cliente los
 * resuelve. Nada obliga a que coincidan, y la deriva es del tipo silencioso: una
 * categoría nueva sembrada en una migración futura llegaría al cliente sin icono
 * y sin color, y no fallaría nada.
 *
 * Esto no duplica la verdad —la base sigue siendo la autoridad— sino que afirma
 * que el cliente sabe leerla **entera**. Se comprueba sobre el fuente de las
 * migraciones, no sobre una copia escrita aquí, que sería un tercer sitio donde
 * equivocarse.
 */

const MIGRATIONS = import.meta.glob('../../supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const SQL = Object.entries(MIGRATIONS)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, text]) => text as string)
  .join('\n');

/** La siembra: `('<uuid>', 'expense', 'category.…', '<icono>', <orden>)`. */
const SEMBRADAS = new Map(
  [...SQL.matchAll(/\('([0-9a-f-]{36})',\s*'\w+',\s*'(category\.[a-z.]+)'/g)].map((m) => [
    m[2],
    m[1],
  ]),
);

/**
 * La baja se escribe por `message_key`, y se ancla en esa cláusula: el cuerpo de
 * `set_custom_category_active` lleva el mismo `is_active`, y cazarlo daría un
 * conjunto distinto sin que nada fallara.
 */
const DE_BAJA = new Set(
  [
    ...(
      /set is_active = false\s+where message_key in \(([\s\S]*?)\);/.exec(SQL)?.[1] ?? ''
    ).matchAll(/'(category\.[a-z.]+)'/g),
  ].map((m) => m[1]),
);

const VOCABULARIO = [
  ...(
    /category_icono_del_vocabulario\s+check \(icon in \(([\s\S]*?)\)\)/.exec(SQL)?.[1] ?? ''
  ).matchAll(/'([a-z]+)'/g),
].map((m) => m[1]);

describe('el vocabulario de iconos', () => {
  it('el cliente resuelve exactamente las claves que la base admite', () => {
    expect(VOCABULARIO).toHaveLength(15);
    expect([...VOCABULARIO].sort()).toEqual([...CATEGORY_ICON_KEYS].sort());
  });

  it('la base no admite ninguna clave con forma de nombre de plataforma', () => {
    for (const clave of VOCABULARIO) {
      expect(clave, `«${clave}» parece un símbolo de plataforma, no una clave`).toMatch(/^[a-z]+$/);
    }
  });
});

describe('las identidades de las categorías de sistema', () => {
  it('la migración siembra quince, y cinco quedan dadas de baja', () => {
    expect(SEMBRADAS.size).toBe(15);
    expect(DE_BAJA.size).toBe(5);
  });

  /**
   * Se derivan las vigentes en vez de listarlas: dar de baja una undécima en el
   * futuro tiene que romper **aquí**, no dejar un color huérfano apuntando a una
   * categoría que ya no se puede elegir.
   */
  it('hay un color oficial por cada categoría vigente, y por ninguna más', () => {
    const vigentes = [...SEMBRADAS.entries()]
      .filter(([clave]) => !DE_BAJA.has(clave))
      .map(([, id]) => id);

    expect(vigentes).toHaveLength(10);
    expect([...vigentes].sort()).toEqual([...OFFICIAL_CATEGORY_IDS].sort());
  });

  it('ninguna dada de baja arrastra un color oficial', () => {
    for (const clave of DE_BAJA) {
      const id = SEMBRADAS.get(clave);
      expect(id, `${clave} está dada de baja pero no aparece sembrada`).toBeDefined();
      expect(hasOfficialColour(id as string)).toBe(false);
    }
  });
});
