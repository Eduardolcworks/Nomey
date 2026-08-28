import { supabase } from '@/lib/supabase';

import type { DateRange } from './interval';
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
export async function fetchCategories(): Promise<
  { id: string; message_key: string | null; label: string | null; icon: string }[]
> {
  const { data, error } = await supabase
    .from('category')
    .select('id,message_key,label,icon,applies_to,is_active');
  if (error !== null) throw error;

  return (data ?? []) as unknown as {
    id: string;
    message_key: string | null;
    label: string | null;
    icon: string;
  }[];
}

export { OPERATION_ORDER };
