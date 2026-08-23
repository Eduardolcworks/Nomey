import { defineConfig } from 'vitest/config';

// Acotado a los tests de dominio a propósito: `domain/` es código puro, sin
// React Native, y nada fuera de `tests/domain/` debe entrar en esta suite.
export default defineConfig({
  test: {
    include: ['tests/domain/**/*.test.ts'],
  },
});
