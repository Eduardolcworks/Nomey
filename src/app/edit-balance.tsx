import { useLocalSearchParams } from 'expo-router';

import { BalanceEditor, type MovementFormScope, usePersonalScope } from '@/features/personal';
import { useSession } from '@/features/session';
import { EditWindow } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';

/**
 * Editar el Disponible.
 *
 * **La ruta no dibuja ventana.** La monta `EditWindow` —fondo desenfocado,
 * armazón, encabezado, X, teclado, cierre—, la misma que monta la ruta de
 * corregir un movimiento. Lo único que esta ruta pone de su parte es el título
 * y el contenido.
 *
 * **El Disponible actual llega por parámetro, en unidades mínimas.** Es el que
 * Inicio ya está enseñando: pedirlo otra vez no daría una cifra más exacta,
 * sólo una ventana de tiempo en la que arrancar con algo distinto de lo que se
 * pulsó. Y viaja como texto, así que ningún `number` toca el dinero.
 */
export default function EditBalanceScreen() {
  const { t } = useTranslation();
  const { state: session } = useSession();
  const { state } = usePersonalScope(session.status === 'signed-in' ? session.identity.userId : '');

  const params = useLocalSearchParams<{ current?: string }>();

  const scope: MovementFormScope | null =
    state.status === 'ready'
      ? {
          scopeId: state.scopeId,
          currencyDefinitionId: state.currencyDefinitionId,
          currencyCode: state.currencyCode,
          currencyScale: state.currencyScale,
        }
      : null;

  return (
    <EditWindow title={t('home.balanceTitle')}>
      {(close) => <BalanceEditor scope={scope} current={params.current ?? null} onSaved={close} />}
    </EditWindow>
  );
}
