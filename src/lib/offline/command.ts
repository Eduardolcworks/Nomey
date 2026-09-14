/**
 * EL DISCRIMINANTE CERRADO, y la forma que exige cada uno.
 *
 * F07/ADR-001 §3: la entrada **no guarda el nombre de una función RPC**. Guarda un
 * valor de este vocabulario, y quien envía lo traduce con un reparto por tipo.
 * Un valor desconocido —una entrada escrita por una versión posterior de la
 * app— **no se ejecuta nunca**.
 *
 * Guardar un nombre de función libre convertiría el fichero local en una lista
 * de llamadas arbitrarias, y una entrada corrupta sería una invocación no
 * prevista.
 *
 * **F7 tuvo exactamente dos** (F07/ADR-001 §4). **F9 añade `group.create`**, con la
 * enmienda del ADR en el mismo cambio. Correcciones, anulaciones y ajustes
 * siguen fuera y **no se incorporan por analogía**: llevan CAS y conflictos
 * propios. `group.create` no lleva ninguno —no corrige nada anterior, no tiene
 * versión previa que comparar y su idempotencia es una clave, no un estado— así
 * que un reintento es un replay y nunca un `VERSION_CONFLICT`.
 */

export const QUEUE_COMMAND_TYPES = [
  'personal_expense.create',
  'personal_income.create',
  'group.create',
] as const;

export type QueueCommandType = (typeof QUEUE_COMMAND_TYPES)[number];

export function isQueueCommandType(value: string): value is QueueCommandType {
  return (QUEUE_COMMAND_TYPES as readonly string[]).includes(value);
}

/**
 * LA FORMA DE UN MOVIMIENTO PERSONAL, congelada.
 *
 * Se guarda **como la construyó `buildPayload`** y no se modifica jamás
 * (F07/ADR-001 §1): congelarla es lo que hace que la intención canónica que calcula
 * el servidor sea idéntica en todos los intentos, y por tanto que un reintento
 * sea replay y no `IDEMPOTENCY_KEY_REUSED`.
 *
 * `lib/` no puede importar de `features/`, así que el tipo se declara aquí de
 * forma estructural. Quien lo construye sigue siendo la feature; esto sólo
 * describe qué se admite guardar.
 */
export type PersonalEntryPayload = {
  readonly client_operation_id: string;
  readonly command_contract_version: number;
  readonly scope_id: string;
  readonly currency_definition_id: string;
  readonly amount: string;
  readonly effective_date: string;
  readonly effective_time: string;
  readonly concept: string;
  readonly category_id?: string;
  readonly operation_id?: string;
  readonly expected_version_id?: string;
};

/**
 * Un participante del grupo, en el momento de encolar.
 *
 * **La identidad la genera el cliente UNA vez**, antes de encolar, y no se
 * regenera nunca: ni en un reintento, ni al reabrir, ni al remontar el
 * formulario. Es lo que hace que un replay devuelva el mismo grupo con la misma
 * gente en vez de duplicarla.
 */
export type GroupParticipantPayload = {
  readonly client_participant_id: string;
  readonly display_name: string;
};

/**
 * LA FORMA DE UNA CREACIÓN DE GRUPO, congelada.
 *
 * **Estructura anidada, y sólo la declarada.** No es un JSON serializado dentro
 * de una cadena —eso metería una estructura opaca en un fichero que hoy se
 * audita campo a campo— ni un tipo abierto. `participants` es una lista de
 * objetos con exactamente dos campos, y cualquier otro se rechaza al encolar.
 *
 * **El oblongo final vacío del formulario no entra aquí.** Es un hueco para
 * escribir, no un participante.
 */
export type GroupCreatePayload = {
  readonly client_command_id: string;
  readonly command_contract_version: number;
  readonly client_group_id: string;
  readonly display_name: string;
  readonly emoji: string;
  readonly currency_definition_id: string;
  readonly creator_participant_id: string;
  readonly creator_display_name: string;
  readonly participants: readonly GroupParticipantPayload[];
  /**
   * LA CATEGORÍA PREESTABLECIDA DEL GRUPO, o su ausencia («Todas»).
   *
   * **Opcional en el contrato durable, a propósito.** Los comandos congelados
   * antes de que existiera no llevan el campo, y tienen que seguir siendo
   * interpretables y reenviables tal cual: ausente vale lo mismo que `null`,
   * y la intención canónica del servidor —que la construye desde el payload—
   * no cambia para ellos. Un comando ya enviado no se reescribe.
   */
  readonly default_category_id?: string | null;
};

/** Lo que se admite guardar, por comando. */
export type FrozenPayload = PersonalEntryPayload | GroupCreatePayload;

/** La forma que corresponde a cada tipo, para que un manejador reciba la suya. */
export type FrozenPayloadOf<K extends QueueCommandType> = K extends 'group.create'
  ? GroupCreatePayload
  : PersonalEntryPayload;

