import currenciesFile from '../vectors/currencies.json';
import { currencyDefinition, participantId, scopeId } from '../../src/domain';
import type { CurrencyDefinition, ParticipantId, ScopeId } from '../../src/domain';

/**
 * Carga de los vectores compartidos.
 *
 * Los vectores son **la única fuente de expectativas**: ningún test escribe a
 * mano un resultado esperado. Su formato es JSON, y no un módulo TypeScript,
 * para que la implementación autoritativa del servidor pueda consumir los
 * mismos ficheros y detectar cualquier divergencia.
 *
 * Todos los valores exactos viajan como **string**: un número JSON grande se
 * degrada al parsearse, así que un fichero de vectores con números sería un
 * fichero de vectores incorrecto.
 */

const definitions = new Map<string, CurrencyDefinition>(
  Object.entries(currenciesFile.currencies).map(([key, value]) => [key, currencyDefinition(value)]),
);

export function currency(key: string): CurrencyDefinition {
  const found = definitions.get(key);
  if (found === undefined)
    throw new Error(`Definición monetaria desconocida en los vectores: ${key}`);
  return found;
}

export function participant(raw: string): ParticipantId {
  return participantId(raw);
}

export function scope(raw: string): ScopeId {
  return scopeId(raw);
}

/** Forma común: o se espera un resultado, o se espera un código de error. */
export interface VectorCase {
  readonly id: string;
  readonly source: string;
  readonly note?: string;
  readonly expectError?: string;
}

export interface VectorFile<C extends VectorCase> {
  readonly source: string;
  readonly note?: string;
  readonly cases: readonly C[];
}

/** Nombre legible del caso en la salida del runner. */
export function title(item: VectorCase): string {
  return `${item.id} · ${item.source}`;
}
