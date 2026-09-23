import type { GroupCreatePayload } from '@/lib/offline';

import type { MovementFilters } from './movement-filters';
import type { GroupExpensePayload } from './shared-expense';
import { supabase } from '@/lib/supabase';

export type { GroupCreatePayload };

/**
 * Lo ÚNICO de este dominio que habla con Supabase. **Y sólo lee.**
 *
 * Mismo patrón que `features/personal/personal-service.ts`. En este bloque no
 * hay ninguna escritura porque no existe: `core.scope` no tiene ni nombre ni
 * emoji, no hay tabla de invitaciones y no hay función escritora de grupos.
 * Añadir aquí un `createGroup` que no persistiera nada sería exactamente la
 * apariencia de éxito que este paso no debe fabricar.
 */

/** Una definición monetaria del catálogo, tal y como la publica `api`. */
export type CurrencyOption = {
  readonly id: string;
  readonly code: string;
  /** Los decimales de ESTA definición. Nunca se presupone 2 (F02/ADR-001). */
  readonly scale: number;
};

/**
 * El catálogo de divisas soportadas.
 *
 * **Es `api.currency_definition`**, la vista `security_invoker` que el propio
 * provisioning del Modo Personal publicó y que `authenticated` puede leer. Son
 * las veinte que la migración siembra, así que se traen enteras: paginarlas
 * costaría más de lo que ahorra.
 *
 * Las tres columnas salen anulables del generador de tipos porque una vista no
 * declara `not null`; las filas incompletas se descartan aquí, que es donde se
 * sabe que una divisa sin código no es elegible.
 */
