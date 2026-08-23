import type { Brand } from './brand';

/**
 * Identidades que el dominio **transporta y compara**, sin interpretarlas.
 *
 * Igual que la identidad de una definición monetaria, no implican UUID, entero
 * ni ningún formato concreto: la representación física pertenece al diseño del
 * esquema, no a esta capa.
 */

export type ParticipantId = Brand<string, 'ParticipantId'>;
export type ScopeId = Brand<string, 'ScopeId'>;

export function participantId(raw: string): ParticipantId {
  return raw as ParticipantId;
}

export function scopeId(raw: string): ScopeId {
  return raw as ScopeId;
}
