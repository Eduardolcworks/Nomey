/**
 * `import.meta.glob`, que Vite —y por tanto Vitest— resuelve de forma nativa.
 *
 * Se declara aquí por el mismo motivo que `tests/infra/raw-import.d.ts`: leer
 * ficheros del repositorio en un test no debe obligar a añadir `@types/node`,
 * y añadir una dependencia exige aprobación explícita (`AGENTS.md`).
 */
interface ImportMeta {
  glob(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
}