/** Qué campos exige cada comando, y cuáles tiene prohibidos. */
type CommandShape = {
  readonly required: readonly string[];
  readonly optional: readonly string[];
  readonly forbidden: readonly string[];
};

const PERSONAL_COMMON = [
  'client_operation_id',
  'command_contract_version',
  'scope_id',
  'currency_definition_id',
  'amount',
  'effective_date',
  'effective_time',
  'concept',
] as const;

const GROUP_FIELDS = [
  'client_command_id',
  'command_contract_version',
  'client_group_id',
  'display_name',
  'emoji',
  'currency_definition_id',
  'creator_participant_id',
  'creator_display_name',
  'participants',
] as const;

const PARTICIPANT_FIELDS = ['client_participant_id', 'display_name'] as const;

/**
 * La forma de cada clase, y por qué el ingreso **prohíbe** la categoría.
 *
 * No es simetría estética: `category_id` dejó de ser un campo admisible del
 * contrato de ingreso (F06/ADR-009 §3), así que mandarlo se rechaza **por forma**
 * con `PAYLOAD_INVALID · 400` antes de que nadie mire a qué apunta. Detectarlo
 * al encolar convierte un fallo que llegaría horas después, sin red de por
 * medio, en un fallo inmediato en el sitio donde se puede corregir.
 */
const SHAPES: Record<QueueCommandType, CommandShape> = {
  'personal_expense.create': {
    required: [...PERSONAL_COMMON, 'category_id'],
    optional: [],
    forbidden: [],
  },
  'personal_income.create': {
    required: [...PERSONAL_COMMON],
    optional: [],
    forbidden: ['category_id'],
  },
  /*
   * La categoría preestablecida es OPCIONAL en el contrato durable: los
   * comandos congelados antes de que existiera no la llevan y siguen siendo
   * válidos y reenviables tal cual. Ausente equivale a `null` («Todas»).
   */
  'group.create': { required: [...GROUP_FIELDS], optional: ['default_category_id'], forbidden: [] },
};

/** Por qué un payload no se puede encolar. `null` significa que sí. */
export type PayloadDefect =
  | 'notAnObject'
  | 'missingField'
  | 'forbiddenField'
  | 'unknownField'
  | 'inexactNumber'
  | 'amountNotExact'
  | 'badUuid'
  | 'badDate'
  | 'badTime'
  | 'emptyConcept'
  | 'badVersion'
  | 'notAnArray'
  | 'badParticipant'
  | 'duplicateIdentity'
  | 'notCanonical'
  | 'emptyEmoji';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Unidades mínimas positivas, en texto y sin signo. Nunca una cifra con coma. */
const MINOR_UNITS = /^[1-9][0-9]*$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME = /^\d{2}:\d{2}$/;

const PERSONAL_UUID_FIELDS = [
  'client_operation_id',
  'scope_id',
  'currency_definition_id',
  'category_id',
  'operation_id',
  'expected_version_id',
] as const;

const GROUP_UUID_FIELDS = [
  'client_command_id',
  'client_group_id',
  'currency_definition_id',
  'creator_participant_id',
] as const;

/**
 * LA FORMA CANÓNICA DE UN NOMBRE VISIBLE, comprobada y no aplicada.
 *
 * Aquí no se normaliza nada: se **comprueba** que lo que llega ya lo esté. Lo
 * canoniza quien construye el payload —`normaliseName`, en la feature— y el
 * servidor lo vuelve a hacer por su cuenta con `sec.canonical_display_name`,
 * porque no confía en el cliente. Que la cola exija la forma canónica es lo que
 * impide congelar una intención que el servidor entendería de otra manera, y
 * que un reintento legítimo acabe leyéndose como clave reutilizada.
 *
 * Los vectores compartidos de `tests/vectors/display-names.json` fijan qué es
 * canónico, y los reproducen las dos implementaciones.
 */
function isCanonicalName(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  return value === value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * ¿ES ESTE PAYLOAD ALMACENABLE, EXACTAMENTE COMO ESTÁ?
 *
 * Valida **la serialización, no la contabilidad**. Que 12,00 € sea un gasto
 * razonable no es asunto de la cola; que los 1200 lleguen al servidor siendo
 * los mismos 1200 después de un reinicio, sí.
 *
 * Las dos reglas que importan y por qué:
 *
 * - **`amount` es texto de dígitos.** F02/ADR-001 §1 y F03/ADR-005 §1: un importe no
 *   cruza JSON como número. Si entrara aquí como `number`, `12.30` ya sería
 *   `12.299999999999999` antes de tocar SQLite, y el error no lanzaría nada.
 * - **Ningún número no entero, en ningún campo.** El único `number` legítimo
 *   del contrato es `command_contract_version`, que es un entero pequeño.
 *   Cualquier otro flotante es una señal de que alguien metió aritmética
 *   binaria en el camino del dinero, y se rechaza aunque el campo no parezca
 *   monetario.
 */
export function payloadDefect(
  commandType: QueueCommandType,
  payload: unknown,
): PayloadDefect | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'notAnObject';
  }

  const entries = payload as Record<string, unknown>;
  const shape = SHAPES[commandType];
  const admissible = new Set<string>([
    ...shape.required,
    ...shape.optional,
    ...shape.forbidden,
    ...(commandType === 'group.create'
      ? []
      : (['category_id', 'operation_id', 'expected_version_id'] as const)),
  ]);

  for (const field of shape.required) {
    if (entries[field] === undefined) return 'missingField';
  }
  for (const field of shape.forbidden) {
    if (entries[field] !== undefined) return 'forbiddenField';
  }
  for (const key of Object.keys(entries)) {
    if (!admissible.has(key)) return 'unknownField';
  }

  const version = entries.command_contract_version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return 'badVersion';
  }

  return commandType === 'group.create' ? groupDefect(entries) : personalDefect(entries);
}

