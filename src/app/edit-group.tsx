import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import {
  GroupWindow,
  listed,
  publishGroupRecorded,
  useGroupParticipants,
  useGroups,
} from '@/features/groups';
import { useEntryCategories } from '@/features/personal';
import { useSession } from '@/features/session';
import { useAddBackdrop } from '@/features/shell';

/**
 * LA VENTANA DE MODIFICAR GRUPO. La misma que crearlo, en modo edición.
 *
 * Recibe la identidad del grupo y lee lo que hay que precargar de las MISMAS
 * lecturas que ya usan la lista y el interior: `useGroups` para nombre, emoji,
 * divisa real y el testigo del CAS; `useGroupParticipants` para los
 * participantes con su identidad. No hay una tercera lectura ni una copia.
 *
 * **Mientras no se sabe, no se pinta el editor**: sin grupo resuelto no hay
 * nada que precargar, y un formulario vacío sobre un grupo con nombre diría lo
 * que no es. Un grupo que no está en la lista —no eres miembro, o no existe—
 * cierra la ventana en vez de enseñar un editor de nada.
 *
 * Tras guardar, `refresh` de las dos lecturas: la lista, la cabecera, el
 * contador y los selectores de gasto se enteran por el mecanismo que ya tenían.
 */
export default function EditGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state: session } = useSession();
  const actorId = session.status === 'signed-in' ? session.identity.userId : '';
  const displayName = session.status === 'signed-in' ? session.identity.displayName : null;
  const backdrop = useAddBackdrop();
  /*
   * El desenfoque lo enciende quien abre esta ventana y lo apaga la LIMPIEZA
   * de la ruta, no el cierre: así cubre también el gesto del sistema y el
   * Atrás de hardware, igual que la ventana del gasto compartido.
   */
  const hideBackdrop = backdrop.hide;
  useEffect(() => hideBackdrop, [hideBackdrop]);

  const { groups, loading } = useGroups(actorId, session.status);
  const participants = useGroupParticipants(id ?? '', actorId, session.status);
  const categories = useEntryCategories(actorId);
  const group = groups.find((one) => one.scopeId === id) ?? null;

  if (group === null) {
    /* Sin grupo no hay editor. Si la lista aún viaja, se espera; si ya llegó y
     * no está, se cierra: no hay nada legítimo que editar. */
    if (!loading && groups.length > 0) router.back();
    return null;
  }

  /*
   * ═══════ NO SE MONTA EL EDITOR SOBRE LA PROYECCIÓN LOCAL DE UN GRUPO YA CONFIRMADO ═══════
   *
   * **El defecto que corrige.** La lista se proyecta antes de que llegue el
   * servidor: la cola durable se lee en un instante y la red tarda. Mientras el
   * snapshot no ha llegado, un grupo cuya creación sigue en la cola se pinta
   * desde su comando congelado —que no lleva la preferencia, ni el testigo del
   * CAS— y `pending` va a `true`. Si el editor se montaba en ESE fotograma,
   * capturaba «Todas» en su estado inicial, y el perfil real que llegaba un
   * instante después ya no lo sustituía. Medido: la preferencia estaba
   * guardada y el gasto nuevo la usaba; sólo el editor la perdía.
   *
   * Así que mientras la primera lectura viaja y lo único que hay es la
   * proyección local, se espera. Un grupo de verdad pendiente —sin fila en el
   * servidor— sí se abre en cuanto la lectura termina, y el formulario dice que
   * no se puede editar todavía.
   */
  if (loading && group.pending) return null;

  return (
    <GroupWindow
      displayName={displayName}
      actorId={actorId}
      personalCurrency={null}
      sessionStatus={session.status}
      edit={{
        scopeId: group.scopeId,
        name: group.displayName,
        emoji: group.emoji,
        currency: {
          id: group.currencyDefinitionId,
          code: group.currencyCode,
          scale: group.currencyScale,
        },
        // Los retirados conservan el nombre en los movimientos y nada más:
        // no se listan (F09/ADR-003 §2). Quien salió se lista como «Inactivo».
        existing: participants.participants.filter(listed).map((one) => ({
          id: one.participantId,
          name: one.displayName,
          self: one.isSelf === true,
          inactive: one.presence !== null && !one.presence.isActive,
        })),
        updatedAt: group.updatedAt,
        defaultCategoryId: group.defaultCategoryId,
      }}
      categories={categories.rows}
      /*
       * Guardado: se publica en el bus que ya existía para los gastos. La
       * lista, la cabecera, el contador y los selectores del gasto están
       * suscritos y se refrescan solos; no hay que conocer sus instancias.
       */
      onEdited={(scopeId) => {
        publishGroupRecorded(scopeId);
      }}
      onClosed={() => {
        router.back();
      }}
    />
  );
}
