/**
 * LO ÚNICO QUE NOMBRA `expo-sqlite`.
 *
 * Mismo patrón que `session-storage.ts` con `expo-secure-store`, y por el mismo
 * motivo: con un solo punto de contacto se puede afirmar en un test que nadie
 * más importa el módulo nativo, y todo lo demás queda comprobable sin él.
 *
 * **La base no se cifra y no guarda secretos.** Sí guarda importes y conceptos
 * mientras una intención está pendiente (ADR-028 §5, §19), así que vive en el
 * sandbox de la app, dura lo mínimo y su contenido no se registra jamás.
 *
 * **El config plugin de `expo-sqlite` NO se añade.** Sólo hace falta para FTS,
 * SQLCipher, libSQL o flags de compilación —nada de eso se usa— y añadirlo
 * tocaría la configuración nativa, que es de F8.
 */

import * as SQLite from 'expo-sqlite';

import type { CatalogueCache } from './catalogue-cache';
import { migrate } from './migrations';
import type { SqlDatabase, SqlValue } from './sql-database';
import { createSqliteCatalogueCache } from './sqlite-catalogue-cache';

export const OFFLINE_DATABASE_NAME = 'nomey-offline.db';

/** Envuelve la base nativa en el puerto estrecho, y en nada más. */
function bindDatabase(db: SQLite.SQLiteDatabase): SqlDatabase {
  return {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: async (sql, params = []) => {
      await db.runAsync(sql, params as SQLite.SQLiteBindValue[]);
    },
    getAllAsync: <T>(sql: string, params: readonly SqlValue[] = []) =>
      db.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]),
    getFirstAsync: <T>(sql: string, params: readonly SqlValue[] = []) =>
      db.getFirstAsync<T>(sql, params as SQLite.SQLiteBindValue[]),
    withTransactionAsync: (task) => db.withTransactionAsync(task),
  };
}

/** Abre la base local y la deja migrada. */
export async function openOfflineDatabase(name = OFFLINE_DATABASE_NAME): Promise<SqlDatabase> {
  const db = bindDatabase(await SQLite.openDatabaseAsync(name));
  await migrate(db);
  return db;
}

/**
 * La base de la app, una sola vez.
 *
 * Se memoriza **la promesa** y no el resultado: dos llamadas simultáneas
 * durante el arranque comparten la misma apertura en vez de abrir dos veces y
 * migrar dos veces. Es el mismo razonamiento que `scope-flight.ts`.
 *
 * Si la apertura falla, se olvida, para que un reintento posterior pueda
 * intentarlo de nuevo en vez de heredar el fallo para siempre.
 */
let handle: Promise<SqlDatabase> | null = null;

export function offlineDatabase(): Promise<SqlDatabase> {
  handle ??= openOfflineDatabase().catch((error: unknown) => {
    handle = null;
    throw error;
  });
  return handle;
}

/** El catálogo cacheado sobre la base de la app. */
export async function offlineCatalogueCache(): Promise<CatalogueCache> {
  return createSqliteCatalogueCache(await offlineDatabase());
}
