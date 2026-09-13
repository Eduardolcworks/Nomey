import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { ShareGroupWindow, useGroups } from '@/features/groups';
import { useSession } from '@/features/session';
import { useAddBackdrop } from '@/features/shell';

/**
 * COMPARTIR UN GRUPO: la ventana con el QR y «Enviar invitación». F09/ADR-004.
 *
 * Misma composición que `edit-group`: el grupo sale de la proyección que ya
 * tiene la lista, así que nombre y emoji son exactamente los de la tarjeta, y
 * el fondo desenfocado lo enciende quien navega hasta aquí y lo apaga esta
 * ruta al desmontarse.
 */
export default function ShareGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state: session } = useSession();
  const actorId = session.status === 'signed-in' ? session.identity.userId : '';
  const backdrop = useAddBackdrop();
  const hideBackdrop = backdrop.hide;
  useEffect(() => hideBackdrop, [hideBackdrop]);

  const { groups, loading } = useGroups(actorId, session.status);
  const group = groups.find((one) => one.scopeId === id) ?? null;

  if (group === null) {
    if (!loading && groups.length > 0) router.back();
    return null;
  }

  return (
    <ShareGroupWindow
      scopeId={group.scopeId}
      emoji={group.emoji}
      name={group.displayName}
      onClosed={() => {
        router.back();
      }}
    />
  );
}
