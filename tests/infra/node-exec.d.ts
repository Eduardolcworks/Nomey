/**
 * `execFileSync`, declarado con la firma mínima que usa `script-modes.test.ts`.
 *
 * Mismo motivo que `raw-import.d.ts`, y el mismo precedente: **no se añade
 * `@types/node` solo para leer el índice de Git en un test**. Añadir una
 * dependencia exige aprobación explícita (`AGENTS.md`), y `@types/node` solo
 * está presente de forma transitiva, así que apoyarse en él sería depender de
 * un paquete que nadie declaró.
 *
 * Se declara **solo lo que se usa**: la forma que devuelve `string`, que es la
 * que produce `encoding: 'utf8'`. Sin sobrecargas y sin `Buffer`, para que no
 * haga falta el resto del universo de tipos de Node.
 */
declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args: readonly string[],
    options: { cwd?: string | URL; encoding: 'utf8' },
  ): string;
}
