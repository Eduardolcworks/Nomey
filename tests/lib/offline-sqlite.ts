/**
 * El puerto `SqlDatabase` sobre el SQLite que trae Node.
 *
 * **Por qué existe, y por qué merece la pena.** Los adaptadores de
 * `lib/offline` hablan con un puerto de cinco métodos en vez de con
 * `expo-sqlite`, así que aquí se puede satisfacer ese puerto con un SQLite de
 * verdad y probar **el SQL que corre en el aparato**: las migraciones, la
 * transacción de la sustitución, los `WHERE` de aislamiento por actor y el
 * `on conflict` del catálogo.
 *
 * La alternativa era una maqueta en memoria que imitara al store, y habría
 * probado la maqueta. Un `where actor_id = ?` que se olvidara no fallaría en
 * ella, y es exactamente el fallo que no puede pasar.
 *
 * No es código de producción y no vive en `src/`: nada del bundle importa
 * `node:sqlite`.
 */

import { DatabaseSync } from 'node:sqlite';

import type { SqlDatabase, SqlValue } from '../../src/lib/offline/sql-database';

export type TestDatabase = SqlDatabase & {
  /** Cierra el fichero. Un test que abre dos veces la misma base lo necesita. */
  close: () => void;
};

/**
 * @param file ruta en disco, o `:memory:`. Los tests de persistencia entre
 * aperturas necesitan un fichero real; los demás, no.
 */
export function openTestDatabase(file = ':memory:'): TestDatabase {
  const db = new DatabaseSync(file);

  /*
   * `node:sqlite` es síncrono y el puerto es asíncrono. Envolver en promesas ya
   * resueltas es fiel al contrato —el llamante sólo puede `await`— y evita
   * fingir una asincronía que no cambiaría nada de lo que se comprueba.
   */
  const params = (values: readonly SqlValue[]) => values as (string | number | null)[];

  return {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    runAsync: async (sql, values = []) => {
      db.prepare(sql).run(...params(values));
    },
    getAllAsync: async <T>(sql: string, values: readonly SqlValue[] = []) =>
      db.prepare(sql).all(...params(values)) as T[],
    getFirstAsync: async <T>(sql: string, values: readonly SqlValue[] = []) =>
      (db.prepare(sql).get(...params(values)) as T | undefined) ?? null,
    withTransactionAsync: async (task) => {
      db.exec('begin');
      try {
        await task();
        db.exec('commit');
      } catch (error) {
        db.exec('rollback');
        throw error;
      }
    },
    close: () => {
      db.close();
    },
  };
}
