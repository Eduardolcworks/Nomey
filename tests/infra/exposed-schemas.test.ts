import { describe, expect, it } from 'vitest';

import CONFIG from '../../supabase/config.toml?raw';

/**
 * Invariante de exposición de la Data API.
 *
 * ADR-006 §6 exige expresamente «un test automatizado que falle si `core` o
 * `sec` aparecen en cualquiera de esas dos superficies», y ADR-014 añade
 * `public` a la lista de lo que no se expone.
 *
 * Es un test de texto, no de base de datos: comprueba la configuración
 * versionada, que es lo que determina qué arranca PostgREST. La comprobación
 * del comportamiento real, ya con la base levantada, vive en
 * `supabase/checks/bootstrap.sql` y en el runbook.
 */

/** Lee una lista TOML de la forma `clave = ["a", "b"]`. */
function tomlStringArray(key: string): string[] {
  const match = CONFIG.match(new RegExp(`^${key}\\s*=\\s*\\[([^\\]]*)\\]`, 'm'));
  if (match === null) {
    throw new Error(`No se encontró la clave "${key}" en supabase/config.toml`);
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Schemas que nunca deben ser alcanzables desde la superficie de cliente. */
const NUNCA_EXPUESTOS = ['core', 'sec'] as const;

describe('superficie expuesta por la Data API', () => {
  const schemas = tomlStringArray('schemas');
  const extraSearchPath = tomlStringArray('extra_search_path');

  it('expone `api`, que es la superficie propia de Nomey (ADR-005 §2)', () => {
    expect(schemas).toContain('api');
  });

  it.each(NUNCA_EXPUESTOS)('no expone `%s` (ADR-006 §6)', (schema) => {
    expect(schemas).not.toContain(schema);
  });

  it.each(NUNCA_EXPUESTOS)('no incluye `%s` en el search_path (ADR-006 §6)', (schema) => {
    expect(extraSearchPath).not.toContain(schema);
  });

  it('no expone `public` (ADR-014)', () => {
    expect(schemas).not.toContain('public');
  });
});
