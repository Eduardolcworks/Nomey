import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import {
  MovementForm,
  type MovementFormScope,
  useEntryCategories,
  usePersonalScope,
} from '@/features/personal';
import { useAddBackdrop } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';
import { SheetWindow } from '@/ui/components';

/**
 * La ventana que abre el `+`. **Sólo el alta.**
 *
 * **Y sólo el alta**: corregir un movimiento existente no tiene pantalla ahora
 * mismo — se retiró para rehacerla— y desde luego no vuelve como un modo de
 * ésta. Meter las dos en la misma ruta obligaba a llevar un formulario con dos
 * comportamientos dentro, que es lo que llevó a separarlas. Lo que la nueva
 * reutilizará son las piezas: el armazón `SheetWindow`, la composición
 * `AmountSheet`, los campos, el borrador y el writer.
 *
 * **El ámbito se asegura aquí también.** `usePersonalScope` es idempotente por
 * estado, así que llamarla desde la ventana no duplica nada y evita inventar un
 * estado global para pasar cuatro campos. Mientras resuelve, la ventana ya está
 * dibujada y `Guardar` espera.
 */
export default function AddScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { state } = usePersonalScope();
  const backdrop = useAddBackdrop();

  /*
   * EL FONDO SE APAGA AL DESMONTARSE, no al pulsar cerrar.
   *
   * Es lo que evita el fotograma de Inicio nítido: la ruta todavía se está
   * yendo —el panel baja y luego la pantalla se funde— y durante todo ese rato
   * el desenfoque tiene que seguir puesto. Al desmontarse ya no queda nada
   * encima que proteger.
   *
   * Y por ser una limpieza, cubre cualquier otra salida: el gesto del sistema,
   * un `back` de hardware o que alguien deshaga la ruta desde otro sitio. Con un
   * `hide()` en el manejador de cerrar, esas vías dejarían el fondo encendido
   * sobre una pantalla sin ventana.
   */
  const hideBackdrop = backdrop.hide;
  useEffect(() => hideBackdrop, [hideBackdrop]);
  const categories = useEntryCategories();

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
    <SheetWindow title={t('entry.title')} closeLabel={t('action.close')} onClosed={router.back}>
      {(close) => <MovementForm scope={scope} categories={categories} onSaved={close} />}
    </SheetWindow>
  );
}
