import { describe, expect, it } from 'vitest';

/**
 * LA GUARDA DEL AISLAMIENTO POR ACTOR.
 *
 * **Por qué hace falta un test sobre el fuente y no basta con los de
 * comportamiento.** Los de `tests/lib/` comprueban que hoy no se puede leer ni
 * mover la entrada de otra cuenta, uno por uno. Pero el fallo que importa es el
 * futuro: alguien añade un método al adaptador, se le olvida `actor_id = ?`, y
 * **ningún test existente lo cubre porque el método es nuevo**. Esta guarda
 * mira todas las sentencias, incluidas las que todavía no existen.
 *
 * Es la misma forma que `script-modes.test.ts`: leer el artefacto versionado y
 * afirmar algo sobre él, en vez de confiar en que nadie se despiste.
 *
 * **Y corrige una afirmación que era falsa:** el índice
 * `queue_entry_actor_created` es una optimización de consulta. No impide leer
 * ni modificar la fila de otro actor, y no es lo que sostiene el aislamiento.
 * Lo sostienen los predicados que se comprueban aquí.
 */

const ADAPTERS = [
  'src/lib/offline/sqlite-queue-store.ts',
  'src/lib/offline/sqlite-catalogue-cache.ts',
] as const;

/** Las dos tablas cuyas filas pertenecen a una cuenta concreta. */
const OWNED_TABLES = ['queue_entry', 'catalogue_cache', 'reconcile_cursor'] as const;

/**
 * El fuente versionado, leído como texto.
 *
 * Mismo mecanismo que `personal-home-surface.test.ts`: `import.meta.glob` con
 * `?raw`, que Vite resuelve de forma nativa. No se usa `node:fs` para no
 * depender de `@types/node` sólo por leer un fichero (`AGENTS.md`).
 */
const SOURCES = import.meta.glob('../../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function source(relative: string): string {
  const found = SOURCES[`../../${relative}`];
  expect(found, `falta ${relative}`).toBeDefined();
  return found as string;
}

/**
 * Las sentencias SQL del fichero, sacadas de sus literales.
 *
 * Se parte por palabra clave y no por literal porque una plantilla puede llevar
 * varias sentencias, y porque el `COLUMNS` interpolado partiría un literal en
 * trozos que ya no son SQL.
 */
