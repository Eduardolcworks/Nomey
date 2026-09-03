import { supabase } from '@/lib/supabase';

import type { DateRange } from './interval';
import type { EntryPayload } from './movement-entry';
import type { BalanceObservation, PersonalOperation, PersonalOperationVersion } from './movement';
import { OPERATION_ORDER } from './movement';
import type { EnsureScopeResult } from './personal-scope';
import type { PersonalStatistics } from './statistics';

/**
 * Lo ÚNICO de este dominio que habla con Supabase.
 *
 * Mismo patrón que `features/auth/auth-service.ts`, y por el mismo motivo: con
 * una sola puerta se puede afirmar qué consultas hace la pantalla, y las piezas
 * de arriba quedan puras y comprobables.
 *
 * **Ninguna aritmética monetaria aquí.** Los importes viajan como texto
 * (ADR-008 §1) y salen de aquí como texto; quien los convierte a `bigint` es
 * `statistics.toMinor`, y nadie los pasa por un `number`.
 *
 * **Y ninguna suma de saldo.** El `Disponible` lo deriva el servidor y los
 * totales del intervalo también: descargar movimientos para sumarlos es
 * justamente lo que ADR-025 y ADR-026 existen para evitar.
 */

/** Cuántas operaciones trae una página. */
export const PAGE_SIZE = 100;

export type Page<T> = {
  readonly rows: T[];
  /** Cuántas hay en total en el intervalo, según `Content-Range`. */
  readonly total: number;
};

/**
 * Crea el Modo Personal del actor, o devuelve el que ya tenga.
 *
 * **Idempotente por estado**, no por comando: no usa `core.client_command`
 * porque no crea ninguna operación. Repetirla no crea un segundo ámbito ni
 * deshace la moneda elegida, que es lo que hace seguro el reintento.
 */
export async function ensurePersonalScope(currencyCode: string | null): Promise<EnsureScopeResult> {
  const payload = currencyCode === null ? {} : { currency_code: currencyCode };
  const { data, error } = await supabase.rpc('ensure_personal_scope', { payload });
  if (error !== null) throw error;
  return data as unknown as EnsureScopeResult;
}

/**
 * El `Disponible`, derivado por el servidor.
 *
 * **Cero filas significa que NO HAY ÁMBITO**, no saldo cero: la vista devuelve
 * siempre una fila, con `0` cuando el ámbito no tiene efectos. Confundir las dos
 * cosas es el fallo silencioso contra el que avisa la obligación de F6.D, así
 * que la ausencia se devuelve como `null` y no como `'0'`.
 */
export async function fetchBalance(): Promise<{ amount: string; currencyId: string } | null> {
  const { data, error } = await supabase
    .from('personal_balance')
    .select('scope_id,currency_definition_id,balance_amount');
  if (error !== null) throw error;

  const row = data?.[0];
  if (row === undefined || row.balance_amount === null || row.currency_definition_id === null) {
    return null;
  }
  return { amount: row.balance_amount, currencyId: row.currency_definition_id };
}

/**
 * Los totales y el reparto por categoría del intervalo, en UNA petición.
 *
 * `null` significa que el actor no tiene Modo Personal — la misma señal que las
 * cero filas del saldo.
 */
export async function fetchStatistics(range: DateRange): Promise<PersonalStatistics | null> {
  const { data, error } = await supabase.rpc('personal_statistics', {
    p_from: range.from ?? undefined,
    p_to: range.to ?? undefined,
  });
  if (error !== null) throw error;
  return (data as unknown as PersonalStatistics | null) ?? null;
}

const OPERATION_COLUMNS =
  'operation_id,operation_class,scope_id,currency_definition_id,balance_amount,original_amount,' +
  'effective_date,effective_time,concept,category_id,target_balance,current_version_id,' +
  'previous_version_id,version_no,operation_created_at';

/**
 * Una página de operaciones del intervalo, en el orden canónico.
 *
 * El orden va en la petición porque **una vista no puede imponérselo a
 * PostgREST**: es contrato del cliente, y vive en `movement.OPERATION_ORDER`
 * para que la lista y el reordenado local no puedan discrepar.
 *
 * `count: 'exact'` no es un lujo: es lo que permite decir «hay 340 y tienes
 * 100» en vez de dejar creer que la lista está completa. Los TOTALES no
 * dependen de esto —los agrega el servidor y son exactos siempre—, así que una
 * página parcial nunca produce una cifra falsa.
 */
