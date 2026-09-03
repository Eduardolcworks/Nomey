/**
 * EL DISCRIMINANTE CERRADO, y la forma que exige cada uno.
 *
 * ADR-028 §3: la entrada **no guarda el nombre de una función RPC**. Guarda un
 * valor de este vocabulario, y quien envía lo traduce con un `switch`
 * exhaustivo. Un valor desconocido —una entrada escrita por una versión
 * posterior de la app— **no se ejecuta nunca**.
 *
 * Guardar un nombre de función libre convertiría el fichero local en una lista
 * de llamadas arbitrarias, y una entrada corrupta sería una invocación no
 * prevista.
 *
 * **F7 tiene exactamente dos** (ADR-028 §4). Correcciones, anulaciones y
 * ajustes llevan CAS y conflictos propios y no se incorporan por analogía.
 */

export const QUEUE_COMMAND_TYPES = ['personal_expense.create', 'personal_income.create'] as const;

export type QueueCommandType = (typeof QUEUE_COMMAND_TYPES)[number];

export function isQueueCommandType(value: string): value is QueueCommandType {
  return (QUEUE_COMMAND_TYPES as readonly string[]).includes(value);
}

/**
 * El payload congelado, tal como lo recibe la frontera.
 *
 * Se guarda **como lo construyó `buildPayload`** y no se modifica jamás
 * (ADR-028 §1): congelarlo es lo que hace que la intención canónica que calcula
 * el servidor sea idéntica en todos los intentos, y por tanto que un reintento
 * sea replay y no `IDEMPOTENCY_KEY_REUSED`.
 *
 * `lib/` no puede importar de `features/`, así que el tipo se declara aquí de
 * forma estructural. Quien lo construye sigue siendo la feature; esto sólo
 * describe qué se admite guardar.
 */
export type FrozenPayload = Readonly<Record<string, string | number>>;

/** Qué campos exige cada comando, y cuáles tiene prohibidos. */
type CommandShape = {
  readonly required: readonly string[];
  readonly forbidden: readonly string[];
};

const COMMON = [
  'client_operation_id',
  'command_contract_version',
  'scope_id',
  'currency_definition_id',
  'amount',
  'effective_date',
  'effective_time',
  'concept',
] as const;

/**
 * La forma de cada clase, y por qué el ingreso **prohíbe** la categoría.
 *
 * No es simetría estética: `category_id` dejó de ser un campo admisible del
 * contrato de ingreso (ADR-027 §3), así que mandarlo se rechaza **por forma**
 * con `PAYLOAD_INVALID · 400` antes de que nadie mire a qué apunta. Detectarlo
 * al encolar convierte un fallo que llegaría horas después, sin red de por
 * medio, en un fallo inmediato en el sitio donde se puede corregir.
 */
const SHAPES: Record<QueueCommandType, CommandShape> = {
  'personal_expense.create': { required: [...COMMON, 'category_id'], forbidden: [] },
  'personal_income.create': { required: [...COMMON], forbidden: ['category_id'] },
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
  | 'emptyConcept';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Unidades mínimas positivas, en texto y sin signo. Nunca una cifra con coma. */
const MINOR_UNITS = /^[1-9][0-9]*$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME = /^\d{2}:\d{2}$/;

const UUID_FIELDS = [
  'client_operation_id',
  'scope_id',
  'currency_definition_id',
  'category_id',
] as const;

/**
 * ¿ES ESTE PAYLOAD ALMACENABLE, EXACTAMENTE COMO ESTÁ?
 *
 * Valida **la serialización, no la contabilidad**. Que 12,00 € sea un gasto
 * razonable no es asunto de la cola; que los 1200 lleguen al servidor siendo
 * los mismos 1200 después de un reinicio, sí.
 *
 * Las dos reglas que importan y por qué:
 *
 * - **`amount` es texto de dígitos.** ADR-003 §1 y ADR-008 §1: un importe no
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
  const admissible = new Set<string>([...shape.required, ...shape.forbidden]);

  for (const field of shape.required) {
    if (entries[field] === undefined) return 'missingField';
  }
  for (const field of shape.forbidden) {
    if (entries[field] !== undefined) return 'forbiddenField';
  }

  for (const [key, value] of Object.entries(entries)) {
    if (!admissible.has(key)) return 'unknownField';
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) return 'inexactNumber';
      continue;
    }
    if (typeof value !== 'string') return 'inexactNumber';
  }

  if (typeof entries.amount !== 'string' || !MINOR_UNITS.test(entries.amount)) {
    return 'amountNotExact';
  }
  for (const field of UUID_FIELDS) {
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