function statements(code: string): string[] {
  /*
   * Los comentarios se quitan ANTES de buscar literales.
   *
   * No es cosmético: estos ficheros documentan su propio SQL entre comillas
   * invertidas, así que sin esto el extractor auditaba la documentación además
   * del código —y una frase de un comentario puede fallar o pasar por motivos
   * que no tienen nada que ver con lo que se ejecuta—.
   */
  const withoutComments = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const literals = withoutComments.match(/`[^`]*`|'[^']*'/g) ?? [];
  const joined = literals
    .join('\n')
    .replace(/\$\{[^}]*\}/g, ' COLUMNAS ')
    /*
     * El `do update` de un upsert NO es una sentencia aparte, y separarlo daría
     * un falso positivo: su alcance lo fija el objetivo del conflicto
     * —`on conflict (actor_id, key)`— y no una cláusula `where`. Ese objetivo
     * incluye el actor, así que la fila que se actualiza sigue siendo la suya.
     */
    .replace(/\bdo\s+update\b/gi, 'do_update');

  return joined
    .split(/\b(?=select |update |delete |insert )/i)
    .map((chunk) => chunk.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((chunk) => /^(select|update|delete|insert) /.test(chunk));
}

describe('toda sentencia sobre una tabla con dueño lleva su predicado de actor', () => {
  for (const path of ADAPTERS) {
    describe(path, () => {
      const found = statements(source(path));

      it('el fichero tiene sentencias que auditar', () => {
        // Si el extractor dejara de encontrarlas, este fichero pasaría en verde
        // sin haber comprobado nada. Es el modo de fallo silencioso del propio
        // test, y se cierra aquí.
        expect(found.length).toBeGreaterThan(0);
      });

      it('ningún SELECT, UPDATE o DELETE se queda sin `actor_id`', () => {
        const touching = found.filter(
          (sql) =>
            /^(select|update|delete) /.test(sql) &&
            OWNED_TABLES.some((table) => sql.includes(table)),
        );

        const sinPredicado = touching.filter((sql) => !sql.includes('actor_id'));
        expect(sinPredicado).toEqual([]);
      });

      it('ninguna se protege ÚNICAMENTE por `client_operation_id`', () => {
        /*
         * Era el hueco real: la comprobación de clave duplicada preguntaba sólo
         * por `client_operation_id`, así que leía —y respondía sobre— la fila de
         * otra cuenta.
         */
        const soloPorClave = found.filter(
          (sql) => sql.includes('client_operation_id = ?') && !sql.includes('actor_id'),
        );
        expect(soloPorClave).toEqual([]);
      });

      it('ninguna sentencia de escritura carece de cláusula `where`', () => {
        // Un `UPDATE` o un `DELETE` sin `where` alcanzarían a TODAS las cuentas
        // del aparato de una vez, que es el peor caso posible de esta tabla.
        const escrituras = found.filter((sql) => /^(update|delete) /.test(sql));
        for (const sql of escrituras) expect(sql).toContain(' where ');
      });

      it('el upsert del catálogo acota su conflicto por actor', () => {
        // Es la única escritura sin `where`, y por eso se comprueba aparte: lo
        // que la acota es el objetivo del conflicto, que incluye `actor_id`.
        for (const sql of found.filter((s) => s.includes('on conflict'))) {
          // El catálogo por `(actor_id, key)`; el cursor de reconciliación, por
          // `(actor_id)`. En los dos el actor forma parte del objetivo.
          expect(sql).toMatch(/on conflict \(actor_id(, key)?\)/);
        }
      });
    });
  }
});

describe('la API del almacén no deja mutar sin decir de quién', () => {
  const PORT = source('src/lib/offline/queue-store.ts');
  const CACHE = source('src/lib/offline/catalogue-cache.ts');

  it('todo método de la cola recibe el actor, salvo `enqueue`, que lo lleva dentro', () => {
    for (const method of [
      'pending(actorId: string)',
      'all(actorId: string)',
      'byId(actorId: string,',
      'markProgress(\n    actorId: string,',
      'replace(actorId: string,',
      'remove(actorId: string,',
      'recoverSending(actorId: string)',
      'unsupported(actorId: string)',
    ]) {
      expect(PORT).toContain(method);
    }

    // `enqueue` recibe la entrada entera, y la entrada lleva su `actorId`: no
    // hay forma de encolar sin decir de quién es.
    expect(PORT).toContain('enqueue(entry: QueueEntry)');
    expect(source('src/lib/offline/queue-entry.ts')).toContain('readonly actorId: string;');
  });

  it('`recoverSending` NO puede actuar globalmente', () => {
    // Si algún día admitiera cero argumentos, repararía las filas de todas las
    // cuentas del aparato. La firma es lo que lo impide.
    expect(PORT).toContain('recoverSending(actorId: string): Promise<number>');
    expect(PORT).not.toMatch(/recoverSending\(\s*\)/);
  });

  it('`replace` comprueba que la sustituta es del mismo actor', () => {
    const STORE = source('src/lib/offline/sqlite-queue-store.ts');
    expect(STORE).toContain('if (replacement.actorId !== actorId) throw new QueueWriteRejected(');
  });

  it('todo método del catálogo recibe el actor', () => {
    for (const method of [
      'read(actorId: string, key: string)',
      'write(actorId: string, key: string,',
      'clear(actorId: string, key: string)',
    ]) {
      expect(CACHE).toContain(method);
    }
  });
});

/**
 * LA CACHÉ ES AUXILIAR, Y EL SERVIDOR SIGUE MANDANDO.
 *
 * Se comprueba sobre el fuente porque lo que importa es el **orden** y la
 * **desconexión** de esa escritura, no su resultado: pintar primero, no
 * esperarla, y que ningún fallo suyo pueda salir hacia la carga autoritativa.
 */
describe('la escritura del catálogo no puede alterar la carga online', () => {
  const HOME = source('src/features/personal/use-personal-home.ts');

  it('se guarda DESPUÉS de pintar las categorías', () => {
    const pinta = HOME.indexOf('setCategories(indexCategories(');
    const guarda = HOME.indexOf('rememberCategories(');
    expect(pinta).toBeGreaterThan(-1);
    expect(guarda).toBeGreaterThan(pinta);
  });

  it('no se espera: la carga online no queda pendiente de SQLite', () => {
    expect(HOME).toMatch(/void \(async \(\) => \{[\s\S]*rememberCategories\(/);
  });

  it('un fallo al abrir la base queda contenido', () => {
    const bloque = HOME.slice(HOME.indexOf('rememberCategories('));
    expect(bloque).toContain('} catch {');
  });

  it('la pantalla sigue pintando lo que llega, sin mirar `total`', () => {
    // `total` sólo lo usa la caché para negarse a escribir lo incompleto. Si
    // entrara en el render, una respuesta truncada cambiaría lo que se ve.
    expect(HOME).toContain('indexCategories(categoryPage.rows as CategoryRow[])');
    expect(HOME).not.toMatch(/categoryPage\.total[\s\S]{0,80}setCategories/);
  });

  it('ni el orden ni el color de las categorías pasan por aquí', () => {
    for (const prohibido of ['.sort(', 'categoryColour']) {
      expect(HOME).not.toContain(prohibido);
    }
  });
});
