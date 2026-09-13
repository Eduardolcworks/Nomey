import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { GroupActionSheet } from '@/features/groups';
import { useSession } from '@/features/session';
import { useAddBackdrop } from '@/features/shell';

/**
 * El selector del `+` de Grupos. La ruta compone y no decide.
 *
 * **`Crear grupo` abre su ventana; `Únete a un grupo` todavía no.** El segundo
 * formulario es un paso posterior, y dejarlo apuntando a una ruta provisional
 * habría creado un destino que luego hay que desmontar y que mientras tanto
 * miente. Hasta que exista, elegirlo cierra.
 *
 * **La ventana se APILA sobre esta ruta, no la reemplaza.** Cerrarla devuelve
 * al selector para poder escoger la otra opción, y el fondo desenfocado no
 * parpadea entre las dos porque su dueño sigue siendo esta pantalla: quien lo
 * apaga es su limpieza, y esta ruta no se desmonta al apilar la siguiente.
 */
export default function GroupActionScreen() {
  const router = useRouter();
  const backdrop = useAddBackdrop();
  /*
   * CON LA VENTANA DE CREAR GRUPO ENCIMA, ESTA HOJA SE RETIRA.
   *
   * Sigue montada —el fondo es suyo y volver atrás la devuelve— pero no se ve:
   * dos superficies modales apiladas a la vez se leen como un error.
   *
   * **`useFocusEffect` y no `useIsFocused`.** El segundo, con una ventana
   * `transparentModal` encima, se quedaba en `false` después de que ésta se
   * cerrara: medido en el emulador, volver atrás dejaba la hoja retirada y un
   * velo invisible a pantalla completa sobre Grupos. `useFocusEffect` no
   * pregunta por el estado: recibe el foco al entrar y su limpieza al salir,
   * que es justo el par que hace falta.
   */
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
      };
    }, []),
  );

  /*
   * EL FONDO SE APAGA AL DESMONTARSE, no al pulsar cerrar — igual que en
   * «Añadir movimiento» y por lo mismo: la ruta todavía se está yendo mientras
   * la hoja baja, y durante todo ese rato el desenfoque tiene que seguir
   * puesto. Por ser una limpieza cubre además el gesto del sistema y el botón
   * Atrás, que de otro modo dejarían el fondo encendido sin ventana encima.
   */
  const hideBackdrop = backdrop.hide;
  useEffect(() => hideBackdrop, [hideBackdrop]);

  const dismiss = () => {
    router.back();
  };
  const { state: session } = useSession();
  const profileName = session.status === 'signed-in' ? session.identity.displayName : null;

  return (
    <GroupActionSheet
      hidden={!focused}
      onCreate={() => {
        router.push('/create-group');
      }}
      profileName={profileName}
      /*
       * Ya dentro (F09/ADR-004): la hoja se sustituye por el grupo. `replace` y no
       * `push`, para que volver desde el grupo no reabra la hoja de unirse.
       */
      onJoined={(scopeId) => {
        router.replace({ pathname: '/group/[id]', params: { id: scopeId } });
      }}
      onClosed={dismiss}
    />
  );
}