export async function fetchCurrencies(): Promise<readonly CurrencyOption[]> {
  const { data, error } = await supabase.from('currency_definition').select('id,code,scale');
  if (error !== null) throw error;

  const rows = (data ?? []).flatMap((row) =>
    row.id === null || row.code === null || row.scale === null
      ? []
      : [{ id: row.id, code: row.code, scale: row.scale }],
  );

  return rows.slice().sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * LO QUE DEVUELVE `api.create_group`, sin interpretar.
 *
 * `replay` es lo que distingue una creación de un reintento que llegó cuando el
 * servidor ya había escrito. **Las dos son confirmación válida del mismo
 * comando**: el grupo existe, es el mismo, y quien lo pidió no tiene que hacer
 * nada distinto.
 */
export type GroupEnvelope = {
  readonly scope_id: string;
  readonly display_name: string;
  readonly emoji: string;
  readonly base_currency_definition_id: string;
  readonly currency_code: string;
  readonly currency_scale: number;
  readonly participant_count: number;
  readonly created_at: string;
  readonly replay: boolean;
  /** La categoría preestablecida, o `null` («Todas»). Ausente en sobres antiguos. */
  readonly default_category_id?: string | null;
};

export type RawGroupResponse = {
  readonly status: number;
  readonly code: string | null;
  readonly envelope: GroupEnvelope | null;
};

/**
 * Manda una creación de grupo a la frontera. **Sin interpretar la respuesta.**
 *
 * Mismo patrón que `sendPersonalEntry`, y por las mismas razones:
 * `.abortSignal(signal)` cancela el `fetch` de verdad en vez de abandonar una
 * espera, y **abortar en el cliente NO demuestra que PostgreSQL no lo haya
 * ejecutado** — por eso el plazo conserva la entrada y su clave, y quien decide
 * qué pasó es el servidor en el reintento, con `replay`.
 */
export async function sendGroupCreate(
  payload: GroupCreatePayload,
  signal?: AbortSignal,
): Promise<RawGroupResponse> {
  const builder = supabase.rpc('create_group', { payload: payload as never });
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
  return { status, code: null, envelope: response.data as GroupEnvelope | null };
}

/**
 * UN GRUPO TAL Y COMO LO PUBLICA EL SERVIDOR, ya filtrado por RLS.
 *
 * `scope_id` es la MISMA identidad que el cliente generó al crearlo
 * (`client_group_id`), así que confirmarse no la cambia: la tarjeta no salta, la
 * ruta no se rompe y la proyección puede unir las dos fuentes por igualdad.
 */
export type RemoteGroup = {
  readonly scopeId: string;
  readonly displayName: string;
  readonly emoji: string;
  readonly currencyDefinitionId: string;
  readonly currencyCode: string;
  readonly currencyScale: number;
  readonly participantCount: number;
  readonly createdAt: string;
  /**
   * EL TESTIGO DEL CAS de la edición: el instante del último guardado.
   *
   * El editor lo declara tal cual lo leyó y el servidor lo compara bajo
   * bloqueo; si otro miembro guardó entre medias, `PROFILE_CONFLICT`. Es un
   * instante y no dinero, así que viaja como texto sin más contrato.
   */
  readonly updatedAt: string;
  /**
   * LA CATEGORÍA PREESTABLECIDA con la que nace un gasto nuevo de este grupo,
   * o `null` («Todas»: sin preselección). Es una PREFERENCIA del perfil, no un
   * hecho contable: el gasto guarda la suya en `core.expense_category` y no
   * depende de esto después.
   */
  readonly defaultCategoryId: string | null;
  /**
   * EL MOMENTO REAL DEL ÚLTIMO MOVIMIENTO registrado en el grupo, o `null` si
   * no tiene ninguno. Es `core.operation.created_at` del alta —no la fecha
   * efectiva elegida, no una versión, no una lectura del aparato— y llega en
   * la MISMA lectura de conjunto que el resto del perfil.
   */
  readonly lastActivityAt: string | null;
};

/**
 * Los grupos de quien está dentro. **Sin filtro por actor en el cliente.**
 *
 * `api.group_profile` es una vista `security_invoker`, así que quien decide qué
 * filas se ven es la RLS de `core.membership` bajo la identidad real. Añadir
 * aquí un `.eq('user_id', …)` sería una optimización disfrazada de seguridad —
 * y la regla del proyecto es explícita: un filtro de cliente nunca es una
 * autorización.
 *
 * Las columnas salen anulables porque una vista no declara `not null`; una fila
 * incompleta se descarta aquí, que es donde se sabe que un grupo sin identidad
 * ni divisa no se puede pintar.
 */
export async function fetchGroups(): Promise<readonly RemoteGroup[]> {
  const { data, error } = await supabase
    .from('group_profile')
    .select(
      'scope_id,display_name,emoji,base_currency_definition_id,currency_code,currency_scale,participant_count,created_at,updated_at,default_category_id,last_activity_at',
    );
  if (error !== null) throw error;

  return (data ?? []).flatMap((row) =>
    row.scope_id === null ||
    row.display_name === null ||
    row.emoji === null ||
    row.base_currency_definition_id === null ||
    row.currency_code === null ||
    row.currency_scale === null ||
    row.participant_count === null ||
    row.created_at === null ||
    row.updated_at === null
      ? []
      : [
          {
            scopeId: row.scope_id,
            displayName: row.display_name,
            emoji: row.emoji,
            currencyDefinitionId: row.base_currency_definition_id,
            currencyCode: row.currency_code,
            currencyScale: row.currency_scale,
            participantCount: row.participant_count,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            defaultCategoryId: row.default_category_id,
            lastActivityAt: row.last_activity_at,
          },
        ],
  );
}

/** Lo que `api.update_group_profile` acepta. Ni moneda ni identidad: no son editables por aquí. */
export type GroupUpdatePayload = {
  readonly client_command_id: string;
  readonly command_contract_version: 1;
  readonly scope_id: string;
  readonly display_name: string;
  readonly emoji: string;
  /** La preferencia. `null` es «Todas». El servidor la valida como la del gasto. */
  readonly default_category_id: string | null;
  /** El `updated_at` que se leyó. El servidor rechaza si ya no es el vigente. */
  readonly expected_updated_at: string;
  /** SÓLO los nuevos. Los existentes no se reenvían: conservan identidad y presencia. */
  readonly participants: readonly { client_participant_id: string; display_name: string }[];
};

/**
 * EDITA EL PERFIL DE UN GRUPO. **Sin interpretar la respuesta.**
 *
 * Mismo patrón que `sendGroupCreate`. Va directo a la frontera y no por la cola
 * durable: F07/ADR-001 no se extendió a ediciones de grupo, y una edición que se
 * quedara en disco «guardada» sin haber llegado al servidor sería exactamente
 * la apariencia de éxito que no se puede fabricar. Sin red, falla y se dice.
 */
export async function sendGroupUpdate(payload: GroupUpdatePayload): Promise<RawGroupResponse> {
  const response = (await supabase.rpc('update_group_profile', {
    payload: payload as never,
  })) as unknown as { data: unknown; error: { code?: string | null } | null; status?: number };

  const status = typeof response.status === 'number' ? response.status : 0;
  if (response.error !== null && response.error !== undefined) {
    return { status, code: response.error.code ?? null, envelope: null };
  }
  return { status, code: null, envelope: response.data as GroupEnvelope | null };
}

/**
 * REGISTRA UN GASTO COMPARTIDO. **Sin interpretar la respuesta.**
 *
 * Mismo patrón que `sendGroupCreate` y `sendPersonalEntry`: se devuelve lo que
 * llegó —estado, código y sobre— y quien decide qué significa es quien conoce el
 * flujo. Abortar en el cliente NO demuestra que PostgreSQL no lo haya
 * ejecutado, y por eso la clave del comando la conserva quien reintenta: el
 * servidor responde `replay` y no crea una segunda operación (F03/ADR-007).
 */
export async function sendGroupExpense(
  payload: GroupExpensePayload,
): Promise<{ readonly status: number; readonly code: string | null; readonly ok: boolean }> {
  const response = (await supabase.rpc('record_group_expense', {
    payload: payload as never,
  })) as unknown as { data: unknown; error: { code?: string | null } | null; status?: number };

  const status = typeof response.status === 'number' ? response.status : 0;
  if (response.error !== null && response.error !== undefined) {
    return { status, code: response.error.code ?? null, ok: false };
  }
  return { status, code: null, ok: true };
}

/** Cómo se ordena la lista. Ordena, no filtra: ninguna opción esconde nada. */
export type GroupOrder = 'dateDesc' | 'dateAsc' | 'amountDesc' | 'amountAsc';

export const GROUP_ORDERS: readonly GroupOrder[] = [
  'dateDesc',
  'dateAsc',
  'amountDesc',
  'amountAsc',
];

/** Un gasto del grupo tal y como lo publica `api.group_operation`. */
export type GroupOperation = {
  readonly operationId: string;
  /**
   * La versión VIGENTE de esa operación.
   *
   * Es el `expected_version_id` de una corrección o una anulación: sin él el
   * cliente no puede declarar sobre QUÉ está corrigiendo, y el CAS del
   * servidor no tendría contra qué comparar (F03/ADR-008 §13).
   */
  readonly versionId: string;
  readonly concept: string;
  readonly categoryId: string | null;
  readonly effectiveDate: string;
  /**
   * `HH:MM:SS` de la versión, o `null`: los gastos anteriores a esta hora no
   * la tienen y no se les inventa. Es lo que ordena junto a la fecha.
   */
  readonly effectiveTime: string | null;
  readonly totalMinor: string;
  /** La moneda de `totalMinor`. `null` si la lectura no la trajo. */
  readonly originalCurrencyId: string | null;
  /**
   * La cuota del actor, o `null` si no participó — que no es cero.
   *
   * **Y no viene quién pagó.** El pagador vive en `core.split`, que el cliente
   * no alcanza, y una vista `security_invoker` se evalúa con SUS privilegios:
   * publicarlo obligaría a ampliar lo que `authenticated` puede leer, y nada de
   * lo que se pinta lo necesita todavía. Medido —la vista respondía
   * `permission denied for table split`— en
   * `supabase/checks/group-expense-flow.sql` §D5d.
   */
  readonly yourShareMinor: string | null;
  /**
   * QUIÉN PUSO EL DINERO. Sale de `core.split`, que es donde el escritor lo
   * persiste; no es quien registró la operación ni quien tiene cuota.
   */
  readonly payerParticipantId: string | null;
  /** `equal` · `shares` · `exact_amounts`. El método DECLARADO. */
  readonly splitMethod: string | null;
  /**
   * El importe DECLARADO de la versión inmediatamente anterior. `null` si es
   * un alta.
   *
   * **Que exista no significa que el importe cambiara**: corregir la
   * categoría, el concepto o el reparto deja versión nueva con el mismo
   * total. Quien pinta compara; aquí sólo llega el dato.
   */
  readonly previousMinor: string | null;
  /** Cuántas versiones lleva. Mayor que uno = se ha editado. */
  readonly versionNo: number;
  readonly createdAt: string;
};

/**
 * Los gastos de un grupo, ya ordenados POR EL SERVIDOR.
 *
 * **El orden se pide en la consulta, no se aplica a lo que ya llegó.** Ordenar
 * en el cliente ordenaría sólo la página traída, y la primera página de «mayor
 * gasto» dejaría de ser la de los mayores en cuanto hubiera más de una.
 *
 * **Los importes se ordenan por su valor, no por su texto.** `total_amount` sale
 * como texto porque es dinero exacto (F03/ADR-005 §1), así que el orden se pide
 * sobre `original_amount`… que la vista no publica sin convertir. Se ordena por
 * la columna de la vista y PostgREST lo resuelve en SQL sobre el `bigint`
 * subyacente: `text` de un entero sin signo ordena igual que el número sólo si
 * tienen los mismos dígitos, así que la vista publica además el valor ordenable.
 *
 * **Desempate estable**, siempre: dos gastos del mismo día o del mismo importe
 * no pueden cambiar de sitio entre dos consultas. Se desempata por el instante
 * de alta y, en última instancia, por la identidad de la operación.
 */
export async function fetchGroupOperations(
  scopeId: string,
  order: GroupOrder,
  /**
   * Lo que acota la lista. **Se pide al SERVIDOR, con el orden.**
   *
   * Quedarse con «los que cumplen, de los que llegaron» daria una lista
   * incompleta que no lanza nada: `max_rows` corta la peticion en mil filas, y
   * un filtro que esconde gastos sin decirlo es peor que no tener filtro. Es el
   * mismo defecto que F6.E midio con las estadisticas.
   */
  filters: MovementFilters,
): Promise<readonly GroupOperation[]> {
  let query = supabase
    .from('group_operation')
    .select(
      /*
       * `original_currency_definition_id` es de F11/ADR-003: el total es el
       * importe DECLARADO y desde F11.D puede no ir en la moneda del grupo.
       * Sin esa columna la fila lo etiquetaria con la del grupo, que es el
       * defecto que F11.D cierra. La lista va en UN literal: PostgREST
       * infiere el tipo de la fila a partir de el, y partirlo lo pierde.
       */
      'operation_id,version_id,concept,category_id,effective_date,effective_time,total_amount,total_order,your_share,payer_participant_id,split_method,previous_amount,version_no,operation_created_at,original_currency_definition_id',
    )
    .eq('scope_id', scopeId);

  /*
   * EL INTERVALO, SOBRE LA COLUMNA ENTERA Y CON LOS DOS EXTREMOS DENTRO.
   * `gte`/`lte` y no `gt`/`lt`: un gasto que vale exactamente el maximo tiene
   * que salir cuando el intervalo llega hasta el maximo.
   *
   * Sobre `total_order` y nunca sobre `total_amount`, que es texto: acotar por
   * el texto dejaria `900` fuera de un intervalo que llega hasta `1500`.
   */
  if (filters.minMinor > 0n) query = query.gte('total_order', filters.minMinor.toString());
  /* Sin tope no se manda ninguna cota: mandar el máximo de ahora dejaría
   * fuera un gasto mayor que llegara después. */
  if (filters.maxMinor !== null) {
    query = query.lte('total_order', filters.maxMinor.toString());
  }
  if (filters.categoryId !== null) query = query.eq('category_id', filters.categoryId);
  /*
   * QUIÉN PAGÓ. Un gasto que alguien pagó sale al filtrar por esa persona
   * aunque el reparto sea de otros; y uno en el que sólo tiene cuota, no.
   * Son dos preguntas distintas y ésta es la del producto.
   */
  if (filters.payerId !== null) {
    query = query.eq('payer_participant_id', filters.payerId);
  }

  /*
   * LA HORA ORDENA CON LA FECHA, y con el mismo criterio que Personal: dentro
   * del día, la hora descendente y los que no tienen hora al final —`nulls
   * last` en los dos sentidos—. Es el contrato de F06/ADR-002 §3: sin hora no es
   * medianoche, es «no se sabe», y no se coloca como si se supiera.
   */
  const ordered =
    order === 'dateDesc'
      ? query
          .order('effective_date', { ascending: false })
          .order('effective_time', { ascending: false, nullsFirst: false })
      : order === 'dateAsc'
        ? query
            .order('effective_date', { ascending: true })
            .order('effective_time', { ascending: true, nullsFirst: false })
        : order === 'amountDesc'
          ? query.order('total_order', { ascending: false })
          : query.order('total_order', { ascending: true });

  const { data, error } = await ordered
    .order('operation_created_at', { ascending: false })
    .order('operation_id', { ascending: true });
  if (error !== null) throw error;

  return (data ?? []).flatMap((row) =>
    row.operation_id === null ||
    row.version_id === null ||
    row.concept === null ||
    row.effective_date === null ||
    row.total_amount === null ||
    row.operation_created_at === null
      ? []
      : [
          {
            operationId: row.operation_id,
            versionId: row.version_id,
            concept: row.concept,
            categoryId: row.category_id,
            effectiveDate: row.effective_date,
            effectiveTime: row.effective_time,
            totalMinor: row.total_amount,
            originalCurrencyId: row.original_currency_definition_id,
            yourShareMinor: row.your_share,
            payerParticipantId: row.payer_participant_id,
            splitMethod: row.split_method,
            previousMinor: row.previous_amount,
            versionNo: row.version_no ?? 1,
            createdAt: row.operation_created_at,
          },
        ],
  );
}

/**
 * UNA FILA DEL REPARTO DECLARADO. Lo que hace falta para corregir un gasto
 * **sin aproximar**: reconstruir «3 partes» dividiendo cuotas ya resueltas es
 * una inferencia, y con un resto repartido por el desempate de F01/ADR-001 §5
 * daría un reparto que nadie escribió.
 */
export type GroupSplitRow = {
  readonly participantId: string;
  /** El desempate de F01/ADR-001 §5, no decoración: fija el orden de la lista. */
  readonly ordinal: number;
  readonly declaredWeight: string | null;
  readonly declaredAmount: string | null;
  readonly resolvedMinor: string;
};

/** El reparto declarado de UNA versión, ya ordenado por su ordinal. */
export async function fetchGroupSplit(versionId: string): Promise<readonly GroupSplitRow[]> {
  const { data, error } = await supabase
    .from('group_split_participant')
    .select('participant_id,ordinal,declared_weight,declared_amount,resolved_amount')
    .eq('version_id', versionId)
    .order('ordinal', { ascending: true });
  if (error !== null) throw error;

  return (data ?? []).flatMap((row) =>
    row.participant_id === null || row.ordinal === null || row.resolved_amount === null
      ? []
      : [
          {
            participantId: row.participant_id,
            ordinal: row.ordinal,
            declaredWeight: row.declared_weight,
            declaredAmount: row.declared_amount,
            resolvedMinor: row.resolved_amount,
          },
        ],
  );
}

/**
 * ANULA UNA OPERACIÓN. **La misma frontera que usa el Modo Personal.**
 *
 * `api.annul_operation` no elige la clase: la lee de la operación y autoriza
 * sobre los ámbitos que su versión vigente alcanza, así que sirve igual para un
 * gasto de grupo. Anular es una versión SIN efectos (F06/ADR-006): no se borra ni
 * una fila, y `current_version_id` sigue siendo la única autoridad.
 */
export async function sendGroupAnnul(payload: {
  readonly client_operation_id: string;
  readonly command_contract_version: 2;
  readonly operation_id: string;
  readonly expected_version_id: string;
}): Promise<{ readonly status: number; readonly code: string | null; readonly ok: boolean }> {
  const response = (await supabase.rpc('annul_operation', {
    payload: payload as never,
  })) as unknown as { data: unknown; error: { code?: string | null } | null; status?: number };

  const status = typeof response.status === 'number' ? response.status : 0;
  if (response.error !== null && response.error !== undefined) {
    return { status, code: response.error.code ?? null, ok: false };
  }
  return { status, code: null, ok: true };
}

/**
 * LA POSICIÓN NETA DE UN PARTICIPANTE DENTRO DEL GRUPO.
 *
 * Lo que le deben menos lo que debe, con signo. **No es su gasto económico ni
 * lo que adelantó como pagador ni el saldo de su Modo Personal** — son cuatro
 * cifras distintas del mismo grupo, y confundirlas es el defecto que
 * `AGENTS.md` §2 existe para impedir.
 */
export type GroupBalanceRow = {
  readonly participantId: string;
  readonly displayName: string;
  /** Si esa identidad contextual es la de quien mira. Nunca de quién es. */
  readonly isSelf: boolean;
  /** Unidades menores de la divisa base del grupo, con signo. */
  readonly netMinor: string;
};

/**
 * Los saldos del grupo, derivados EN EL SERVIDOR sobre los efectos vigentes.
 *
 * **Todos los participantes, tengan cuenta o no**: la vista parte de
 * `core.participant`, así que quien no aparece en ninguna deuda sale con cero
 * CONOCIDO en vez de no salir. Las liquidaciones entran solas —son efectos de
 * deuda negativos— y la suma del grupo es cero por construcción.
 *
 * **Los filtros de Movimientos no llegan aquí.** Saldos describe el grupo
 * entero; acotarlo por un intervalo de importe daría una posición que no es la
 * de nadie.
 */
export async function fetchGroupBalances(scopeId: string): Promise<readonly GroupBalanceRow[]> {
  const { data, error } = await supabase
    .from('group_balance')
    .select('participant_id,display_name,is_self,net_position')
    .eq('scope_id', scopeId)
    .order('display_name', { ascending: true });
  if (error !== null) throw error;

  return (data ?? []).flatMap((row) =>
    row.participant_id === null || row.display_name === null || row.net_position === null
      ? []
      : [
          {
            participantId: row.participant_id,
            displayName: row.display_name,
            isSelf: row.is_self ?? false,
            netMinor: row.net_position,
          },
        ],
  );
}

/**
 * LA POSICIÓN DEL ACTOR EN UN GRUPO, para la lista. Con su definición monetaria.
 *
 * Es la MISMA columna que el interior del grupo enseña —`net_position` de
 * `api.group_summary`— y no una segunda derivación: la tarjeta, el resumen de
 * dentro y las Deudas de Inicio salen del mismo hecho, así que no pueden
 * discrepar. Tres consultas a la misma vista siguen siendo una sola verdad;
 * tres fórmulas distintas serían tres saldos.
 */
export type GroupPositionRow = {
  readonly scopeId: string;
  /** La divisa de ESA posición. Nunca se presupone la del grupo ni la del actor. */
  readonly currencyDefinitionId: string;
  /** Unidades menores con signo: positivo = te deben, negativo = debes. */
  readonly netMinor: string;
};

/**
 * Las posiciones de TODOS los grupos, en UNA consulta.
 *
 * **Sin filtro por ámbito y sin filtro por actor.** `api.group_summary` es
 * `security_invoker` sobre `core.current_effect`, así que la RLS de la
 * membresía decide qué grupos entran, y `net_position` ya está resuelto por
 * `sec.is_my_participant` sobre `core.participant_user_link` — el vínculo real,
 * nunca el nombre ni quién registró la operación.
 *
 * **Una consulta por tarjeta sería 1+N**, y con la lista larga cada refresco
 * costaría tantas peticiones como grupos. Esto es lo mismo que hace la página
 * de movimientos: pedir el conjunto y repartirlo.
 *
 * **Un grupo sin fila no es un grupo sin dato.** La vista agrega sobre efectos
 * vigentes: un grupo sin ningún gasto no produce fila, y eso es un cero
 * CONOCIDO —no hay deuda porque no hay nada que deber—, no una ausencia. Quien
 * lo interpreta es `group-projection.ts`, que es donde está el contrato.
 */
export async function fetchGroupPositions(): Promise<readonly GroupPositionRow[]> {
  const { data, error } = await supabase
    .from('group_summary')
    .select('scope_id,currency_definition_id,net_position');
  if (error !== null) throw error;

  return (data ?? []).flatMap((row) =>
    row.scope_id === null || row.currency_definition_id === null || row.net_position === null
      ? []
      : [
          {
            scopeId: row.scope_id,
            currencyDefinitionId: row.currency_definition_id,
            netMinor: row.net_position,
          },
        ],
  );
}

/** Las tres cifras del grupo, agregadas en el servidor. */
export type GroupTotals = {
  readonly totalMinor: string;
  readonly yourShareMinor: string;
  readonly netPositionMinor: string;
  /**
   * El mayor gasto vigente del grupo, SIN filtrar ni paginar.
   *
   * Es el limite derecho del intervalo. `null` si el servidor no lo publica —y
   * entonces la barra se apaga: no se sustituye por un cero, que afirmaria que
   * el mayor gasto del grupo vale nada.
   */
  readonly maxTotalMinor: string | null;
  /**
   * Cuantos gastos tiene el grupo, tambien sin filtrar.
   *
   * Es lo unico que distingue «este grupo no tiene movimientos» de «ninguno
   * coincide con el filtro», que son dos estados y se dicen distinto.
   */
  readonly expenseCount: number;
};

export async function fetchGroupSummary(scopeId: string): Promise<GroupTotals | null> {
  const { data, error } = await supabase
    .from('group_summary')
    .select('total_amount,your_share,net_position,max_total,expense_count')
    .eq('scope_id', scopeId)
    .maybeSingle();
  if (error !== null) throw error;

  if (data === null || data.total_amount === null || data.your_share === null) return null;
  return {
    totalMinor: data.total_amount,
    yourShareMinor: data.your_share,
    netPositionMinor: data.net_position ?? '0',
    maxTotalMinor: data.max_total,
    expenseCount: data.expense_count ?? 0,
  };
}
