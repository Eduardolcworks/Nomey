import type { Brand } from '../brand';
import { fail } from '../errors';

/**
 * Identidad de una definición monetaria.
 *
 * **Opaca por decisión.** El dominio la transporta y la compara; nunca la
 * interpreta. No implica UUID, ni entero, ni el código ISO, y no condiciona la
 * representación física que se elija al diseñar el esquema.
 *
 * ADR-003 §3: la unidad de identidad monetaria no es el código visible.
 */
export type CurrencyDefinitionId = Brand<string, 'CurrencyDefinitionId'>;

/**
 * Una definición monetaria: qué significa un importe expresado en ella.
 *
 * `code` es el código ISO 4217 **visible**, un atributo de la definición y no
 * su identidad. Dos definiciones pueden compartir código y no ser la misma.
 *
 * `scale` es el exponente de la unidad mínima —EUR 2, JPY 0, BHD 3—. Es un
 * exponente, no un importe: por eso es `number` y no `bigint`.
 */
export interface CurrencyDefinition {
  readonly id: CurrencyDefinitionId;
  readonly code: string;
  readonly scale: number;
}

export function currencyDefinitionId(raw: string): CurrencyDefinitionId {
  if (raw.length === 0) {
    fail(
      'CURRENCY_DEFINITION_ID_EMPTY',
      'La identidad de una definición monetaria no puede estar vacía',
    );
  }
  return raw as CurrencyDefinitionId;
}

export function currencyDefinition(input: {
  id: string;
  code: string;
  scale: number;
}): CurrencyDefinition {
  const id = currencyDefinitionId(input.id);

  if (input.code.length === 0) {
    fail('CURRENCY_DEFINITION_CODE_EMPTY', 'Una definición monetaria necesita un código visible');
  }

  if (!Number.isInteger(input.scale) || input.scale < 0) {
    fail(
      'CURRENCY_DEFINITION_SCALE_INVALID',
      `La escala debe ser un entero no negativo, recibido: ${String(input.scale)}`,
    );
  }

  return Object.freeze({ id, code: input.code, scale: input.scale });
}

/**
 * Una identidad monetaria estable identifica **una única definición coherente**.
 *
 * Si dos valores dicen tener la misma identidad pero se contradicen en escala o
 * en código, **no son «definiciones distintas»: son un dato corrupto**.
 * Sumarlos produciría una cifra falsa sin lanzar nada, que es exactamente el
 * fallo contra el que existe todo lo demás.
 *
 * De dónde salen las definiciones coherentes es cuestión del catálogo, y ese
 * catálogo pertenece al esquema. El dominio no lo suple: solo se niega a operar
 * sobre una contradicción.
 */
export function assertCurrencyDefinitionCoherent(
  a: CurrencyDefinition,
  b: CurrencyDefinition,
): void {
  if (a.id !== b.id) return;
  if (a.scale !== b.scale || a.code !== b.code) {
    fail(
      'CURRENCY_DEFINITION_INCONSISTENT',
      `La identidad ${a.id} llega con metadatos contradictorios: ${a.code}/${String(a.scale)} y ${b.code}/${String(b.scale)}`,
    );
  }
}

/**
 * Igualdad de definiciones monetarias: **solo por identidad**.
 *
 * Compartir código ISO no basta, y es justamente el error que ADR-003 §3
 * existe para impedir. Compartir identidad con metadatos distintos tampoco es
 * igualdad: es una contradicción, y lanza.
 */
export function sameCurrencyDefinition(a: CurrencyDefinition, b: CurrencyDefinition): boolean {
  assertCurrencyDefinitionCoherent(a, b);
  return a.id === b.id;
}
