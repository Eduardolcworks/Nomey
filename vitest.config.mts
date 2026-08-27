import { defineConfig } from 'vitest/config';

// Acotado a propósito. `tests/domain/` cubre `domain/`, que es código puro sin
// React Native. `tests/infra/` sólo admite comprobaciones igual de puras sobre
// la configuración versionada —hoy la exposición de schemas que exigen ADR-006
// §6 y ADR-014—: leen ficheros del repositorio y **no** hablan con la base de
// datos. Lo que necesite una base viva no entra aquí; vive en
// `supabase/checks/`.
export default defineConfig({
  // El alias `@/` de `tsconfig.json`, que Vitest no lee por su cuenta. Sin
  // esto, un import de valor —no de tipo, que se borra al compilar— falla en el
  // test y no en el bundle, que es la peor combinación posible.
  resolve: {
    alias: { '@': new URL('src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') },
  },
  test: {
    include: ['tests/domain/**/*.test.ts', 'tests/infra/**/*.test.ts', 'tests/lib/**/*.test.ts'],
  },
});
