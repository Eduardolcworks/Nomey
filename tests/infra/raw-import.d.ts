/**
 * Importación de un fichero como texto plano, que Vite —y por tanto Vitest—
 * resuelve de forma nativa con el sufijo `?raw`.
 *
 * Se declara aquí para no depender de `@types/node` solo por leer un fichero
 * en un test. Añadir una dependencia exige aprobación explícita (`AGENTS.md`).
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
