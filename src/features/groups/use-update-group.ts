import { useCallback, useRef, useState } from 'react';

import { newClientOperationId } from '@/lib/id';

import { type GroupUpdatePayload, sendGroupUpdate } from './group-service';

/**
 * Por qué no se pudo guardar, en el vocabulario del producto.
 *
 * `conflict` es el único que no se arregla reintentando: otro miembro guardó
 * antes, y lo que hay que hacer es volver a leer el grupo. Los demás se
 * reintentan con la MISMA clave —replay— y el servidor no duplica nada.
 */
export type GroupUpdateFailure = 'offline' | 'conflict' | 'notMember' | 'rejected';

export type GroupUpdateState = {
  readonly save: (payload: Omit<GroupUpdatePayload, 'client_command_id'>) => Promise<boolean>;
  readonly saving: boolean;
  readonly failure: GroupUpdateFailure | null;
};

/**
 * GUARDA LA EDICIÓN DE UN GRUPO, directo a la frontera y con una clave por intención.
 *
 * ═══════════ LA CLAVE SIGUE A LA INTENCIÓN, NO AL INTENTO ═══════════
 *
 * F09/ADR-002: misma clave y misma intención es replay; misma clave y OTRA intención
 * es `IDEMPOTENCY_KEY_REUSED`. Así que la clave se genera una vez por intención
 * y se conserva mientras la intención no cambie: reintentar tras un corte de
 * red reutiliza la clave y, si el servidor ya había escrito, contesta `replay`
 * sin duplicar. Y si la persona cambia el nombre entre dos intentos, la
 * intención es otra y la clave también — nunca se reutiliza una clave con una
 * intención distinta.
 *
 * La huella de la intención es el payload sin la clave, serializado. Es
 * exactamente lo que el servidor guarda como `canonical_intent` menos su
 * canonicalización de nombres, y basta para distinguir «lo mismo otra vez» de
 * «otra cosa».
 *
 * **No pasa por la cola durable.** F07/ADR-001 no se extendió a ediciones de
 * grupo, y una edición marcada «guardada» en disco sin haber llegado al
 * servidor sería la apariencia de éxito que hay que evitar. Sin red se falla y
 * se dice; la ventana sigue abierta con todo lo escrito.
 */
export function useUpdateGroup(): GroupUpdateState {
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<GroupUpdateFailure | null>(null);
  /* Se escribe y se lee SÓLO dentro de `save`, nunca en el render. */
  const key = useRef<{ fingerprint: string; id: string } | null>(null);

  const save = useCallback(async (intent: Omit<GroupUpdatePayload, 'client_command_id'>) => {
    const fingerprint = JSON.stringify(intent);
    if (key.current === null || key.current.fingerprint !== fingerprint) {
      key.current = { fingerprint, id: newClientOperationId() };
    }

    setSaving(true);
    setFailure(null);
    try {
      const response = await sendGroupUpdate({ ...intent, client_command_id: key.current.id });
      if (response.envelope !== null) {
        key.current = null;
        return true;
      }
      setFailure(interpret(response.status, response.code));
      return false;
    } catch {
      setFailure('offline');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { save, saving, failure };
}

/**
 * Del código de la frontera al motivo. Los códigos son los de
 * `sec.raise_boundary`, que viajan en `error.code`; lo que no se reconoce es
 * un rechazo genérico y no se disfraza de otra cosa.
 */
function interpret(status: number, code: string | null): GroupUpdateFailure {
  if (status === 0) return 'offline';
  if (code === 'PROFILE_CONFLICT') return 'conflict';
  if (code === 'NOT_AUTHORIZED') return 'notMember';
  return 'rejected';
}
