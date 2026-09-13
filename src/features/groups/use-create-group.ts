/**
 * ═══════════ LA RUTA DE ALTA DE UN GRUPO ═══════════
 *
 * Crear un grupo pasa **siempre** por aquí, y hace exactamente esto y en este
 * orden (F07/ADR-001 §1, el mismo que el alta de un movimiento):
 *
 *   1  validar el borrador y construir el payload UNA vez   `persistGroup`
 *   2  generar las identidades, antes del primer intento    `newClientOperationId`
 *   3  persistir clave y payload ATÓMICAMENTE               `store.enqueue`
 *   4  publicar el cambio, para que la proyección lo vea   `publishQueueChange`
 *   5  cerrar la ventana                                    quien llama, con `true`
 *   6  despertar al worker                                  en la siguiente macrotarea
 *   7  enviar siempre el payload congelado                  el worker, por su transporte
 *
 * **La ventana sólo se cierra si el paso 3 quedó demostrado.** Si SQLite falla,
 * esto devuelve `null`, el formulario se queda con todos sus datos, y **no se
 * llama a `api.create_group` por la puerta directa** para salvar la creación:
 * serían dos rutas de escritura activas.
 *
 * **Las tres identidades se generan una sola vez, aquí, y viajan congeladas.**
 * La del comando hace idempotente el envío; la del ámbito ya es la definitiva,
 * así que la tarjeta y la ruta interior valen desde el primer fotograma y
 * confirmarse no las cambia; la del participante creador es lo que hace que un
 * replay devuelva la misma gente en vez de duplicarla.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { newClientOperationId } from '@/lib/id';
import type { SessionStatus } from '@/lib/offline';
import { publishQueueChange, queueStore, setQueueIdentity, wakeQueue } from '@/lib/offline';

import type { GroupDraft } from './group-draft';
import { type GroupPersistFailure, persistGroup } from './group-enqueue';

/** Por qué no se pudo crear. `null` es que sí. */
export type CreateGroupFailure = 'noSession' | 'noCurrency' | GroupPersistFailure;

/** La divisa base del grupo, resuelta antes de encolar. */
export type GroupCurrency = {
  readonly definitionId: string;
  readonly code: string;
  /** Los decimales de ESTA definición. Nunca se presupone 2. */
  readonly scale: number;
};

export type CreateGroup = {
  /**
   * La identidad definitiva del grupo si quedó persistido, `null` si no.
   *
   * Sólo con una identidad puede cerrarse la ventana: es lo único que demuestra
   * que el comando está en disco y que la tarjeta va a poder pintarse.
   */
  readonly create: (
    draft: GroupDraft,
    creatorName: string,
    currency: GroupCurrency,
  ) => Promise<string | null>;
  readonly failure: CreateGroupFailure | null;
  readonly saving: boolean;
};

export function useCreateGroup(actorId: string, status: SessionStatus): CreateGroup {
  const [failure, setFailure] = useState<CreateGroupFailure | null>(null);
  const [saving, setSaving] = useState(false);
  /*
   * Aquí muere la segunda pulsación, **síncronamente**. El estado no sirve para
   * esto: es asíncrono, y dos toques en el mismo fotograma leerían los dos el
   * valor viejo, generarían dos claves distintas y crearían dos grupos.
   */
  const inFlight = useRef(false);

  const create = useCallback(
    async (
      draft: GroupDraft,
      creatorName: string,
      currency: GroupCurrency,
    ): Promise<string | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setFailure(null);

      try {
        if (actorId === '' || status !== 'signed-in') {
          setFailure('noSession');
          return null;
        }
        if (draft.currencyId === null || draft.currencyId !== currency.definitionId) {
          // «Todavía no se sabe» no se rellena con euros: sin divisa resuelta no
          // hay grupo que crear, y hacerlo elegiría una moneda por la persona.
          setFailure('noCurrency');
          return null;
        }

        // En un manejador sí: los puertos tienen que ver ESTA cuenta, y no la
        // que hubiera cuando corrió el último efecto de la raíz.
        setQueueIdentity(actorId, status);

        setSaving(true);
        const store = await queueStore();

        // 2 · las identidades, antes del primer intento y una sola vez.
        const identities = {
          clientCommandId: newClientOperationId(),
          clientGroupId: newClientOperationId(),
          creatorParticipantId: newClientOperationId(),
        };

        // 1 · 3 — en `persistGroup`, que es puro salvo la escritura y se prueba
        // con la base fallando: si no puede demostrar que quedaron en disco,
        // devuelve fallo y la ventana no se cierra.
        const persisted = await persistGroup(store, {
          actorId,
          draft,
          identities,
          creatorName,
          currency,
          createdAt: new Date().toISOString(),
        });
        if (!persisted.ok) {
          setFailure(persisted.reason);
          return null;
        }

        // 4 · publicar: la proyección relee la cola y pinta la tarjeta.
        publishQueueChange({
          kind: 'enqueued',
          actorId,
          clientOperationId: identities.clientCommandId,
          state: 'queued',
        });

        // 6 · despertar, en la siguiente macrotarea: después de que quien llama
        // haya cerrado la ventana (5). Nada de esto espera a la red.
        setTimeout(() => {
          wakeQueue();
        }, 0);

        return identities.clientGroupId;
      } catch {
        setFailure('storeUnavailable');
        return null;
      } finally {
        setSaving(false);
        inFlight.current = false;
      }
    },
    [actorId, status],
  );

  return useMemo(() => ({ create, failure, saving }), [create, failure, saving]);
}
