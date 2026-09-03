/**
 * Los cuatro módulos de Node que usan las pruebas de la cola, con la firma
 * mínima de cada uno.
 *
 * Mismo precedente y mismo motivo que `tests/infra/node-exec.d.ts`: **no se
 * añade `@types/node`** sólo para abrir un SQLite y un directorio temporal.
 * Añadir una dependencia exige aprobación explícita (`AGENTS.md`), y
 * `@types/node` sólo está presente de forma transitiva, así que apoyarse en él
 * sería depender de un paquete que nadie declaró.
 *
 * Se declara **sólo lo que se usa**. Cada firma de más sería superficie que
 * alguien puede empezar a usar sin haberla comprobado contra el runtime real.
 */

declare module 'node:sqlite' {
  /**
   * La API síncrona de SQLite que trae Node 22.
   *
   * Es experimental y emite un aviso al cargarse; se acepta porque **sólo
   * corre en las pruebas**. La app usa `expo-sqlite`, y lo que comparten es el
   * puerto `SqlDatabase`, no esta implementación.
   */
  export class StatementSync {
    run(...params: (string | number | null)[]): { changes: number; lastInsertRowid: number };
    all(...params: (string | number | null)[]): unknown[];
    get(...params: (string | number | null)[]): unknown;
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...segments: string[]): string;
}
