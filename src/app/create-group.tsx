import { router } from 'expo-router';

import { GroupWindow } from '@/features/groups';
import { useEntryCategories, usePersonalScope } from '@/features/personal';
import { useSession } from '@/features/session';

/**
 * LA VENTANA DE CREAR GRUPO. El mismo armazón que la del `+` de Personal.
 *
 * **`SheetWindow` sin variantes**, que es lo que le da el mismo material, el
 * mismo tamaño, la misma posición, la misma entrada y el mismo desplazamiento
 * por teclado que «Añadir movimiento», «Editar movimiento» y «Editar
 * disponible». Copiar su geometría habría sido tener dos.
 *
 * **Y NO toca el fondo desenfocado.** Lo encendió el `+` de Grupos y lo apaga
 * la hoja del selector al desmontarse; esta ruta se apila encima y se va sin
 * decir nada, así que volver atrás no produce ni un fotograma sin desenfoque
 * —que es lo que pasaría si aquí hubiera un `hide()` en la limpieza— ni el dock
 * asomando entre las dos superficies.
 *
 * **La divisa sale del Modo Personal REAL.** `usePersonalScope` es idempotente
 * por estado, así que pedirla desde aquí no duplica nada; mientras resuelve, el
 * apartado dice que está cargando en vez de preseleccionar una moneda.
 */
export default function CreateGroupScreen() {
  const { state: session } = useSession();
  const actorId = session.status === 'signed-in' ? session.identity.userId : '';
  const displayName = session.status === 'signed-in' ? session.identity.displayName : null;

  /*
   * La divisa del Modo Personal, RESUELTA: id, código y escala.
   *
   * Las tres, y no sólo el id, porque son las tres las que se congelan en el
   * comando — y porque `usePersonalScope` las tiene cacheadas, que es lo que hace
   * que crear un grupo funcione sin red.
   */
  const { state } = usePersonalScope(actorId);
  /*
   * El catálogo REAL del actor, por la misma lectura que usa el gasto: es lo
   * que hace que la categoría preestablecida sea una de las que un gasto
   * compartido puede llevar, y ninguna otra.
   */
  const categories = useEntryCategories(actorId);
  const personalCurrency =
    state.status === 'ready'
      ? {
          id: state.currencyDefinitionId,
          code: state.currencyCode,
          scale: state.currencyScale,
        }
      : null;

  return (
    <GroupWindow
      displayName={displayName}
      actorId={actorId}
      personalCurrency={personalCurrency}
      sessionStatus={session.status}
      categories={categories.rows}
      /*
       * CIERRA HASTA GRUPOS, NO HASTA EL SELECTOR.
       *
       * `dismissAll` deshace TODAS las ventanas de la pila de una vez, así que
       * la hoja del selector no llega a reaparecer entre medias: se va con
       * ésta, en el mismo fotograma. Con `back` se veía un instante y encima
       * quedaba una ruta modal más en la pila, de modo que el siguiente Atrás
       * la descubría.
       *
       * Y el desenfoque se retira EN SU MOMENTO: lo apaga la limpieza del
       * selector al desmontarse, que ocurre cuando esto se llama — con la
       * ventana ya abajo, porque `SheetWindow` espera a que termine su caída.
       */
      onClosed={() => {
        router.dismissAll();
      }}
    />
  );
}
