import { useEffect, useRef, useState } from 'react';

import { newClientOperationId } from '@/lib/id';

import {
  type PersonalScopeState,
  type PersonalStartMode,
  personalStartAction,
} from './personal-scope';
import { personalStartStep } from './personal-start-flow';
import { startPersonalScope } from './personal-service';

/**
 * EL PUNTO DE INICIO DEL MODO PERSONAL, resuelto al montar Inicio (F10/ADR-005).
 *
 * Qué toca hacer lo decide `personalStartStep` (puro, probado por
 * comportamiento); aquí sólo viven los efectos —enviar— y el estado que
 * Inicio pinta:
 *
 *   ask        la pantalla de dos opciones; `decide(mode)` la envía
 *   resolving  algo en vuelo: la relectura del ámbito tras convertirse, el
 *              `include` automático del primer acceso sin historia, o la
 *              decisión que la persona acaba de tomar. Inicio espera sin
 *              pintar cifras
 *   failed     el comando no llegó o el servidor lo rehusó por algo que no
 *              es «vuelve a leer»; recuperable con `retry`
 *   none       nada que decidir (o ya decidido, o sin sesión de cuenta)
 *
 * **Un invitado no decide.** Con `enabled = false` este hook no pregunta, no
 * auto-incluye y no envía nada: el Personal del invitado existe, pero la
 * decisión es de la cuenta en que se convierta.
 *
 * **Al convertirse se relee antes de evaluar.** `usePersonalScope` lee por
 * identidad de sesión y marca cada lectura con `readAsGuest`; pasar de
 * invitado a cuenta vuelve a leer, y mientras lo que se tiene es la lectura
 * del invitado —vieja por definición— aquí no se evalúa nada. Si lo leído
 * como invitado decía «sin historia» y el servidor, ya con cuenta, dice «con
 * historia», gana el servidor: la pantalla, no el include automático.
 *
 * **La autoridad es el servidor, dos veces.** Qué toca hacer sale de lo que
 * `ensure_personal_scope` respondió, y lo que el comando escribe lo valida el
 * servidor otra vez: un `include` automático que llegue cuando ya hay historia
 * responde `PERSONAL_START_DECISION_REQUIRED` y aquí se relee, que entonces
 * dirá `ask`. `PERSONAL_START_DECIDED` (otro aparato decidió antes) también
 * se resuelve releyendo. Nada se guarda en el dispositivo: la siguiente
 * lectura del ámbito es la única memoria de «ya decidido».
 *
 * **Ni dos comandos por un render, ni por un reintento del mismo estado.** El
 * include automático sale una vez por habilitación (`autoSent`, un `ref` que
 * sólo tocan los efectos), y la clave vive en un `ref` lo que vive la
 * intención: un reintento reutiliza la misma clave; un reinicio de la app
 * manda otra y el servidor —idempotente por estado— responde la decisión
 * existente en vez de romper.
 *
 * **Ningún `setState` síncrono dentro de un efecto** (la misma regla que
 * `usePersonalScope`): el envío automático escribe estado sólo después de la
 * respuesta; mientras tanto, «en vuelo» se deriva del propio paso.
 *
 * @param enabled la sesión es una cuenta (no un invitado).
 * @param refresh vuelve a asegurar el ámbito. Es el `retry` de
 * `usePersonalScope`: idempotente por estado, y es lo que hace que «decidido»
 * sea un hecho leído y no un booleano local.
 */
export type PersonalStartState =
  | { readonly status: 'none' }
  | { readonly status: 'ask' }
  | { readonly status: 'resolving' }
  | { readonly status: 'failed' };

export function usePersonalStart(
  scope: PersonalScopeState,
  refresh: () => void,
  enabled: boolean,
): {
  state: PersonalStartState;
  decide: (mode: PersonalStartMode) => void;
  retry: () => void;
} {
  const action = personalStartAction(scope);
  const stale = scope.status === 'ready' && scope.readAsGuest;
  const [inFlight, setInFlight] = useState(false);
  const [failed, setFailed] = useState(false);
  const key = useRef<{ mode: PersonalStartMode; automatic: boolean; id: string } | null>(null);
  const autoSent = useRef(false);

  /* Lo que se pinta: sin saber si el automático ya salió (eso lo sabe el efecto). */
  const step = personalStartStep({ enabled, stale, action, autoSent: false });

  /*
   * Sin `useCallback`: el compilador de React (activo en app.config) memoiza
   * estas funciones por si mismo, y una memoizacion manual que no coincide con
   * la suya es justo lo que su lint rehusa.
   */
  const run = async (mode: PersonalStartMode, automatic: boolean) => {
    if (key.current === null || key.current.mode !== mode || key.current.automatic !== automatic) {
      key.current = { mode, automatic, id: newClientOperationId() };
    }
    const result = await startPersonalScope({
      client_command_id: key.current.id,
      command_contract_version: 1,
      mode,
      ...(automatic ? { automatic: true as const } : {}),
    });
    setInFlight(false);
    if (
      result.ok ||
      result.code === 'PERSONAL_START_DECIDED' ||
      result.code === 'PERSONAL_START_DECISION_REQUIRED'
    ) {
      // Decidido (por esta llamada o por otra) o «pregunta»: en los tres
      // casos la verdad está en el servidor, y se relee.
      key.current = null;
      refresh();
      return;
    }
    setFailed(true);
  };

  // La ultima `run`, para que el efecto del automatico no dependa de su identidad.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  /* Al deshabilitar (cerrar sesión, otra cuenta) el automático vuelve a estar disponible. */
  useEffect(() => {
    if (!enabled) autoSent.current = false;
  }, [enabled]);

  /* EL INCLUDE AUTOMÁTICO, una vez, y sólo cuando el flujo lo dice. */
  useEffect(() => {
    if (
      personalStartStep({ enabled, stale, action, autoSent: autoSent.current }) !== 'autoInclude'
    ) {
      return;
    }
    autoSent.current = true;
    void runRef.current('include', true);
  }, [enabled, stale, action]);

  const decide = (mode: PersonalStartMode) => {
    setFailed(false);
    setInFlight(true);
    void run(mode, false);
  };
  const retry = () => {
    setFailed(false);
    if (key.current === null) {
      autoSent.current = false;
      refresh();
      return;
    }
    setInFlight(true);
    void run(key.current.mode, key.current.automatic);
  };

  const state: PersonalStartState = !enabled
    ? { status: 'none' }
    : failed
      ? { status: 'failed' }
      : inFlight || step === 'wait' || step === 'autoInclude'
        ? { status: 'resolving' }
        : step === 'ask'
          ? { status: 'ask' }
          : { status: 'none' };

  return { state, decide, retry };
}
