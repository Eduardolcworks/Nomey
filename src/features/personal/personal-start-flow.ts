import type { PersonalStartAction } from './personal-scope';

/**
 * EL FLUJO DEL PUNTO DE INICIO, decidido en un sitio puro (F10/ADR-005 §2).
 *
 * `usePersonalStart` sólo cablea efectos; qué toca hacer en cada instante lo
 * dice esta función, y por eso se puede interrogar sin renderer. Las entradas:
 *
 *   enabled   la sesión es una CUENTA. Un invitado nunca decide: ni pregunta,
 *             ni auto-incluye, ni envía nada (su Personal existe, pero la
 *             decisión es de la cuenta en que se convierta)
 *   stale     el ámbito que se tiene leído se leyó SIENDO INVITADO. Al pasar
 *             de invitado a cuenta es viejo por definición: `usePersonalScope`
 *             lo relee (su lectura va por identidad de sesión) y, hasta que la
 *             relectura vuelve, no se evalúa nada
 *   action    lo que dice el ámbito leído (`personalStartAction`)
 *   autoSent  el include automático ya salió en esta habilitación: no se
 *             repite por un render ni por un reintento del mismo estado
 *
 * Y la salida, lo que el hook hace y lo que Inicio pinta:
 *
 *   wait         nada: sin sesión de cuenta, con la relectura en vuelo, o con
 *                el include automático ya enviado
 *   autoInclude  enviar `include` automático, una vez
 *   ask          la pantalla
 *   none         nada que decidir: Inicio pinta el Personal
 */
export type PersonalStartStep = 'wait' | 'autoInclude' | 'ask' | 'none';

export function personalStartStep(input: {
  readonly enabled: boolean;
  readonly stale: boolean;
  readonly action: PersonalStartAction;
  readonly autoSent: boolean;
}): PersonalStartStep {
  if (!input.enabled) return 'wait';
  if (input.stale) return 'wait';
  if (input.action === 'autoInclude') return input.autoSent ? 'wait' : 'autoInclude';
  if (input.action === 'ask') return 'ask';
  return 'none';
}
