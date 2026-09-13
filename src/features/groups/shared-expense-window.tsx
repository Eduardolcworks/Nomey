import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

import { currencyDefinition } from '@/domain';
import { type CategoryCatalogue, sharedCategories } from '@/lib/categories';
import type { CalendarDate } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import type { SessionStatus } from '@/lib/offline';
import { SheetWindow } from '@/ui/components';

import type { ProjectedGroup } from './group-projection';
import type { SharedExpenseDraft } from './shared-expense';
import { SharedExpenseForm } from './shared-expense-form';
import { useGroupParticipants } from './use-group-participants';

/**
 * LA VENTANA DE AÑADIR GASTO COMPARTIDO.
 *
 * **`SheetWindow` sin variantes**, que es lo que le da el mismo material, el
 * mismo tamaño, la misma posición, la misma entrada, el mismo cierre y el mismo
 * desplazamiento por teclado que «Añadir movimiento», «Editar movimiento»,
 * «Editar disponible» y «Crear grupo». Copiar su geometría habría sido tener dos.
 *
 * **El contexto es el grupo desde el que se abrió, y no se puede cambiar.** El
 * nombre va donde Inicio pone «Personal», como rótulo: la ventana la abre el `+`
 * de un grupo concreto, así que no hay ámbito que elegir.
 */
export function SharedExpenseWindow({
  group,
  actorId,
  sessionStatus,
  today,
  now,
  categories,
  onClosed,
  onRecorded,
  initial,
  correction,
}: {
  readonly group: ProjectedGroup;
  readonly actorId: string;
  readonly sessionStatus: SessionStatus;
  readonly today: CalendarDate;
  /** La hora actual, `HH:MM`, sembrada por la ruta con `today`. */
  readonly now: string;
  /**
   * El catálogo de categorías, cargado por la RUTA.
   *
   * No se carga aquí porque quien sabe hacerlo —`useEntryCategories`— vive en
   * `features/personal`, y una feature no puede leer de otra. La ruta sí puede
   * montar las dos y pasar el resultado, que es exactamente para lo que están
   * las rutas: componer.
   */
  readonly categories: CategoryCatalogue;
  readonly onClosed: () => void;
  /** Qué hacer cuando el gasto ya está escrito. Lo decide la ruta. */
  readonly onRecorded: () => void;
  /** Los valores vigentes, cuando lo que se abre es una corrección. */
  readonly initial?: SharedExpenseDraft;
  readonly correction?: { readonly operationId: string; readonly expectedVersionId: string };
}) {
  const { t } = useTranslation();
  const { participants, loading } = useGroupParticipants(group.scopeId, actorId, sessionStatus);

  return (
    <SheetWindow
      /* La MISMA ventana; lo único que cambia es cómo se llama lo que hace. */
      title={correction === undefined ? t('group.expenseTitle') : t('group.editTitle')}
      closeLabel={t('action.close')}
      onClosed={onClosed}>
      {(close) => (
        <>
          {/* Atrás sale por la misma puerta que la `X`. */}
          <CloseOnBack close={close} />
          <SharedExpenseForm
            groupName={group.displayName}
            participants={participants}
            /*
             * LA DIVISA ES LA DEL GRUPO, nunca la del Modo Personal de quien
             * mira. Un gasto de un viaje a Brasil se reparte en la moneda base
             * de ese grupo, y su escala sale de la definición: nunca dos.
             */
            currency={currencyDefinition({
              id: group.currencyDefinitionId,
              code: group.currencyCode,
              scale: group.currencyScale,
            })}
            today={today}
            now={now}
            /*
             * LA PREESTABLECIDA, sólo si sigue siendo utilizable en un gasto
             * compartido. Si el catálogo ya no la ofrece —dada de baja, o
             * propia— no se sustituye por otra: el alta nace sin categoría y la
             * persona elige. Nunca pisa una corrección ni un borrador abierto.
             */
            presetCategoryId={
              group.defaultCategoryId !== null &&
              sharedCategories(categories.rows).some((row) => row.id === group.defaultCategoryId)
                ? group.defaultCategoryId
                : null
            }
            loading={loading}
            categories={categories}
            scopeId={group.scopeId}
            currencyDefinitionId={group.currencyDefinitionId}
            initial={initial}
            correction={correction}
            onRecorded={() => {
              onRecorded();
              close();
            }}
          />
        </>
      )}
    </SheetWindow>
  );
}

/**
 * ATRÁS SALE POR LA MISMA PUERTA QUE LA `X`.
 *
 * Sin esto el sistema deshace UNA ruta: la ventana desaparece sin bajar. Con la
 * salida de la ventana, el panel cae y al terminar `onClosed` deshace la pila.
 *
 * **Es una pieza aparte porque el cierre llega como argumento del render de
 * `SheetWindow`.** Guardarlo en una ref durante ese render es escribir una ref
 * mientras se renderiza; recibiéndolo como `prop`, la ref se actualiza en un
 * efecto, que es donde se puede.
 */
function CloseOnBack({ close }: { readonly close: () => void }) {
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      latest.current();
      return true;
    });
    return () => subscription.remove();
  }, []);

  return null;
}
