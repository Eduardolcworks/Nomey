import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import {
  currentClockTime,
  EMPTY_AMOUNT,
  MovementForm,
  type MovementFormScope,
  useEntryCategories,
  useEntryQueue,
  todayInDeviceCalendar,
  usePersonalScope,
} from '@/features/personal';
import { useSession } from '@/features/session';
import { useAddBackdrop } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';
import type { CalendarDate } from '@/lib/format';
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
  const { state: session } = useSession();
  const actorId = session.status === 'signed-in' ? session.identity.userId : '';
  /*
   * Con el actor: sin red, el ámbito sale de la copia guardada en la última
   * resolución correcta de ESTA cuenta, y la hoja puede registrar igual.
   */
  const { state } = usePersonalScope(actorId);
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

  /*
   * LA IDENTIDAD LA PONE LA RUTA, como en Inicio: `features/` no puede leer la
   * sesión. Con ella, la cola aísla la entrada por cuenta (ADR-028 §13) y el
   * catálogo cacheado se lee de la casilla de ESTE actor (§16).
   */
  const categories = useEntryCategories(actorId);
  /*
   * Desde F7.D guardar es ENCOLAR: la hoja persiste la intención y se cierra
   * sólo cuando quedó en disco; el worker —montado en la raíz— la envía por
   * detrás. La ventana no espera a la red, con conexión o sin ella.
   */
  const queue = useEntryQueue(actorId, session.status);

  /*
   * ═══ CUANDO LA HOJA LLEGA DESDE «REVISAR» ═══
   *
   * Sólo ocurre tras un conflicto monetario, donde la frontera se negó ANTES de
   * escribir, así que repetir el movimiento no puede duplicar nada (ADR-029 §2).
   *
   * **Vienen el concepto, la categoría y la fecha. El importe no.** El de
   * entonces pertenece a una definición monetaria que ya no es la vigente, y
   * traerlo lo convertiría en la misma cifra bajo otra moneda sin que nadie
   * hubiera convertido nada — ADR-003 §7 y ADR-028 §14 lo prohíben, y que lo
   * confirme una persona no lo convierte en una conversión. El campo se queda
   * vacío para que la cantidad se declare en la moneda que hay.
   *
   * Y `resolving` viaja hasta la cola: guardar resuelve la incidencia **en la
   * misma transacción** que crea la intención nueva. Cerrar sin guardar no
   * resuelve nada, que es lo que ADR-029 §4 decide.
   */
  const params = useLocalSearchParams<{
    resolving?: string;
    kind?: string;
    concept?: string;
    categoryId?: string;
    date?: string;
  }>();
  const resolving =
    typeof params.resolving === 'string' && params.resolving !== '' ? params.resolving : null;

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
      {(close) => (
        <MovementForm
          scope={scope}
          categories={categories}
          queue={queue}
          initial={resolving === null ? undefined : prefill(params)}
          resolving={resolving}
          onSaved={close}
        />
      )}
    </SheetWindow>
  );
}

/**
 * Lo que `Revisar` trae, y lo que deliberadamente no trae.
 *
 * Sin importe y sin hora: el importe por ADR-029 §3, y la hora porque el
 * borrador la pone al abrirse — es cuándo se registra, no un dato del
 * movimiento anterior que haya que conservar.
 */
function prefill(params: {
  kind?: string;
  concept?: string;
  categoryId?: string;
  date?: string;
}): Parameters<typeof MovementForm>[0]['initial'] {
  return {
    kind: params.kind === 'income' ? 'income' : 'expense',
    amount: EMPTY_AMOUNT,
    concept: params.concept ?? '',
    categoryId:
      typeof params.categoryId === 'string' && params.categoryId !== '' ? params.categoryId : null,
    date: (params.date ?? todayInDeviceCalendar()) as CalendarDate,
    time: currentClockTime(),
  };
}
