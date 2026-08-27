import { defineConfig } from 'vitest/config';

// Acotado a propósito. `tests/domain/` cubre `domain/`, que es código puro sin
// React Native. `tests/infra/` sólo admite comprobaciones igual de puras sobre
// la configuración versionada —hoy la exposición de schemas que exigen ADR-006
// §6 y ADR-014—: leen ficheros del repositorio y **no** hablan con la base de
// datos. Lo que necesite una base viva no entra aquí; vive en
// `supabase/checks/`.
export default defineConfig({
  test: {
    include: ['tests/domain/**/*.test.ts', 'tests/infra/**/*.test.ts', 'tests/lib/**/*.test.ts'],
  },
});
