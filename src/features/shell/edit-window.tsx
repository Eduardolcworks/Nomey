import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useAddBackdrop } from './add-backdrop';
import { useTranslation } from '@/lib/i18n';
import { SheetWindow } from '@/ui/components';

/**
 * LA VENTANA DE EDITAR. Hay una, y las dos rutas que editan montan ésta.
 *
 * Es todo lo que envuelve al contenido de una ventana de edición:
 *
 *   el fondo desenfocado, y su apagado al salir
 *   `SheetWindow` — lienzo, velo táctil, panel medido y centrado, cristal,
 *                   esquinas, encabezado con el título y la X, teclado,
 *                   animación de entrada y cierre completo
 *
 * **Existe para que la igualdad no dependa de que nadie se despiste.** Antes
 * cada ruta montaba `SheetWindow` por su cuenta con sus mismas cuatro props:
 * idéntico sólo mientras nadie tocara una sola. Con una pieza en medio, cambiar
 * la ventana de una **es** cambiar la de la otra — que es la regla que se pidió.
 *
 * Lo único que cambia entre ellas es el título y lo que va dentro.
 *
 * **El fondo se apaga al DESMONTARSE, no al pulsar cerrar.** Es lo que evita el
 * fotograma nítido: la ruta todavía se está yendo —el panel baja y luego la
 * pantalla se funde— y durante todo ese rato el desenfoque tiene que seguir
 * puesto. Y por ser una limpieza, cubre también el gesto del sistema y el
 * `back` de hardware, que con un `hide()` en el manejador de cerrar habrían
 * dejado el desenfoque encendido sobre una pantalla sin ventana.
 *
 * **Vive en `shell` y no en `personal` porque el fondo es suyo**: `AddBackdrop`
 * no es del `+` ni de una feature, es de cualquier ventana que se abra sobre
 * Inicio. Y una feature no puede importar otra.
 */
export function EditWindow({
  title,
  children,
}: {
  readonly title: string;
  /** Recibe `close`: cerrar es bajar la hoja Y deshacer la ruta, en ese orden. */
  readonly children: (close: () => void) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const backdrop = useAddBackdrop();

  const hideBackdrop = backdrop.hide;
  useEffect(() => hideBackdrop, [hideBackdrop]);

  return (
    <SheetWindow title={title} closeLabel={t('action.close')} onClosed={router.back}>
      {children}
    </SheetWindow>
  );
}