export async function fetchOperations(
  range: DateRange,
  offset = 0,
  pageSize = PAGE_SIZE,
): Promise<Page<PersonalOperation>> {
  let query = supabase
    .from('personal_operation')
    .select(OPERATION_COLUMNS, { count: 'exact' })
    .order('effective_date', { ascending: false })
    .order('effective_time', { ascending: false, nullsFirst: false })
    .order('operation_created_at', { ascending: false })
    .order('operation_id', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (range.from !== null) query = query.gte('effective_date', range.from);
  if (range.to !== null) query = query.lte('effective_date', range.to);

  const { data, error, count } = await query;
  if (error !== null) throw error;

  return { rows: (data ?? []) as unknown as PersonalOperation[], total: count ?? 0 };
}

/**
 * Las versiones anteriores de una página, en UNA consulta.
 *
 * `in.(…)` sobre los `previous_version_id` que la lista publica. Nunca una
 * llamada por fila: es la obligación literal que dejó F6.D.
 */
export async function fetchVersions(
  versionIds: readonly string[],
): Promise<PersonalOperationVersion[]> {
  if (versionIds.length === 0) return [];

  const { data, error } = await supabase
    .from('personal_operation_version')
    .select(
      'operation_id,operation_version_id,operation_class,version_no,is_current,original_amount,' +
        'currency_definition_id,effective_date,effective_time,concept,category_id,target_balance',
    )
    .in('operation_version_id', versionIds as string[]);
  if (error !== null) throw error;

  return (data ?? []) as unknown as PersonalOperationVersion[];
}

/**
 * Las observaciones de saldo de una página, en UNA llamada.
 *
 * La función toma un array precisamente para esto. Se pide **perezosamente**,
 * la primera vez que alguien despliega un movimiento: es un dato ilustrativo
 * que sólo se ve al abrir, y pedirlo siempre sería una petición desperdiciada
 * en la mayoría de las visitas. Perezoso no significa por fila — cuando se
 * pide, se pide la página entera.
 */
export async function fetchObservations(
  operationIds: readonly string[],
): Promise<BalanceObservation[]> {
  if (operationIds.length === 0) return [];

  const { data, error } = await supabase.rpc('observed_balance', {
    p_operation_ids: operationIds as string[],
  });
  if (error !== null) throw error;

  return (data ?? []) as unknown as BalanceObservation[];
}

/** El catálogo visible del actor, para resolver el nombre de una categoría. */
export type CatalogueRow = {
  id: string;
  message_key: string | null;
  label: string | null;
  icon: string;
  /**
   * Vigente o dada de baja. **Se publica y no se filtra aquí**: el histórico
   * necesita las retiradas para resolver su nombre, y sólo quien pinta un
   * selector debe quitarlas (ADR-021 §7).
   */
  is_active: boolean;
};

/**
 * El catálogo, **con cuántos hay en total**.
 *
 * `count: 'exact'` no es un adorno: es lo único que permite distinguir «éste es
 * el catálogo entero» de «esto es lo que cupo». PostgREST corta en `max_rows`
 * sin avisar, así que una respuesta truncada llega **sin error**, y guardarla
 * como caché sustituiría un catálogo bueno por uno al que le faltan
 * categorías. La pantalla no cambia por esto —pinta `rows` igual que antes—;
 * quien usa `total` es la caché, para negarse a escribir lo incompleto.
 */
export async function fetchCategories(): Promise<Page<CatalogueRow>> {
  const { data, error, count } = await supabase
    .from('category')
    .select('id,message_key,label,icon,is_active', { count: 'exact' });
  if (error !== null) throw error;

  return { rows: (data ?? []) as unknown as CatalogueRow[], total: count ?? 0 };
}

/**
 * El sobre que devuelve cualquiera de las ocho funciones de clase.
 *
 * `already_processed` es la parte que **no** se puede tratar como detalle: un
 * reintento devuelve `200` con el mismo `operation_id` y sin haber escrito una
 * segunda vez. Quien lo ignore acabará contando dos veces un movimiento que
 * sólo ocurrió una.
 */
export type WriteResult = {
  readonly operation_id: string;
  readonly already_processed: boolean;
};

/**
 * Registra un gasto personal.
 *
 * La categoría es obligatoria en el payload, y **la ausencia de fila no la
 * impide ninguna restricción del esquema**: quien la exige es esta frontera
 * más el cierre de las escrituras directas a `core` (ADR-027 §2). Omitirla
 * devuelve `PAYLOAD_INVALID · 400`.
 */
export async function recordPersonalExpense(payload: EntryPayload): Promise<WriteResult> {
  const { data, error } = await supabase.rpc('record_personal_expense', { payload });
  if (error !== null) throw error;
  return data as unknown as WriteResult;
}

/**
 * Registra un ingreso personal.
 *
 * **Sin categoría, y no por omisión de esta función**: `category_id` no es un
 * campo admisible de esta clase, así que mandarlo se rechaza por FORMA del
 * payload antes de mirar a qué apunta. Es lo que `buildPayload` garantiza al
 * construirlo, y lo que ADR-027 §3 decidió.
 */
export async function recordPersonalIncome(payload: EntryPayload): Promise<WriteResult> {
  const { data, error } = await supabase.rpc('record_personal_income', { payload });
  if (error !== null) throw error;
  return data as unknown as WriteResult;
}

/**
 * ═══ UNA SOLA PUERTA, Y CUÁL DE SUS DOS FORMAS ESTÁ ACTIVA ═══
 *
 * Las tres funciones de escritura de este fichero —las dos de arriba y
 * `sendPersonalEntry`— salen por **el mismo cliente y las mismas dos funciones
 * de `api`**. No hay una segunda frontera: lo que cambia es cómo se informa el
 * fallo.
 *
 * |                         | quién la usa           | fallo                    |
 * | ----------------------- | ---------------------- | ------------------------ |
 * | `recordPersonal*`       | la pantalla, HOY       | lanza; la hoja se queda  |
 * | `sendPersonalEntry`     | el worker, desde F7.D  | devuelve estado y código |
 *
 * **En F7.C sólo la primera forma está activa en producción.** La ruta de alta
 * sigue enviando directamente, exactamente como en F6: ante un fallo conserva la
 * hoja y el borrador, y no encola. La segunda forma existe, está probada y
 * **no tiene ningún consumidor**.
 *
 * **F7.D hará la sustitución en un solo cambio** —`persistir → proyectar →
 * despertar worker`— y entonces volverá la guarda que impide que un alta salga
 * por la puerta directa. Ponerla ahora dejaría la app sin poder registrar nada.
 *
 * Por qué el worker necesita su propia forma y no puede usar la de la pantalla:
 * la clasificación de ADR-028 §11 se decide con el estado HTTP, el código de
 * frontera y el estado local de la sesión, y una excepción los pierde los tres.
 */

/**
 * El envío que hace el worker, **sin lanzar y con el estado HTTP**.
 *
 * La clasificación de ADR-028 §11 se decide con el estado, el código de
 * frontera y el estado local de la sesión; una excepción los perdería todos y
 * dejaría al worker adivinando. Por eso esto devuelve la respuesta cruda y
 * quien clasifica es `lib/offline/response.ts`, con el mapa medido.
 *
 * **Misma puerta**: el mismo cliente, las mismas dos funciones de `api`, el
 * mismo payload congelado. Lo único distinto es que no se traduce el fallo a
 * una excepción.
 */
export type RawWriteResponse = {
  readonly status: number;
  readonly code: string | null;
  readonly envelope: WriteResult | null;
};

export async function sendPersonalEntry(
  fn: 'record_personal_expense' | 'record_personal_income',
  payload: Readonly<Record<string, string | number>>,
  signal?: AbortSignal,
): Promise<RawWriteResponse> {
  /*
   * `.abortSignal(signal)` — CANCELACIÓN REAL DEL `fetch`, no una espera
   * abandonada.
   *
   * Está en `PostgrestTransformBuilder` de `@supabase/postgrest-js@2.112.4`, y
   * `rpc()` devuelve un `PostgrestFilterBuilder` que hereda de él; el builder
   * base la reenvía al `fetch` como `signal`. Comprobado sobre el paquete
   * instalado, no de memoria.
   *
   * Un `Promise.race` no habría bastado: dejaría la petición viva, gastando
   * batería y datos, y esperando a un servidor que ya no le va a contestar a
   * nadie.
   *
   * **Y abortar en el cliente NO demuestra que PostgreSQL no lo haya
   * ejecutado.** Por eso el plazo conserva la entrada y su clave: quien decide
   * qué pasó es el servidor, en el reintento, con `already_processed`.
   */
  const builder = supabase.rpc(fn, { payload: payload as never });
  const request = signal === undefined ? builder : builder.abortSignal(signal);

  const response = (await request) as unknown as {
    data: unknown;
    error: { code?: string | null } | null;
    status?: number;
  };

  const status = typeof response.status === 'number' ? response.status : 0;
  if (response.error !== null && response.error !== undefined) {
    return { status, code: response.error.code ?? null, envelope: null };
  }
  return { status, code: null, envelope: response.data as WriteResult | null };
}

/**
 * Un ajuste que declara el SALDO, no la diferencia.
 *
 * `api.record_adjustment` admite `delta` o `target_balance`, **exactamente uno**:
 * ni ninguno —no habría intención— ni los dos, que serían dos intenciones en el
 * mismo comando. Esta pantalla usa siempre el objetivo, y por eso el tipo no
 * ofrece `delta`: lo que la persona sabe es cuánto tiene, no cuánto falta.
 *
 * **El delta lo deriva el servidor bajo lock y después del CAS** (ADR-022). Es
 * lo que impide que la diferencia salga de una lectura que pudo quedarse vieja
 * entre que se abrió la ventana y se pulsó guardar.
 */
export type AdjustmentPayload = {
  readonly client_operation_id: string;
  readonly command_contract_version: 2;
  readonly scope_id: string;
  readonly currency_definition_id: string;
  /** El saldo que debe quedar, en unidades mínimas y como texto. */
  readonly target_balance: string;
  readonly effective_date: string;
  readonly effective_time: string;
};

/**
 * Fija el Disponible de un ámbito personal.
 *
 * **No modifica ningún movimiento ni escribe el saldo en ninguna parte.** El
 * saldo no es una fila que se pueda actualizar: se deriva de los efectos
 * vigentes (ADR-013). Lo que esto escribe es una operación de ajuste más, con
 * su versión y su efecto de saldo, y el Disponible cambia porque cambia lo que
 * se deriva de ellos.
 *
 * **Y no cuenta como ingreso ni como gasto.** Un ajuste no produce dimensión
 * económica, así que `api.personal_statistics` lo deja fuera sin ninguna
 * cláusula que lo excluya (ADR-026): no engorda los totales del intervalo ni
 * aparece en el reparto por categoría.
 */
export async function recordAdjustment(payload: AdjustmentPayload): Promise<WriteResult> {
  const { data, error } = await supabase.rpc('record_adjustment', { payload });
  if (error !== null) throw error;
  return data as unknown as WriteResult;
}

/**
 * Lo que anular exige, y nada más.
 *
 * `api.annul_operation` valida la FORMA del payload antes de mirar nada: un
 * campo de más —importe, concepto, categoría— se rechaza con
 * `PAYLOAD_INVALID · 400`. Anular no redescribe el movimiento; sólo dice cuál y
 * desde qué versión.
 */
export type AnnulPayload = {
  readonly client_operation_id: string;
  readonly command_contract_version: 2;
  readonly operation_id: string;
  readonly expected_version_id: string;
};

/**
 * Anula una operación. **Es la única forma de eliminar, y no borra nada.**
 *
 * ADR-024: escribe una versión de clase `annulment` SIN efectos y mueve
 * `current_version_id` hasta ella. La operación y todas sus versiones
 * anteriores siguen donde estaban; lo que desaparece son sus efectos VIGENTES,
 * y por eso deja de contar en el saldo, en los totales del intervalo y en el
 * reparto por categoría **sin que nadie recalcule nada en el cliente**.
 *
 * **Una sola función para cualquier clase**, y no contradice «una función
 * pública por clase de operación» (ADR-009 §1): esa regla existe porque cada
 * clase deriva efectos distintos, y anular no deriva ninguno.
 *
 * **La anulación es TERMINAL en F6**: una operación anulada no admite versiones
 * nuevas, ni siquiera otra anulación — la segunda responde
 * `OPERATION_ANNULLED · 409`. Eso es también la última red contra el doble
 * envío, por debajo de la idempotencia.
 */
export async function annulOperation(payload: AnnulPayload): Promise<WriteResult> {
  const { data, error } = await supabase.rpc('annul_operation', { payload });
  if (error !== null) throw error;
  return data as unknown as WriteResult;
}

export { OPERATION_ORDER };
