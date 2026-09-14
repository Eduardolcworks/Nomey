import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import {
  publishGroupRecorded,
  SharedExpenseWindow,
  useExpenseDraft,
  useGroups,
} from '@/features/groups';
import { todayInDeviceCalendar, useEntryCategories } from '@/features/personal';
import { useSession } from '@/features/session';
import { clockTimeOf } from '@/lib/format';
import { useAddBackdrop } from '@/features/shell';

/**
 * LA RUTA DE AÑADIR UN GASTO COMPARTIDO. La abre el `+` de un grupo.
 *
 * **Es su propia ruta, y no `/add`.** `/add` es el alta del Modo Personal: su
 * formulario lleva selector de clase, categoría y ámbito personal, y su
 * `Guardar` encola un `personal_expense.create`. Abrirla desde un grupo habría
 * arrancado el flujo de Personal con un rótulo distinto, que es exactamente el
 * error que separa una operación de otra.
 *
 * **El grupo llega por parámetro y sale de la MISMA proyección que la lista.**
 * Nombre, divisa y participantes son los que la tarjeta enseña, así que no
 * pueden discrepar. Y como la identidad del ámbito es la que el cliente generó,
 * un grupo todavía en la cola se abre igual: la ventana no necesita red.
 *
 * **La identidad la pone la ruta**, igual que en `/add`: `features/` no puede
 * leer la sesión.
 */
export default function GroupExpenseScreen() {
  /**
   * `operationId` sólo llega cuando lo que se abre es una CORRECCIÓN. Sin él,
   * la misma ruta es el alta de siempre: no hay dos pantallas ni dos
   * formularios, sólo un formulario que a veces abre con valores dentro.
   */
  const { groupId, operationId } = useLocalSearchParams<{
    groupId: string;
    operationId?: string;
  }>();
  const { state: session } = useSession();
  const actorId = session.status === 'signed-in' ? session.identity.userId : '';
  const backdrop = useAddBackdrop();

  /*
   * EL CATÁLOGO LO MONTA LA RUTA, y no la ventana.
   *
   * `useEntryCategories` vive en `features/personal` porque allí está su respaldo
   * sin conexión, y `features/groups` no puede importarlo — una feature no lee de
   * otra. Una ruta sí puede montar las dos y pasar el resultado, que es
   * exactamente su trabajo. Es también lo que garantiza que el catálogo sea UNO:
   * las dos ventanas piden las mismas filas al mismo sitio.
   *
   * Con la identidad, porque el catálogo cacheado está aislado por cuenta.
   */
  const categories = useEntryCategories(actorId);

  /*
   * EL FONDO SE APAGA AL DESMONTARSE, no al pulsar cerrar. Es lo que evita el
   * fotograma nítido: la ruta todavía se está yendo —el panel baja y luego la
   * pantalla se funde— y durante todo ese rato el desenfoque sigue puesto. Por
   * ser una limpieza cubre además el gesto del sistema y el Atrás de hardware.
   */
  const hideBackdrop = backdrop.hide;
  useEffect(() => hideBackdrop, [hideBackdrop]);

  const { groups, loading } = useGroups(actorId, session.status);
  const group = groups.find((one) => one.scopeId === groupId);

  /*
   * Sin grupo no se inventa uno ni se abre una ventana vacía: se deshace la
   * ruta. Pasa si el enlace llega de fuera o si la cuenta cambió.
   *
   * **Sólo cuando la lista remota ya se ha leído.** La lista de `useGroups`
   * empieza con lo LOCAL —las creaciones de la cola de este aparato, que
   * llegan antes que el servidor— y eso no dice nada de un grupo al que se
   * entró por invitación: no está en la cola. Medido en el iPhone
   * (2026-09-14, `[diag:+]`): con una creación local en la cola, la ruta
   * veía «1 grupo, no es éste» y volvía atrás en el mismo instante en que
   * montaba, antes de que `fetchGroups` respondiera; los grupos creados en
   * el propio aparato abrían y los ajenos no. Se espera a que la lectura
   * termine, como ya hacen `edit-group` y `share-group`.
   */
  useEffect(() => {
    if (!loading && group === undefined) router.back();
  }, [group, loading]);

  /*
   * LOS VALORES VIGENTES, cuando se está corrigiendo. Se leen del servidor —
   * lo declarado, no las cuotas resueltas— y con ellos viaja la versión que se
   * corrige, que es el CAS del guardado.
   */
  const editing = useExpenseDraft(
    group?.scopeId ?? '',
    operationId ?? null,
    session.status,
    group?.currencyScale ?? 2,
  );

  if (group === undefined) return null;

  /*
   * **Corregir no abre nada hasta tener lo que hay.** Un formulario en blanco
   * sobre una corrección no está «cargando»: al guardarse sustituiría el gasto
   * por lo poco que hubiera dentro. Mientras llega, la ruta no monta la
   * ventana; si no llega, se deshace.
   */
  if (operationId !== undefined && editing.draft === null) {
    if (editing.failed) router.back();
    return null;
  }

  return (
    <SharedExpenseWindow
      group={group}
      actorId={actorId}
      sessionStatus={session.status}
      today={todayInDeviceCalendar()}
      now={clockTimeOf(new Date())}
      categories={categories}
      initial={editing.draft ?? undefined}
      correction={
        editing.operation === null
          ? undefined
          : {
              operationId: editing.operation.operationId,
              expectedVersionId: editing.operation.versionId,
            }
      }
      onClosed={() => {
        router.back();
      }}
      /*
       * EL GASTO YA ESTÁ ESCRITO, y la pantalla del grupo tiene que releer.
       *
       * No puede enterarse sola: es la de debajo en la pila, así que no se
       * remonta al cerrarse ésta. Y no vale recargar al recuperar el foco —eso
       * consultaría también cuando alguien abre la ventana y la cancela, que no
       * cambia nada que leer—. Se anuncia el ámbito y quien lo esté mirando
       * vuelve a preguntar al servidor.
       */
      onRecorded={() => {
        publishGroupRecorded(group.scopeId);
      }}
    />
  );
}