function personalDefect(entries: Record<string, unknown>): PayloadDefect | null {
  for (const value of Object.values(entries)) {
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) return 'inexactNumber';
      continue;
    }
    if (typeof value !== 'string') return 'inexactNumber';
  }

  if (typeof entries.amount !== 'string' || !MINOR_UNITS.test(entries.amount)) {
    return 'amountNotExact';
  }
  for (const field of PERSONAL_UUID_FIELDS) {
    const value = entries[field];
    if (value !== undefined && (typeof value !== 'string' || !UUID.test(value))) return 'badUuid';
  }
  if (typeof entries.effective_date !== 'string' || !CALENDAR_DATE.test(entries.effective_date)) {
    return 'badDate';
  }
  if (typeof entries.effective_time !== 'string' || !CLOCK_TIME.test(entries.effective_time)) {
    return 'badTime';
  }
  if (typeof entries.concept !== 'string' || entries.concept.trim() === '') return 'emptyConcept';

  return null;
}

/**
 * La forma de una creación de grupo, comprobada campo a campo y hasta el fondo.
 *
 * **Las identidades tienen que ser únicas entre sí y distintas de la del
 * creador.** Dos filas con el mismo `client_participant_id` reventarían a mitad
 * de la inserción en el servidor, y el rechazo debe ser del contrato: aquí,
 * antes de guardar, donde todavía se puede corregir.
 */
function groupDefect(entries: Record<string, unknown>): PayloadDefect | null {
  for (const field of GROUP_UUID_FIELDS) {
    const value = entries[field];
    if (typeof value !== 'string' || !UUID.test(value)) return 'badUuid';
  }

  if (!isCanonicalName(entries.display_name)) return 'notCanonical';
  if (!isCanonicalName(entries.creator_display_name)) return 'notCanonical';

  // El emoji no se canonicaliza —no lleva espacios que colapsar— pero sí se exige.
  if (typeof entries.emoji !== 'string' || entries.emoji.trim() === '') return 'emptyEmoji';

  // La preferencia: ausente o nula es «Todas»; si viene, es un UUID.
  const preset = entries.default_category_id;
  if (
    preset !== undefined &&
    preset !== null &&
    (typeof preset !== 'string' || !UUID.test(preset))
  ) {
    return 'badUuid';
  }

  const participants = entries.participants;
  if (!Array.isArray(participants)) return 'notAnArray';

  const seen = new Set<string>([entries.creator_participant_id as string]);
  for (const raw of participants) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'badParticipant';
    const item = raw as Record<string, unknown>;

    for (const key of Object.keys(item)) {
      if (!(PARTICIPANT_FIELDS as readonly string[]).includes(key)) return 'badParticipant';
    }
    const id = item.client_participant_id;
    if (typeof id !== 'string' || !UUID.test(id)) return 'badUuid';
    if (!isCanonicalName(item.display_name)) return 'notCanonical';

    if (seen.has(id)) return 'duplicateIdentity';
    seen.add(id);
  }

  return null;
}

/**
 * EL PAYLOAD DE UN MOVIMIENTO PERSONAL, o nada.
 *
 * Estrecha por el TIPO DE COMANDO, que es el discriminante real de la entrada,
 * y no por la forma del objeto. Devolver `null` para lo que no es un movimiento
 * obliga a quien proyecta Personal a decidir qué hace con una entrada de otro
 * dominio, en vez de leerle campos que no tiene.
 */
export function personalPayloadOf(
  commandType: QueueCommandType,
  payload: FrozenPayload,
): PersonalEntryPayload | null {
  return commandType === 'group.create' ? null : (payload as PersonalEntryPayload);
}

/** Y el de una creación de grupo, con el mismo criterio. */
export function groupPayloadOf(
  commandType: QueueCommandType,
  payload: FrozenPayload,
): GroupCreatePayload | null {
  return commandType === 'group.create' ? (payload as GroupCreatePayload) : null;
}
