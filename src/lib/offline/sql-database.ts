/**
 * La superficie de SQL que la cola necesita, y nada más.
 *
 * **Existe para que los adaptadores no importen `expo-sqlite`.** Sólo
 * `sqlite-database.ts` lo nombra; todo lo demás habla con este puerto, que un
 * test puede satisfacer con el SQLite real de Node. Eso es lo que permite
 * probar **el SQL de verdad** —las migraciones, las transacciones, los
 * `WHERE` de aislamiento— en Vitest, en vez de probar una maqueta que se
 * parezca al SQL y no lo sea.
 *
 * No es una capa de abstracción de bases de datos: son cinco métodos elegidos
 * porque el adaptador los usa, y crecer aquí es una señal de que el adaptador
 * está haciendo algo que no le toca.
 */

/** Lo que SQLite admite como parámetro enlazado. Sin `number` flotante. */
export type SqlValue = string | number | null;

export type SqlDatabase = {
  /** Sentencias sin parámetros, para migraciones y `PRAGMA`. */
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: readonly SqlValue[]): Promise<void>;
  getAllAsync<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  /**
   * Todo o nada.
   *
   * La cola sólo lo necesita en un sitio —la sustitución de una entrada
   * rechazada por su intención nueva (ADR-028 §5)— y ahí es obligatorio: si se
   * insertara la nueva sin borrar la vieja quedarían dos, y al revés, ninguna.
   */
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
};
